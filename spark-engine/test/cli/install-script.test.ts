import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
// Always in lockstep with the package that `npm pack` just produced.
const packageVersion = (
  JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version: string }
).version
const roots: string[] = []
const closers: (() => Promise<void>)[] = []
const nodeDir = dirname(process.execPath)

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('install.sh one-line installer', () => {
  it('downloads, verifies, installs with npm, and leaves a runnable spark', async () => {
    const fixture = await createReleaseFixture()
    const environment = installerEnvironment(fixture)

    const result = await runInstaller(['--base', fixture.baseUrl], environment)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Checksum verified')
    expect(result.stdout).toContain(`Spark CLI v${packageVersion} installed`)
    // The npm bin dir is not on PATH in this environment, so the installer must
    // also have linked the ~/.spark/bin launcher.
    expect(result.stdout).toContain('linking a launcher instead')

    const version = await execute(join(fixture.prefix, 'bin', 'spark'), ['--version'], {
      env: environment,
    })
    expect(version.stdout.trim()).toBe(packageVersion)
  }, 240_000)

  it('rejects a tarball whose checksum does not match the manifest', async () => {
    const fixture = await createReleaseFixture()
    const manifestPath = join(fixture.staging, 'latest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { sha256: string }
    manifest.sha256 = manifest.sha256.startsWith('0') ? 'f'.repeat(64) : '0'.repeat(64)
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')

    const result = await runInstaller(['--base', fixture.baseUrl], installerEnvironment(fixture))
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('checksum mismatch')
  })

  it('installs from a local tarball with no network download', async () => {
    const fixture = await createReleaseFixture()
    const environment = installerEnvironment(fixture)

    const result = await runInstaller(['--tarball', fixture.tarballPath], environment)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`Spark CLI v${packageVersion} installed`)
    const version = await execute(join(fixture.prefix, 'bin', 'spark'), ['--version'], {
      env: environment,
    })
    expect(version.stdout.trim()).toBe(packageVersion)
  }, 240_000)

  it('installs a pinned version using the checksum sidecar', async () => {
    const fixture = await createReleaseFixture()
    const result = await runInstaller(
      ['--base', fixture.baseUrl, '--version', packageVersion],
      installerEnvironment(fixture),
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Checksum verified')
    expect(result.stdout).toContain(`Spark CLI v${packageVersion} installed`)
  }, 240_000)

  it('fails closed on an unusable release base before touching npm', async () => {
    // The installer now ships a built-in default base, so the no-flag path is
    // legitimate; the fail-closed contract is exercised with a bogus scheme.
    const result = await runInstaller(['--base', 'ftp://releases.example.com'], {
      ...process.env,
      SPARK_HOME: await tempRoot(),
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('must be an http(s) URL')
  })
})

interface ReleaseFixture {
  readonly baseUrl: string
  readonly staging: string
  readonly tarballPath: string
  readonly prefix: string
  readonly home: string
}

async function createReleaseFixture(): Promise<ReleaseFixture> {
  const root = await tempRoot()
  const staging = join(root, 'release')
  const prefix = join(root, 'prefix')
  const home = join(root, 'home')
  await mkdir(staging, { recursive: true })
  await mkdir(prefix, { recursive: true })
  await mkdir(home, { recursive: true })

  const pack = await execute('npm', ['pack', '--pack-destination', staging, '--json'], {
    cwd: process.cwd(),
  })
  const filename = (JSON.parse(pack.stdout) as { filename: string }[])[0]?.filename
  if (!filename?.endsWith('.tgz')) throw new Error('npm pack returned no tarball')
  const tarballPath = join(staging, filename)
  const sha256 = createHash('sha256')
    .update(await readFile(tarballPath))
    .digest('hex')
  await writeFile(join(staging, `${filename}.sha256`), `${sha256}  ${filename}\n`, 'utf8')
  await writeFile(
    join(staging, 'latest.json'),
    `${JSON.stringify({ name: '@spark/agent', version: packageVersion, sha256, tarball: filename })}\n`,
    'utf8',
  )

  const server = createServer((request, response) => {
    void (async () => {
      const requested = request.url?.split('?')[0]?.replace(/^\//u, '') ?? ''
      try {
        const body = await readFile(join(staging, requested))
        response.writeHead(200, {
          'content-type': requested.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream',
        })
        response.end(body)
      } catch {
        response.writeHead(404).end()
      }
    })()
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('release server failed to bind')
  closers.push(() => {
    return new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose()
      })
    })
  })
  return { baseUrl: `http://127.0.0.1:${address.port}`, staging, tarballPath, prefix, home }
}

function installerEnvironment(fixture: ReleaseFixture): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SPARK_HOME: fixture.home,
    npm_config_prefix: fixture.prefix,
    npm_config_cache: join(fixture.prefix, 'npm-cache'),
    PATH: [nodeDir, '/usr/bin:/bin', process.env.PATH ?? ''].join(':'),
  }
}

async function runInstaller(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const child = spawn('sh', [join(process.cwd(), 'install.sh'), ...args], {
    env: environment,
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

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-installer-'))
  roots.push(root)
  return root
}
