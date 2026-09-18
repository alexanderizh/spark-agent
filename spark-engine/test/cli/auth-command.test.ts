import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, rm, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await shutdownServer(server)
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface AccountServerOptions {
  /** 'unauthorized' makes both /me and /auth/refresh reject the session. */
  readonly sessionMode?: 'ok' | 'unauthorized'
}

interface AccountServer {
  readonly baseUrl: string
  readonly requests: { readonly path: string; readonly body: string }[]
  readonly close: () => Promise<void>
}

async function startAccountServer(options: AccountServerOptions = {}): Promise<AccountServer> {
  const requests: { path: string; body: string }[] = []
  const sessionMode = options.sessionMode ?? 'ok'
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? ''
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push({ path, body })
      sendJson(response, route(path, body))
    })
  })
  servers.push(server)
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('cannot bind the mock account server')
  const baseUrl = `http://127.0.0.1:${address.port}`

  function route(
    path: string,
    body: string,
  ): { readonly status: number; readonly payload: unknown } {
    void body
    if (path.startsWith('/api/v1/auth/desktop/poll')) {
      return { status: 200, payload: { code: 0, data: { status: 'bound' } } }
    }
    if (path.startsWith('/api/v1/client-config')) {
      return { status: 200, payload: { code: 0, data: { webLoginUrl: `${baseUrl}/login` } } }
    }
    if (path.startsWith('/api/v1/auth/desktop/exchange')) {
      return {
        status: 200,
        payload: {
          code: 0,
          data: { token: 'cli-token', refreshToken: 'cli-refresh', userId: '99' },
        },
      }
    }
    if (path.startsWith('/api/v1/auth/refresh')) {
      return sessionMode === 'ok'
        ? {
            status: 200,
            payload: {
              code: 0,
              data: { token: 'cli-token-2', refreshToken: 'cli-refresh-2', userId: '99' },
            },
          }
        : { status: 401, payload: { code: 401, message: 'refresh token revoked' } }
    }
    if (path.startsWith('/api/v1/me')) {
      return sessionMode === 'ok'
        ? {
            status: 200,
            payload: {
              code: 0,
              data: { id: 99, account: 'cli@example.com', nickname: 'CLI User', role: 'user' },
            },
          }
        : { status: 401, payload: { code: 401, message: 'token expired' } }
    }
    return { status: 404, payload: { code: 404, message: `unexpected path ${path}` } }
  }

  return {
    baseUrl,
    requests,
    close: async () => {
      await shutdownServer(server)
    },
  }
}

async function shutdownServer(server: Server): Promise<void> {
  const index = servers.indexOf(server)
  if (index >= 0) servers.splice(index, 1)
  await new Promise<void>((done) => {
    server.close(() => {
      done()
    })
  })
}

function sendJson(
  response: ServerResponse,
  result: { readonly status: number; readonly payload: unknown },
): void {
  response.writeHead(result.status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(result.payload))
}

async function workspace(): Promise<{ readonly root: string; readonly home: string }> {
  const root = await mkdtemp(resolve(tmpdir(), 'spark-auth-cli-'))
  roots.push(root)
  return { root, home: resolve(root, 'home') }
}

