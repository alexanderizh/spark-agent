import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('spark config contract', () => {
  it(
    'round-trips a global value through set, get, list and unset',
    { timeout: 30_000 },
    async () => {
      const root = await sandbox()
      const home = join(root, 'home')

      const set = await runCli(['config', 'set', 'permissions.mode', 'auto'], root, home)
      expect(set.code).toBe(0)
      expect(set.stdout).toContain('Set permissions.mode = auto')
      if (process.platform !== 'win32') {
        expect((await stat(join(home, 'config.toml'))).mode & 0o077).toBe(0)
      }

      const get = await runCli(['config', 'get', 'permissions.mode'], root, home)
      expect(get.code).toBe(0)
      expect(get.stdout.trim()).toBe('auto')

      const list = await runCli(['config', 'list', '--json'], root, home)
      expect(list.code).toBe(0)
      const parsed = JSON.parse(list.stdout) as {
        settings: { key: string; value: unknown; scope: string }[]
        paths: { global: { path: string; exists: boolean } }
      }
      expect(parsed.settings).toContainEqual(
        expect.objectContaining({ key: 'permissions.mode', value: 'auto', scope: 'global' }),
      )
      expect(parsed.paths.global).toEqual({ path: join(home, 'config.toml'), exists: true })

      const unset = await runCli(['config', 'unset', 'permissions.mode'], root, home)
      expect(unset.code).toBe(0)
      const after = await runCli(['config', 'get', 'permissions.mode'], root, home)
      expect(after.code).toBe(1)
      expect(after.stderr).toContain('permissions.mode is not set')
    },
  )

  it(
    'writes the project layer into the working directory with --project',
    { timeout: 30_000 },
    async () => {
      const root = await sandbox()
      const home = join(root, 'home')

      const result = await runCli(
        ['config', 'set', 'permissions.allow', '["read","glob"]', '--project'],
        root,
        home,
      )
      expect(result.code).toBe(0)
      const projectFile = await readFile(join(root, '.spark', 'config.toml'), 'utf8')
      expect(projectFile).toContain('[permissions]')
      expect(projectFile).toContain('read')
      expect(projectFile).toContain('glob')

      const listed = await runCli(['config', 'list', '--json'], root, home)
      const parsed = JSON.parse(listed.stdout) as {
        settings: { key: string; value: unknown; scope: string }[]
      }
      expect(parsed.settings).toContainEqual(
        expect.objectContaining({ key: 'permissions.allow', scope: 'project' }),
      )

      // --global and --project cannot be combined.
      const conflict = await runCli(
        ['config', 'set', 'permissions.mode', 'auto', '--global', '--project'],
        root,
        home,
      )
      expect(conflict.code).toBe(2)
    },
  )

  it(
    'rejects an invalid value without touching the file or the project config',
    { timeout: 30_000 },
    async () => {
      const root = await sandbox()
      const home = join(root, 'home')
      await runCli(['config', 'set', 'permissions.mode', 'manual'], root, home)

      const invalid = await runCli(['config', 'set', 'permissions.mode', 'yolo'], root, home)
      expect(invalid.code).toBe(2)
      expect(invalid.stderr).toContain('would produce an invalid config')

      const missing = await runCli(
        ['config', 'set', 'tools.disabled', '["read"]', '--project'],
        root,
        home,
      )
      // The project edit validated against the merged config still succeeds.
      expect(missing.code).toBe(0)
      expect(await readFile(join(home, 'config.toml'), 'utf8')).toContain('mode = "manual"')

      const unknownSection = await runCli(
        ['config', 'set', 'permisions.mode', 'auto', '--project'],
        root,
        home,
      )
      expect(unknownSection.code).toBe(2)
      expect(await readFile(join(root, '.spark', 'config.toml'), 'utf8')).not.toContain(
        'permisions',
      )
    },
  )

  it('reports both configuration paths', { timeout: 30_000 }, async () => {
    const root = await sandbox()
    const home = join(root, 'home')
    await runCli(['config', 'set', 'permissions.mode', 'manual'], root, home)

    const paths = await runCli(['config', 'path', '--json'], root, home)
    expect(paths.code).toBe(0)
    const parsed = JSON.parse(paths.stdout) as {
      global: { path: string; exists: boolean }
      project: { path: string; exists: boolean }
    }
    expect(parsed.global).toEqual({ path: join(home, 'config.toml'), exists: true })
    expect(parsed.project.exists).toBe(false)
  })
})

async function sandbox(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-config-cli-'))
  roots.push(root)
  await mkdir(join(root, '.spark'), { recursive: true })
  return root
}

async function runCli(
  args: readonly string[],
  cwd: string,
  sparkHome: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const binary = resolve('dist/cli/main.js')
  const child = spawn(process.execPath, [binary, ...args], {
    cwd,
    env: { ...process.env, SPARK_HOME: sparkHome, NO_COLOR: '1' },
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
