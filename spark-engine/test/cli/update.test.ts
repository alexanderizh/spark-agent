import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..', '..')
const distMain = join(packageRoot, 'dist', 'cli', 'main.js')
const nodeDir = dirname(process.execPath)

const posixOnly = it.skipIf(process.platform === 'win32')

interface Artifact {
  readonly version: string
  readonly path: string
  readonly bytes: Buffer
  readonly sha256: string
}

let server: Server | undefined
let serverUrl = ''
let serveDir = ''
let baseTarball: Artifact
let variants: Record<string, Artifact>
let templatePrefix = ''
let npmCache = ''
let packageVersion = ''

const fixtureRoots: string[] = []
const caseRoots: string[] = []

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'spark-update-e2e-'))
  fixtureRoots.push(root)
  serveDir = join(root, 'release')
  await mkdir(serveDir, { recursive: true })
  npmCache = join(root, 'npm-cache')
  packageVersion = (
    JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version: string }
  ).version

  baseTarball = await packVariant({ version: packageVersion })
  // Variant versions derive from the real package version so a package.json
  // bump can never collide with the fixtures ("next" must stay an upgrade).
  const bumpMinor = (version: string): string => {
    const [major, minor] = version.split('.')
    return `${major}.${Number(minor) + 1}.0`
  }
  const nextVersion = bumpMinor(packageVersion)
  // Strict-SemVer-safe offsets beyond "next" for the tamper fixtures.
  const offsetVersion = (offset: number): string => {
    const [major, minor] = packageVersion.split('.')
    return `${major}.${Number(minor) + 1 + offset}.0`
  }
  variants = {
    next: await packVariant({ version: nextVersion }),
    older: await packVariant({ version: '0.0.9' }),
    rc: await packVariant({ version: `${nextVersion}-rc.1` }),
    evil: await packVariant({ version: offsetVersion(2), name: '@evil/agent' }),
    mismatch: await packVariant({ version: offsetVersion(3) }),
    engines: await packVariant({ version: offsetVersion(4), engines: '>=99.0.0 <100' }),
  }

  templatePrefix = join(root, 'template-prefix')
  await mkdir(templatePrefix, { recursive: true })
  await npmWithCache(
    ['install', '-g', '--prefix', templatePrefix, '--no-audit', '--no-fund', baseTarball.path],
    templatePrefix,
  )

  server = createServer((request, response) => {
    void (async () => {
      const requested = request.url?.split('?')[0]?.replace(/^\//u, '') ?? ''
      try {
        const body = await readFile(join(serveDir, requested))
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
  await new Promise<void>((resolveListen) => server!.listen(0, '127.0.0.1', resolveListen))
  const address = server.address() as AddressInfo
  serverUrl = `http://127.0.0.1:${address.port}`
}, 300_000)

afterAll(async () => {
  await new Promise<void>((resolveClose) =>
    server?.close(() => {
      resolveClose()
    }),
  )
  for (const root of fixtureRoots.splice(0)) await rm(root, { recursive: true, force: true })
})
afterEach(async () => {
  for (const root of caseRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function packVariant(options: {
  version: string
  name?: string
  engines?: string
}): Promise<Artifact> {
  const source = await mkdtemp(join(tmpdir(), 'spark-variant-'))
  fixtureRoots.push(source)
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const overridden: Record<string, unknown> = { ...manifest, version: options.version }
  if (options.name !== undefined) overridden.name = options.name
  if (options.engines !== undefined) overridden.engines = { node: options.engines }
  await writeFile(join(source, 'package.json'), JSON.stringify(overridden, null, 2))
  for (const entry of ['dist', 'README.md', 'LICENSE']) {
    if ((await stat(join(packageRoot, entry)).catch(() => undefined)) === undefined) continue
    await execute('cp', ['-a', join(packageRoot, entry), join(source, entry)])
  }
  const out = join(source, 'pack-out')
  await mkdir(out, { recursive: true })
  const pack = await execute('npm', ['pack', '--pack-destination', out, '--json'], { cwd: source })
  const filename = (JSON.parse(pack.stdout) as { filename: string }[])[0]?.filename
  if (!filename) throw new Error('npm pack produced no tarball')
  const bytes = await readFile(join(out, filename))
  return {
    version: options.version,
    path: join(out, filename),
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

/** Publishes a release into the static server directory. */
async function publish(version: string, bytes: Buffer, sha256: string): Promise<void> {
  const filename = `spark-agent-${version}.tgz`
  await writeFile(join(serveDir, filename), bytes)
  await writeFile(
    join(serveDir, 'latest.json'),
    `${JSON.stringify({
      name: '@spark/agent',
      version,
      sha256,
      tarball: filename,
      publishedAt: '2026-08-26T12:00:00.000Z',
    })}\n`,
  )
  await writeFile(join(serveDir, `${filename}.sha256`), `${sha256}  ${filename}\n`)
}

/** Adds versioned artifacts without moving latest.json (for --target pins). */
async function publishSidecarOnly(version: string, bytes: Buffer, sha256: string): Promise<void> {
  const filename = `spark-agent-${version}.tgz`
  await writeFile(join(serveDir, filename), bytes)
  await writeFile(join(serveDir, `${filename}.sha256`), `${sha256}  ${filename}\n`)
}

async function npmWithCache(args: readonly string[], cwd: string): Promise<void> {
  await execute('npm', [...args], { cwd, env: { ...process.env, npm_config_cache: npmCache } })
}

interface CaseEnv {
  readonly prefix: string
  readonly home: string
  readonly cwd: string
}

/** Copies the warm template install into a fresh prefix for one test case. */
async function freshCase(): Promise<CaseEnv> {
  const root = await mkdtemp(join(tmpdir(), 'spark-update-case-'))
  caseRoots.push(root)
  const prefix = join(root, 'prefix')
  await execute('cp', ['-a', templatePrefix, prefix])
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  await mkdir(join(home, 'lock'), { recursive: true })
  await mkdir(cwd, { recursive: true })
  return { prefix, home, cwd }
}

function caseEnvironment(test: CaseEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SPARK_HOME: test.home,
    npm_config_prefix: test.prefix,
    npm_config_cache: npmCache,
    // Isolates the update lock away from the developer's real ~/.spark.
    SPARK_UPDATE_LOCK_DIR: join(test.home, 'lock'),
    PATH: [nodeDir, join(test.prefix, 'bin'), join(test.home, 'bin'), process.env.PATH ?? ''].join(
      ':',
    ),
  }
}

/** Minimal environment for check-only runs from the repo build. */
function checkEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SPARK_HOME: join(tmpdir(), 'spark-check-home'),
    npm_config_prefix: join(tmpdir(), 'spark-check-prefix'),
  }
}

async function runSpark(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return runBinary(process.execPath, [distMain, ...args], { env: environment, cwd })
}

/** Runs any binary and captures the result without failing on non-zero codes. */
async function runBinary(
  binary: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string },
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(binary, [...args], {
    cwd: options.cwd,
    env: options.env,
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

async function prefixSparkVersion(test: CaseEnv): Promise<string> {
  const result = await execute(join(test.prefix, 'bin', 'spark'), ['--version'], {
    env: caseEnvironment(test),
    cwd: test.cwd,
  })
  return result.stdout.trim()
}

function npmRootOf(prefix: string): string {
  return join(prefix, 'lib', 'node_modules')
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe('spark update — check contract (no side effects)', () => {
  it('exit 0 + JSON when an update is available', async () => {
    await publish(variants.next!.version, variants.next!.bytes, variants.next!.sha256)
    const result = await runSpark(
      ['update', '--check', '--json', '--base', serverUrl],
      checkEnvironment(),
      packageRoot,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout.trim()) as {
      status: string
      current: string
      latest: string
    }
    expect(payload).toMatchObject({
      status: 'update_available',
      current: packageVersion,
      latest: variants.next!.version,
    })
  })

  it('exit 1 for up-to-date, older remote, and gated prerelease', async () => {
    const environment = checkEnvironment()
    await publish(baseTarball.version, baseTarball.bytes, baseTarball.sha256)
    const same = await runSpark(
      ['update', '--check', '--json', '--base', serverUrl],
      environment,
      packageRoot,
    )
    expect(same.code).toBe(1)
    expect((JSON.parse(same.stdout.trim()) as { status: string }).status).toBe('up_to_date')

    await publish(variants.older!.version, variants.older!.bytes, variants.older!.sha256)
    const older = await runSpark(
      ['update', '--check', '--json', '--base', serverUrl],
      environment,
      packageRoot,
    )
    expect(older.code).toBe(1)
    expect((JSON.parse(older.stdout.trim()) as { status: string }).status).toBe('remote_older')

    await publish(variants.rc!.version, variants.rc!.bytes, variants.rc!.sha256)
    const prerelease = await runSpark(
      ['update', '--check', '--json', '--base', serverUrl],
      environment,
      packageRoot,
    )
    expect(prerelease.code).toBe(1)
    expect((JSON.parse(prerelease.stdout.trim()) as { status: string }).status).toBe(
      'prerelease_available',
    )
  })

  it('exit 3 with a failed JSON line when the manifest is corrupt', async () => {
    await writeFile(join(serveDir, 'latest.json'), '{"name":"@evil/agent","version":"9.9.9"}')
    const result = await runSpark(
      ['update', '--check', '--json', '--base', serverUrl],
      checkEnvironment(),
      packageRoot,
    )
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('spark update failed')
    expect((JSON.parse(result.stdout.trim()) as { status: string }).status).toBe('failed')
  })

  it('exit 3 when the release server is unreachable', async () => {
    const result = await runSpark(
      ['update', '--check', '--json', '--base', 'http://127.0.0.1:1'],
      checkEnvironment(),
      packageRoot,
    )
    expect(result.code).toBe(3)
    expect((JSON.parse(result.stdout.trim()) as { status: string }).status).toBe('failed')
  })

  it('upgrade is an alias of update', async () => {
    await publish(variants.next!.version, variants.next!.bytes, variants.next!.sha256)
    const result = await runSpark(
      ['upgrade', '--check', '--json', '--base', serverUrl],
      checkEnvironment(),
      packageRoot,
    )
    expect(result.code).toBe(0)
    expect((JSON.parse(result.stdout.trim()) as { status: string }).status).toBe('update_available')
  })

  it('checks a pinned version through the checksum sidecar', async () => {
    const next = variants.next!
    await publish(next.version, next.bytes, next.sha256)
    const result = await runSpark(
      ['update', '--check', '--json', '--base', serverUrl, '--target', variants.next!.version],
      checkEnvironment(),
      packageRoot,
    )
    expect(result.code).toBe(0)
    expect((JSON.parse(result.stdout.trim()) as { status: string; pinned: boolean }).pinned).toBe(
      true,
    )
  })

  it('rejects an unparsable --target', async () => {
    const result = await runSpark(
      ['update', '--check', '--base', serverUrl, '--target', 'latest'],
      checkEnvironment(),
      packageRoot,
    )
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('strict SemVer')
  })
})

describe('spark update — apply transaction (real npm prefix)', () => {
  posixOnly(
    'upgrades to the next release and leaves a healthy install',
    async () => {
      const next = variants.next!
      await publish(next.version, next.bytes, next.sha256)
      const test = await freshCase()
      const result = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.stderr).toBe('')
      expect(result.code).toBe(0)
      const payload = JSON.parse(result.stdout.trim()) as {
        status: string
        current: string
        latest: string
        root: string
      }
      expect(payload).toMatchObject({
        status: 'updated',
        current: packageVersion,
        latest: variants.next!.version,
      })
      expect(payload.root).toBe(join(npmRootOf(test.prefix), '@spark', 'agent'))

      expect(await prefixSparkVersion(test)).toBe(variants.next!.version)
      const manifest = JSON.parse(
        await readFile(join(npmRootOf(test.prefix), '@spark', 'agent', 'package.json'), 'utf8'),
      ) as { version: string }
      expect(manifest.version).toBe(variants.next!.version)
      // Dependencies must be resolvable: hoisted to the global root or nested
      // inside the installed package, depending on the npm strategy.
      const nestedZod = join(
        npmRootOf(test.prefix),
        '@spark',
        'agent',
        'node_modules',
        'zod',
        'package.json',
      )
      expect(
        (await exists(join(npmRootOf(test.prefix), 'zod', 'package.json'))) ||
          (await exists(nestedZod)),
      ).toBe(true)
      // No transaction leftovers.
      const scopeEntries = (await execute('ls', [join(npmRootOf(test.prefix), '@spark')])).stdout
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean)
      expect(scopeEntries).toEqual(['agent'])
    },
    240_000,
  )

  posixOnly(
    'keeps the old version on checksum mismatch',
    async () => {
      const next = variants.next!
      await publish(next.version, next.bytes, 'f'.repeat(64))
      const test = await freshCase()
      const result = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code).toBe(3)
      expect(result.stderr).toContain('checksum mismatch')
      expect(await prefixSparkVersion(test)).toBe(packageVersion)
    },
    240_000,
  )

  posixOnly(
    'keeps the old version when the tarball identity is foreign',
    async () => {
      const evil = variants.evil!
      await publish(evil.version, evil.bytes, evil.sha256)
      const test = await freshCase()
      const result = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code).toBe(3)
      expect(result.stderr).toContain('identity')
      expect(await prefixSparkVersion(test)).toBe(packageVersion)
    },
    240_000,
  )

  posixOnly(
    'keeps the old version when the tarball version disagrees with the manifest',
    async () => {
      const mismatch = variants.mismatch!
      await publish('0.2.3', mismatch.bytes, mismatch.sha256)
      const test = await freshCase()
      const result = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code).toBe(3)
      expect(result.stderr).toContain(variants.mismatch!.version)
      expect(await prefixSparkVersion(test)).toBe(packageVersion)
    },
    240_000,
  )

  posixOnly(
    'keeps the old version when Node engines are incompatible',
    async () => {
      const engines = variants.engines!
      await publish(engines.version, engines.bytes, engines.sha256)
      const test = await freshCase()
      const result = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code).toBe(3)
      expect(result.stderr).toContain('Node.js runtime')
      expect(await prefixSparkVersion(test)).toBe(packageVersion)
    },
    240_000,
  )

  posixOnly(
    'installs a prerelease only with --allow-prerelease',
    async () => {
      const rc = variants.rc!
      await publish(rc.version, rc.bytes, rc.sha256)
      const test = await freshCase()
      const refused = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(refused.code).toBe(1)
      expect((JSON.parse(refused.stdout.trim()) as { status: string }).status).toBe(
        'prerelease_available',
      )
      expect(await prefixSparkVersion(test)).toBe(packageVersion)

      const allowed = await runSpark(
        ['update', '--json', '--base', serverUrl, '--allow-prerelease'],
        caseEnvironment(test),
        test.cwd,
      )
      expect(allowed.code).toBe(0)
      expect(await prefixSparkVersion(test)).toBe(variants.rc!.version)
    },
    240_000,
  )

  posixOnly(
    'applies an explicit pinned downgrade with a note',
    async () => {
      const next = variants.next!
      const older = variants.older!
      await publish(next.version, next.bytes, next.sha256)
      await publishSidecarOnly(older.version, older.bytes, older.sha256)
      const test = await freshCase()
      const result = await runSpark(
        ['update', '--json', '--base', serverUrl, '--target', '0.0.9'],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0)
      expect(await prefixSparkVersion(test)).toBe('0.0.9')

      // Idempotency is observed through the installed launcher: the repo build
      // that drove the update always reports the repo version, while the
      // prefix's own spark resolves the downgraded install.
      const again = await runBinary(
        join(test.prefix, 'bin', 'spark'),
        ['update', '--target', '0.0.9', '--base', serverUrl],
        {
          env: caseEnvironment(test),
          cwd: test.cwd,
        },
      )
      expect(again.stdout, `code=${again.code} stderr=${again.stderr}`).toContain('up to date')
    },
    240_000,
  )

  posixOnly(
    'exits 4 while another update holds the lock',
    async () => {
      const next = variants.next!
      await publish(next.version, next.bytes, next.sha256)
      const test = await freshCase()
      await writeFile(join(test.home, 'lock', 'update.lock'), '{"pid":1}\n')
      const result = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code).toBe(4)
      expect((JSON.parse(result.stdout.trim()) as { status: string }).status).toBe('locked')
      expect(await prefixSparkVersion(test)).toBe(packageVersion)
    },
    240_000,
  )

  posixOnly(
    'retakes a stale lock and completes the update',
    async () => {
      const next = variants.next!
      await publish(next.version, next.bytes, next.sha256)
      const test = await freshCase()
      const lockPath = join(test.home, 'lock', 'update.lock')
      await writeFile(lockPath, '{"pid":1}\n')
      const old = Date.now() / 1000 - 3600
      await utimes(lockPath, old, old)
      const result = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code).toBe(0)
      expect(await prefixSparkVersion(test)).toBe(variants.next!.version)
    },
    240_000,
  )

  posixOnly(
    'serializes two concurrent updates through the lock',
    async () => {
      const next = variants.next!
      await publish(next.version, next.bytes, next.sha256)
      const test = await freshCase()
      const env = caseEnvironment(test)
      const [first, second] = await Promise.all([
        runSpark(['update', '--json', '--base', serverUrl], env, test.cwd),
        runSpark(['update', '--json', '--base', serverUrl], env, test.cwd),
      ])
      expect([first.code, second.code].sort()).toEqual([0, 4])
      expect(await prefixSparkVersion(test)).toBe(variants.next!.version)
    },
    240_000,
  )

  posixOnly(
    'updates the package but never clobbers a foreign bin entry',
    async () => {
      const next = variants.next!
      await publish(next.version, next.bytes, next.sha256)
      const test = await freshCase()
      const foreign = join(test.prefix, 'bin', 'spark')
      await rm(foreign)
      await writeFile(foreign, '#!/bin/sh\necho foreign-spark\n')
      await chmod(foreign, 0o755)

      const result = await runSpark(
        ['update', '--json', '--base', serverUrl],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code).toBe(0)
      const payload = JSON.parse(result.stdout.trim()) as { warnings: string[] }
      expect(payload.warnings.join(' ')).toContain('not a spark launcher')
      expect(await readFile(foreign, 'utf8')).toContain('foreign-spark')
      const manifest = JSON.parse(
        await readFile(join(npmRootOf(test.prefix), '@spark', 'agent', 'package.json'), 'utf8'),
      ) as { version: string }
      expect(manifest.version).toBe(variants.next!.version)
      // The ~/.spark/bin launcher still gives access to the new version.
      const viaHome = await execute(join(test.home, 'bin', 'spark'), ['--version'], {
        env: caseEnvironment(test),
        cwd: test.cwd,
      })
      expect(viaHome.stdout.trim()).toBe(variants.next!.version)
    },
    240_000,
  )
})

describe('spark uninstall --package', () => {
  posixOnly(
    'removes only provably-spark files and keeps user data',
    async () => {
      const test = await freshCase()
      const env = caseEnvironment(test)
      const prefixSpark = join(test.prefix, 'bin', 'spark')
      const linked = await execute(prefixSpark, ['install', '--bin', join(test.home, 'bin')], {
        env,
        cwd: test.cwd,
      })
      expect(linked.stdout).toContain('Installed launcher:')
      await writeFile(join(test.home, 'config.toml'), '[agent]\nmodel = "x"\n')
      await mkdir(join(test.home, 'sessions'), { recursive: true })
      await writeFile(join(test.home, 'sessions', 'keep.jsonl'), '{}\n')
      const foreignDir = join(test.cwd, 'foreign-bin')
      await mkdir(foreignDir, { recursive: true })
      await writeFile(join(foreignDir, 'spark'), '#!/bin/sh\necho keep-me\n')
      await chmod(join(foreignDir, 'spark'), 0o755)

      const result = await execute(
        prefixSpark,
        ['uninstall', '--package', '--bin', join(test.home, 'bin'), '--json'],
        { env, cwd: test.cwd },
      )
      const payload = JSON.parse(result.stdout.trim()) as { status: string; removed: string[] }
      expect(payload.status).toBe('removed')
      expect(payload.removed.join('\n')).toContain(join(npmRootOf(test.prefix), '@spark', 'agent'))
      expect(payload.removed.join('\n')).toContain(join(test.prefix, 'bin', 'spark'))
      expect(payload.removed.join('\n')).toContain(join(test.home, 'bin', 'spark'))

      expect(await exists(join(npmRootOf(test.prefix), '@spark', 'agent'))).toBe(false)
      expect(await readFile(join(test.home, 'config.toml'), 'utf8')).toContain('model = "x"')
      expect(await readFile(join(test.home, 'sessions', 'keep.jsonl'), 'utf8')).toBe('{}\n')
      expect(await readFile(join(foreignDir, 'spark'), 'utf8')).toContain('keep-me')
    },
    240_000,
  )

  posixOnly(
    'is a clean no-op when nothing spark-owned exists',
    async () => {
      const test = await freshCase()
      await rm(join(npmRootOf(test.prefix), '@spark', 'agent'), { recursive: true, force: true })
      // The prefix launcher is now dangling, so drive the CLI from the repo
      // build with the case prefix still configured as the npm target.
      const result = await runSpark(
        ['uninstall', '--package', '--bin', join(test.home, 'bin'), '--json'],
        caseEnvironment(test),
        test.cwd,
      )
      expect(result.code).toBe(0)
      expect((JSON.parse(result.stdout.trim()) as { status: string }).status).toBe('absent')
    },
    120_000,
  )
})
