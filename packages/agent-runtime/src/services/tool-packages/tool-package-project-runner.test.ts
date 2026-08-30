import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolPackageDevelopment, ToolPackageManifest } from '@spark/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveStepCommand,
  runManagedProjectDevelopmentStep,
} from './tool-package-project-runner.js'

const roots: string[] = []

function manifest(development?: ToolPackageDevelopment): ToolPackageManifest {
  return {
    schemaVersion: 1,
    id: 'acme.productivity-suite',
    version: '1.0.0',
    name: 'Productivity Suite',
    description: 'Runner fixture',
    ...(development != null ? { development } : {}),
    runtime: {
      adapter: 'process',
      protocol: 'spark-tool-process-v1',
      command: 'node',
      args: ['runner.mjs'],
      lifecycle: 'per-call',
    },
    tools: [],
    environment: [],
    permissions: {
      declaredOsEffects: [],
      requiredSparkCapabilities: [],
      optionalSparkCapabilities: [],
    },
  }
}

async function createProject(): Promise<string> {
  const projectPath = await mkdtemp(join(tmpdir(), 'spark-tool-project-step-'))
  roots.push(projectPath)
  return projectPath
}

describe('runManagedProjectDevelopmentStep', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
  })

  it('runs a declared install command in the project directory', async () => {
    const projectPath = await createProject()
    const result = await runManagedProjectDevelopmentStep({
      packageId: 'acme.productivity-suite',
      projectPath,
      manifest: manifest({
        installCommand: "node -e \"require('fs').writeFileSync('step-marker.txt', 'ok')\"",
      }),
      step: 'install',
    })
    expect(result.exitCode).toBe(0)
    expect(result.inferred).toBe(false)
    expect(result.timedOut).toBe(false)
    expect(result.command).toBe("node -e \"require('fs').writeFileSync('step-marker.txt', 'ok')\"")
    await expect(readFile(join(projectPath, 'step-marker.txt'), 'utf8')).resolves.toBe('ok')
  })

  it('captures non-zero exit codes and stderr', async () => {
    const projectPath = await createProject()
    const result = await runManagedProjectDevelopmentStep({
      packageId: 'acme.productivity-suite',
      projectPath,
      manifest: manifest({
        installCommand: 'node -e "process.stderr.write(\'boom\'); process.exit(3)"',
      }),
      step: 'install',
    })
    expect(result.exitCode).toBe(3)
    expect(result.timedOut).toBe(false)
    expect(result.stderr).toContain('boom')
  })

  it('terminates the process tree on timeout', async () => {
    const projectPath = await createProject()
    const result = await runManagedProjectDevelopmentStep({
      packageId: 'acme.productivity-suite',
      projectPath,
      manifest: manifest({ installCommand: 'node -e "setTimeout(() => {}, 60000)"' }),
      step: 'install',
      timeoutMs: 500,
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
    expect(result.durationMs).toBeLessThan(15_000)
  }, 30_000)

  it('bounds captured output to the tail slice', async () => {
    const projectPath = await createProject()
    const result = await runManagedProjectDevelopmentStep({
      packageId: 'acme.productivity-suite',
      projectPath,
      manifest: manifest({
        installCommand: 'node -e "process.stdout.write(\'x\'.repeat(400 * 1024))"',
      }),
      step: 'install',
    })
    expect(result.exitCode).toBe(0)
    expect(result.truncated).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(70 * 1024)
    expect(result.stdout).toContain('已截断')
    expect(result.stdout.endsWith('xxx')).toBe(true)
  })

  it('rejects a build step without a declared build command', async () => {
    const projectPath = await createProject()
    await expect(
      runManagedProjectDevelopmentStep({
        packageId: 'acme.productivity-suite',
        projectPath,
        manifest: manifest(),
        step: 'build',
      }),
    ).rejects.toThrow(/development\.buildCommand/)
  })
})

describe('resolveStepCommand', () => {
  it('prefers the declared command over lockfile inference', async () => {
    const projectPath = await createProject()
    await writeFile(join(projectPath, 'pnpm-lock.yaml'), '', 'utf8')
    const resolved = await resolveStepCommand(
      projectPath,
      manifest({ installCommand: 'pnpm install --frozen-lockfile' }),
      'install',
    )
    expect(resolved).toEqual({ command: 'pnpm install --frozen-lockfile', inferred: false })
  })

  it('infers install commands from supported lockfiles', async () => {
    const pnpm = await createProject()
    await writeFile(join(pnpm, 'pnpm-lock.yaml'), '', 'utf8')
    await expect(resolveStepCommand(pnpm, manifest(), 'install')).resolves.toEqual({
      command: 'pnpm install',
      inferred: true,
    })

    const yarn = await createProject()
    await writeFile(join(yarn, 'yarn.lock'), '', 'utf8')
    await expect(resolveStepCommand(yarn, manifest(), 'install')).resolves.toEqual({
      command: 'yarn install',
      inferred: true,
    })

    const bun = await createProject()
    await writeFile(join(bun, 'bun.lockb'), '', 'utf8')
    await expect(resolveStepCommand(bun, manifest(), 'install')).resolves.toEqual({
      command: 'bun install',
      inferred: true,
    })

    const npm = await createProject()
    await writeFile(join(npm, 'package.json'), '{}', 'utf8')
    await expect(resolveStepCommand(npm, manifest(), 'install')).resolves.toEqual({
      command: 'npm install',
      inferred: true,
    })
  })

  it('throws when no declared install command and no supported package file exists', async () => {
    const projectPath = await createProject()
    await expect(resolveStepCommand(projectPath, manifest(), 'install')).rejects.toThrow(
      /development\.installCommand/,
    )
  })
})