async function runCli(
  args: readonly string[],
  cwd: string,
  home: string,
  baseUrl: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const binary = resolve('dist/cli/main.js')
  const child = spawn(process.execPath, [binary, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SPARK_HOME: home,
      SPARK_EDUGEN_BASE_URL: baseUrl,
      SPARK_WEB_LOGIN_URL: '',
      NO_COLOR: '1',
    },
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

describe('spark login contract', () => {
  it('signs in through the browser protocol, persists 0600 credentials, and supports whoami/logout', async () => {
    const { root, home } = await workspace()
    const account = await startAccountServer()

    const login = await runCli(['login', '--no-browser', '--json'], root, home, account.baseUrl)
    expect(login.code).toBe(0)
    const payload = JSON.parse(login.stdout) as {
      readonly authenticated: boolean
      readonly userId: string
      readonly loginUrl: string
      readonly openedInBrowser: boolean
      readonly credentialPath: string
      readonly account: { readonly nickname: string } | null
    }
    expect(payload.authenticated).toBe(true)
    expect(payload.userId).toBe('99')
    expect(payload.openedInBrowser).toBe(false)
    expect(payload.account?.nickname).toBe('CLI User')
    expect(payload.credentialPath).toBe(resolve(home, 'credentials.json'))
    // Progress lines must not pollute the JSON contract.
    expect(login.stdout.trimEnd().endsWith('}')).toBe(true)
    expect(login.stderr).toContain('Open this page in a browser')

    // The exchanged verifier must match the challenge handed to the web page.
    const challenge = new URL(payload.loginUrl).searchParams.get('challenge')
    const exchange = account.requests.find((request) =>
      request.path.startsWith('/api/v1/auth/desktop/exchange'),
    )
    const exchangeBody = JSON.parse(exchange?.body ?? '{}') as { readonly codeVerifier?: string }
    expect(
      createHash('sha256')
        .update(exchangeBody.codeVerifier ?? '')
        .digest('hex'),
    ).toBe(challenge)

    const credentials = await stat(payload.credentialPath)
    if (process.platform !== 'win32') {
      // Windows reports a fixed 0o666-style mode mask; file access there is
      // governed by ACLs, so the 0600 contract is POSIX-only.
      expect(credentials.mode & 0o777).toBe(0o600)
    } else {
      expect(credentials.isFile()).toBe(true)
    }

    const whoami = await runCli(['whoami', '--json'], root, home, account.baseUrl)
    expect(whoami.code).toBe(0)
    expect(JSON.parse(whoami.stdout)).toMatchObject({
      authenticated: true,
      userId: '99',
      account: { account: 'cli@example.com', nickname: 'CLI User' },
    })

    const logout = await runCli(['logout'], root, home, account.baseUrl)
    expect(logout.code).toBe(0)
    expect(logout.stdout).toContain('Signed out')
    await expect(access(payload.credentialPath)).rejects.toThrow()

    const afterLogout = await runCli(['whoami'], root, home, account.baseUrl)
    expect(afterLogout.code).toBe(1)
    expect(afterLogout.stderr).toContain('Not signed in')
  })

  it('reports an unauthenticated whoami without touching the server', async () => {
    const { root, home } = await workspace()
    const account = await startAccountServer()

    const whoami = await runCli(['whoami'], root, home, account.baseUrl)
    expect(whoami.code).toBe(1)
    expect(whoami.stderr).toContain('Run `spark login` first')
    expect(account.requests).toHaveLength(0)
  })

  it('clears an expired session and asks for a new login', async () => {
    const { root, home } = await workspace()
    const account = await startAccountServer({ sessionMode: 'unauthorized' })

    const login = await runCli(['login', '--no-browser'], root, home, account.baseUrl)
    expect(login.code).toBe(0)
    expect(login.stderr).toContain('cannot read the account profile')
    expect(login.stdout).toContain('Signed in as user 99')

    const whoami = await runCli(['whoami'], root, home, account.baseUrl)
    expect(whoami.code).toBe(1)
    expect(whoami.stderr).toContain('session expired')
    await expect(access(resolve(home, 'credentials.json'))).rejects.toThrow()
  })

  it('keeps the stored session when the account server is unreachable', async () => {
    const { root, home } = await workspace()
    const account = await startAccountServer()

    const login = await runCli(['login', '--no-browser', '--json'], root, home, account.baseUrl)
    expect(login.code).toBe(0)
    const credentialPath = resolve(home, 'credentials.json')
    await expect(access(credentialPath)).resolves.toBeUndefined()

    await account.close()

    const whoami = await runCli(['whoami'], root, home, account.baseUrl)
    expect(whoami.code).toBe(1)
    expect(whoami.stderr).toContain('Cannot reach the Spark account server')
    expect(whoami.stderr).not.toContain('session expired')
    // A network outage must not throw away a still-valid login.
    await expect(access(credentialPath)).resolves.toBeUndefined()
  })

  it('rejects extra arguments before starting a login', async () => {
    const { root, home } = await workspace()
    const account = await startAccountServer()

    const result = await runCli(['login', '--no-browser', 'extra'], root, home, account.baseUrl)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('does not accept extra arguments')
    expect(account.requests).toHaveLength(0)
  })
})
