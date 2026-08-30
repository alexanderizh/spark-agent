import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('built CLI contract', () => {
  it('emits the complete fact stream in JSON mode with no ANSI escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-cli-'))
    roots.push(root)
    const server = await startResponsesServer()
    await mkdir(join(root, '.spark'))
    await writeFile(
      join(root, '.spark', 'config.toml'),
      `[agent]\nmodel = "local"\n\n[providers.test]\nprotocol = "openai-responses"\nbase_url = "${server.baseUrl}"\napi_key_env = "TEST_OPENAI_KEY"\n\n[models.local]\nprovider = "test"\nmodel = "gpt-test"\n`,
    )
    const result = await runCli(
      ['--json', 'hello'],
      { SPARK_HOME: join(root, 'home'), NO_COLOR: '1', TEST_OPENAI_KEY: 'test-key' },
      root,
    )
    await server.close()
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain(String.fromCharCode(27))
    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; seq: number })
    expect(events.map((event) => event.type)).toEqual([
      'session.started',
      'turn.started',
      'step.started',
      'assistant.completed',
      'turn.completed',
    ])
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
  })

  it('returns usage error 2 for an invalid output format', async () => {
    const result = await runCli(['--output-format', 'xml', 'hello'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('Unsupported --output-format')
  })

  it('reports an unusable selected model instead of declaring doctor healthy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-cli-doctor-'))
    roots.push(root)
    await mkdir(join(root, '.spark'))
    await writeFile(
      join(root, '.spark', 'config.toml'),
      '[agent]\nmodel = "local"\n\n[providers.test]\nprotocol = "openai-responses"\napi_key_env = "MISSING_KEY"\n\n[models.local]\nprovider = "test"\nmodel = "gpt-test"\n',
    )

    const result = await runCli(['doctor'], { SPARK_HOME: join(root, 'home') }, root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('Configuration: error')
    expect(result.stdout).toContain('MISSING_KEY')
  })

  it('lists and runs the SparkWork default model through the authenticated host bridge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-cli-host-'))
    roots.push(root)
    const host = await startSparkWorkHost(root)
    const environment = { SPARK_HOME: join(root, 'home'), NO_COLOR: '1' }

    const models = await runCli(['models'], environment, root)
    expect(models.code).toBe(0)
    expect(models.stdout).toContain(
      '* gpt-host  SparkWork �]0;owned�Test  openai-responses  [sparkwork]',
    )
    expect(models.stdout).not.toContain('\u001b')
    expect(models.stdout).not.toContain(host.token)

    const doctor = await runCli(['doctor'], environment, root)
    expect(doctor.code).toBe(0)
    expect(doctor.stdout).toContain('SparkWork bridge: connected')
    expect(doctor.stdout).toContain('Selected model: sparkwork:provider-1:gpt-host')

    const result = await runCli(['--json', 'use host'], environment, root)
    await host.close()
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('"type":"turn.completed"')
    expect(host.requests).toEqual([
      {
        path: '/v1/proxy/provider-1/v1/responses',
        authorization: `Bearer ${host.token}`,
      },
    ])
  })

  it('keeps non-interactive runs fail-fast when no model is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-cli-nocfg-'))
    roots.push(root)
    const result = await runCli(
      ['do something'],
      { SPARK_HOME: join(root, 'home'), NO_COLOR: '1' },
      root,
    )
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('No model is available')
    expect(result.stderr).toContain('spark init')
  })

  it('rejects unknown and conflicting permission modes before loading config', async () => {
    const unknown = await runCli(['--permission-mode', 'unsafe', 'hello'])
    const conflicting = await runCli([
      '--permission-mode',
      'plan',
      '--dangerously-skip-permissions',
      'hello',
    ])

    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('Unsupported --permission-mode: unsafe')
    expect(conflicting.code).toBe(2)
    expect(conflicting.stderr).toContain('conflicts with --permission-mode')
  })
})

async function runCli(
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  cwd = resolve('.'),
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const binary = resolve('dist/cli/main.js')
  const child = spawn(process.execPath, [binary, ...args], {
    cwd,
    env: { ...process.env, ...environment },
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

async function startSparkWorkHost(root: string): Promise<{
  readonly token: string
  readonly requests: { path: string; authorization: string | undefined }[]
  readonly close: () => Promise<void>
}> {
  const token = 'sparkwork-test-token-that-is-at-least-32-characters'
  const requests: { path: string; authorization: string | undefined }[] = []
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'GET' && request.url === '/v1/catalog') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          host: 'sparkwork',
          revision: 'c'.repeat(64),
          generatedAt: '2026-08-26T12:00:00.000Z',
          defaultRoute: 'sparkwork:provider-1:gpt-host',
          routes: [
            {
              routeId: 'sparkwork:provider-1:gpt-host',
              providerId: 'provider-1',
              providerName: 'SparkWork \u001b]0;owned\u0007Test',
              protocol: 'openai-responses',
              model: 'gpt-host',
            },
          ],
        }),
      )
      return
    }
    if (request.method === 'POST' && request.url === '/v1/proxy/provider-1/v1/responses') {
      requests.push({ path: request.url, authorization: request.headers.authorization })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        'event: response.output_text.delta\n' +
          'data: {"type":"response.output_text.delta","delta":"host done"}\n\n' +
          'event: response.completed\n' +
          'data: {"type":"response.completed","response":{"id":"resp_host","status":"completed","output":[{"id":"msg_host","type":"message","role":"assistant","content":[{"type":"output_text","text":"host done","annotations":[]}]}],"usage":{"input_tokens":2,"output_tokens":2}}}\n\n',
      )
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address() as AddressInfo
  const bridgeDirectory = join(root, 'home', 'hosts', 'sparkwork')
  await mkdir(bridgeDirectory, { recursive: true })
  const descriptorPath = join(bridgeDirectory, 'bridge-instance-1.json')
  await writeFile(
    descriptorPath,
    JSON.stringify({
      schemaVersion: 1,
      host: 'sparkwork',
      instanceId: 'instance-1234567890',
      endpoint: `http://127.0.0.1:${address.port}`,
      token,
      pid: process.pid,
      startedAt: '2026-08-26T12:00:00.000Z',
    }),
    { mode: 0o600 },
  )
  if (process.platform !== 'win32') await chmod(descriptorPath, 0o600)
  return {
    token,
    requests,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose()
        })
      }),
  }
}

async function startResponsesServer(): Promise<{
  readonly baseUrl: string
  readonly close: () => Promise<void>
}> {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(
      'event: response.output_text.delta\n' +
        'data: {"type":"response.output_text.delta","delta":"done"}\n\n' +
        'event: response.completed\n' +
        'data: {"type":"response.completed","response":{"id":"resp_cli","status":"completed","output":[{"id":"msg_cli","type":"message","role":"assistant","content":[{"type":"output_text","text":"done","annotations":[]}]}],"usage":{"input_tokens":2,"output_tokens":1}}}\n\n',
    )
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose) =>
        server.close(() => {
          resolveClose()
        }),
      ),
  }
}
