import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const nodeDir = dirname(process.execPath)

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('spark install / uninstall / init', () => {
  it('reports the real package version', async () => {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      version: string
    }
    const result = await runCli(['--version'])
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(manifest.version)
  })

  it('installs a launcher that runs from any directory and uninstalls it cleanly', async () => {
    const root = await createRoot()
    const binDir = join(root, 'bin')
    const home = join(root, 'home')

    const install = await runCli(['install', '--bin', binDir], { SPARK_HOME: home }, root)
    expect(install.code).toBe(0)
    expect(install.stdout).toContain('Installed launcher:')
    expect(install.stdout).toContain(`-> ${resolve('dist', 'cli', 'main.js')}`)

    const launcher = join(binDir, 'spark')
    expect(await exists(launcher)).toBe(true)
    if (process.platform !== 'win32') {
      expect(await readLink(launcher)).toBe(resolve('dist', 'cli', 'main.js'))
    }

    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      version: string
    }
    const foreign = await mkdtemp(join(tmpdir(), 'spark-foreign-'))
    roots.push(foreign)
    const launched = await runDirect(launcher, ['--version'], foreign)
    expect(launched.code).toBe(0)
    expect(launched.stdout.trim()).toBe(manifest.version)

    const uninstall = await runCli(['uninstall', '--bin', binDir], { SPARK_HOME: home }, root)
    expect(uninstall.code).toBe(0)
    expect(uninstall.stdout).toContain('Removed launcher')
    expect(await exists(launcher)).toBe(false)

    const again = await runCli(['uninstall', '--bin', binDir], { SPARK_HOME: home }, root)
    expect(again.code).toBe(0)
    expect(again.stdout).toContain('No spark launcher found')
  })

  it('warns when the launcher directory is missing from PATH', async () => {
    const root = await createRoot()
    const install = await runCli(['install', '--bin', join(root, 'bin')], {
      SPARK_HOME: join(root, 'home'),
    })
    expect(install.code).toBe(0)
    expect(install.stdout).toContain('is not on your PATH')
    expect(install.stdout).toContain(`export PATH="${resolve(root, 'bin')}:$PATH"`)
  })

  it('warns when a foreign spark appears earlier on PATH', async () => {
    const root = await createRoot()
    const foreignDir = join(root, 'early')
    const binDir = join(root, 'bin')
    const foreign = join(foreignDir, 'spark')
    await mkdir(foreignDir, { recursive: true })
    await writeFile(foreign, '#!/bin/sh\necho foreign-spark\n', { mode: 0o755 })
    if (process.platform !== 'win32') await chmod(foreign, 0o755)

    const install = await runCli(
      ['install', '--bin', binDir],
      {
        SPARK_HOME: join(root, 'home'),
        PATH: [foreignDir, binDir, nodeDir].join(':'),
      },
      root,
    )
    expect(install.code).toBe(0)
    expect(install.stdout).toContain('WARNING')
    expect(install.stdout).toContain(`${foreign} appears earlier on PATH`)
  })

  it('refuses to replace a foreign file unless --force is passed', async () => {
    const root = await createRoot()
    const binDir = join(root, 'bin')
    const launcher = join(binDir, 'spark')
    await mkdir(binDir, { recursive: true })
    await writeFile(launcher, '#!/bin/sh\necho not-spark\n', { mode: 0o755 })

    const refused = await runCli(['install', '--bin', binDir], { SPARK_HOME: join(root, 'home') })
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain('not a spark launcher')

    const forced = await runCli(
      ['install', '--bin', binDir, '--force'],
      { SPARK_HOME: join(root, 'home') },
    )
    expect(forced.code).toBe(0)
    expect(forced.stdout).toContain('Replaced existing launcher')
  })

  it('uninstall refuses to remove a foreign spark entry', async () => {
    const root = await createRoot()
    const binDir = join(root, 'bin')
    const launcher = join(binDir, 'spark')
    await mkdir(binDir, { recursive: true })
    await writeFile(launcher, '#!/bin/sh\necho keep-me\n', { mode: 0o755 })

    const result = await runCli(['uninstall', '--bin', binDir], { SPARK_HOME: join(root, 'home') })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('not a spark launcher')
    expect(await exists(launcher)).toBe(true)
  })

  it('doctor reports launcher version drift and broken launchers', async () => {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      version: string
    }
    const root = await createRoot()
    const fakePackage = join(root, 'fake-spark')
    const fakeEntry = join(fakePackage, 'dist', 'cli', 'main.js')
    await mkdir(dirname(fakeEntry), { recursive: true })
    await writeFile(
      join(fakePackage, 'package.json'),
      JSON.stringify({ name: '@spark/agent', version: '9.9.9' }),
    )
    await writeFile(fakeEntry, '#!/usr/bin/env node\nprocess.stdout.write("9.9.9\\n")\n', {
      mode: 0o755,
    })
    if (process.platform !== 'win32') await chmod(fakeEntry, 0o755)

    const driftBin = join(root, 'drift-bin')
    await mkdir(driftBin, { recursive: true })
    await symlink(fakeEntry, join(driftBin, 'spark'))
    const drift = await runCli(
      ['doctor'],
      { SPARK_HOME: join(root, 'home'), PATH: [driftBin, nodeDir].join(':') },
      root,
    )
    expect(drift.stdout).toContain(`v9.9.9 — this spark is v${manifest.version}`)
    expect(drift.stdout).toContain('rerun spark install to relink')

    const brokenBin = join(root, 'broken-bin')
    await mkdir(brokenBin, { recursive: true })
    await symlink(join(root, 'moved-away', 'dist', 'cli', 'main.js'), join(brokenBin, 'spark'))
    const broken = await runCli(
      ['doctor'],
      { SPARK_HOME: join(root, 'home'), PATH: [brokenBin, nodeDir].join(':') },
      root,
    )
    expect(broken.stdout).toContain('broken link')
    expect(broken.stdout).toContain('moved-away')
  })

  it('doctor says when spark is not on PATH at all', async () => {
    const root = await createRoot()
    const result = await runCli(
      ['doctor'],
      { SPARK_HOME: join(root, 'home'), PATH: nodeDir },
      root,
    )
    expect(result.stdout).toContain('spark on PATH: not found')
    expect(result.stdout).toContain('run `spark install`')
  })

  it('init writes a credential-free starter config exactly once', async () => {
    const root = await createRoot()
    const home = join(root, 'home')
    const configPath = join(home, 'config.toml')

    const created = await runCli(['init'], { SPARK_HOME: home }, root)
    expect(created.code).toBe(0)
    expect(created.stdout).toContain(`Created ${resolve(configPath)}`)
    const config = await readFile(configPath, 'utf8')
    expect(config).toContain('api_key_env')
    expect(config).not.toMatch(/sk-[A-Za-z0-9]/u)

    const skipped = await runCli(['init'], { SPARK_HOME: home }, root)
    expect(skipped.code).toBe(0)
    expect(skipped.stdout).toContain('already exists')

    // The starter template must parse and reach model selection, proving the
    // file the user just created is valid TOML for the same binary.
    const doctor = await runCli(['doctor'], { SPARK_HOME: home }, root)
    expect(doctor.stdout).toContain('Configuration: error')
    expect(doctor.stdout).toContain('No model is selected')
  })
})

async function runCli(
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  cwd = resolve('.'),
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return runDirect(resolve('dist', 'cli', 'main.js'), args, cwd, environment)
}

async function runDirect(
  binary: string,
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const merged = {
    ...process.env,
    // Children launched through their shebang need a node directory on PATH.
    PATH: [nodeDir, process.env.PATH ?? ''].join(':'),
    ...environment,
  }
  const child = spawn(binary, [...args], {
    cwd,
    env: merged,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const code = await new Promise<number | null>((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', resolveCode)
  })
  return { code, stdout, stderr }
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-install-'))
  roots.push(root)
  return root
}

async function exists(path: string): Promise<boolean> {
  const { access } = await import('node:fs/promises')
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readLink(path: string): Promise<string> {
  const { readlink } = await import('node:fs/promises')
  return readlink(path)
}
