import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const debugServer = resolve(process.cwd(), '../scripts/debug-mcp/stdio-echo-server.mjs')
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('spark mcp contract', () => {
  it('adds, lists, and removes a stdio server', { timeout: 30_000 }, async () => {
    const root = await sandbox()
    const home = join(root, 'home')

    const add = await runCli(
      ['mcp', 'add', 'echo', '--command', 'node', '--arg', debugServer],
      root,
      home,
    )
    expect(add.code).toBe(0)
    expect(add.stdout).toContain('Added MCP server echo')
    const config = await readFile(join(home, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp.servers.echo]')
    expect(config).toContain('command = "node"')

    const list = await runCli(['mcp', 'list', '--json'], root, home)
    expect(list.code).toBe(0)
    const parsed = JSON.parse(list.stdout) as {
      servers: { name: string; transport: string; enabled: boolean; scope: string }[]
    }
    expect(parsed.servers).toContainEqual(
      expect.objectContaining({ name: 'echo', transport: 'stdio', enabled: true, scope: 'global' }),
    )

    const removed = await runCli(['mcp', 'remove', 'echo'], root, home)
    expect(removed.code).toBe(0)
    expect(await readFile(join(home, 'config.toml'), 'utf8')).not.toContain('echo')

    const missing = await runCli(['mcp', 'remove', 'echo'], root, home)
    expect(missing.code).toBe(1)
  })

  it('probes configured servers and reports their tools', { timeout: 30_000 }, async () => {
    const root = await sandbox()
    const home = join(root, 'home')
    await runCli(['mcp', 'add', 'echo', '--command', 'node', '--arg', debugServer], root, home)
    await runCli(
      ['mcp', 'add', 'broken', '--command', 'spark-missing-binary-for-tests'],
      root,
      home,
    )

    const status = await runCli(['mcp', 'status', '--json'], root, home)
    const parsed = JSON.parse(status.stdout) as {
      servers: { name: string; ok: boolean; tools?: string[] }[]
    }
    const echo = parsed.servers.find((server) => server.name === 'echo')
    const broken = parsed.servers.find((server) => server.name === 'broken')
    expect(echo?.ok).toBe(true)
    expect(echo?.tools).toContain('mcp__echo__debug_echo')
    expect(broken?.ok).toBe(false)
    // One failing server makes the probe exit non-zero so scripts can gate on it.
    expect(status.code).toBe(1)
  })

  it(
    'rejects ambiguous transports and malformed key/value flags',
    { timeout: 30_000 },
    async () => {
      const root = await sandbox()
      const home = join(root, 'home')

      const both = await runCli(
        ['mcp', 'add', 'x', '--command', 'node', '--url', 'https://example.com/mcp'],
        root,
        home,
      )
      expect(both.code).toBe(2)
      expect(both.stderr).toContain('exactly one of --command')

      const neither = await runCli(['mcp', 'add', 'x'], root, home)
      expect(neither.code).toBe(2)

      const badEnv = await runCli(
        ['mcp', 'add', 'x', '--command', 'node', '--env', 'NOT_A_PAIR'],
        root,
        home,
      )
      expect(badEnv.code).toBe(2)
      expect(badEnv.stderr).toContain('KEY=VALUE')

      const badName = await runCli(['mcp', 'add', 'bad name', '--command', 'node'], root, home)
      expect(badName.code).toBe(2)
    },
  )
})

async function sandbox(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-mcp-cli-'))
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
