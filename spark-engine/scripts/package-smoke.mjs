import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const packageRoot = resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'spark-package-smoke-'))
let modelServer

try {
  const pack = await execute('npm', ['pack', '--pack-destination', temporaryRoot, '--json'], {
    cwd: packageRoot,
  })
  const packResult = JSON.parse(pack.stdout)
  const filename = packResult[0]?.filename
  if (typeof filename !== 'string') throw new Error('npm pack did not return a tarball filename')

  const consumer = join(temporaryRoot, 'consumer')
  await mkdir(consumer)
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'spark-package-smoke', version: '1.0.0', private: true }),
  )
  await execute(
    'npm',
    ['install', '--no-audit', '--no-fund', '--omit=dev', join(temporaryRoot, filename)],
    { cwd: consumer },
  )
  modelServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(
      'event: response.output_text.delta\n' +
        'data: {"type":"response.output_text.delta","delta":"installed"}\n\n' +
        'event: response.completed\n' +
        'data: {"type":"response.completed","response":{"id":"resp_pack","status":"completed","output":[{"id":"msg_pack","type":"message","role":"assistant","content":[{"type":"output_text","text":"installed","annotations":[]}]}],"usage":{"input_tokens":2,"output_tokens":1}}}\n\n',
    )
  })
  await new Promise((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
  const address = modelServer.address()
  if (!address || typeof address === 'string') throw new Error('Package smoke model server failed')
  await mkdir(join(consumer, '.spark'))
  await writeFile(
    join(consumer, '.spark', 'config.toml'),
    `[agent]\nmodel = "local"\n\n[providers.local]\nprotocol = "openai-responses"\nbase_url = "http://127.0.0.1:${address.port}"\napi_key_env = "SPARK_SMOKE_KEY"\n\n[models.local]\nprovider = "local"\nmodel = "gpt-test"\n`,
  )
  const binary = join(consumer, 'node_modules', '.bin', 'spark')
  const run = await execute(binary, ['--json', 'standalone package smoke test'], {
    cwd: consumer,
    env: {
      ...process.env,
      SPARK_HOME: join(temporaryRoot, 'data'),
      SPARK_SMOKE_KEY: 'test-key',
      NO_COLOR: '1',
    },
  })
  const events = run.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const types = events.map((event) => event.type)
  const expected = [
    'session.started',
    'turn.started',
    'step.started',
    'assistant.completed',
    'turn.completed',
  ]
  if (JSON.stringify(types) !== JSON.stringify(expected)) {
    throw new Error(`Standalone package emitted an unexpected event stream: ${types.join(', ')}`)
  }
  const installedLicense = await readFile(
    join(consumer, 'node_modules', '@spark', 'agent', 'LICENSE'),
    'utf8',
  )
  if (!installedLicense.includes('Spark Agent Personal Use License')) {
    throw new Error('Standalone package is missing the complete project license')
  }

  // Formal PATH install: `spark install` links a launcher that must run from a
  // working directory with no relationship to the package or the repo.
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  const binDir = join(temporaryRoot, 'path-bin')
  const installRun = await execute(binary, ['install', '--bin', binDir], {
    cwd: consumer,
    env: { ...process.env, SPARK_HOME: join(temporaryRoot, 'data') },
  })
  if (!installRun.stdout.includes('Installed launcher:')) {
    throw new Error(`spark install failed in the packaged CLI: ${installRun.stderr}`)
  }
  const foreignCwd = join(temporaryRoot, 'foreign')
  await mkdir(foreignCwd)
  const launched = await execute(join(binDir, 'spark'), ['--version'], {
    cwd: foreignCwd,
    env: { ...process.env, SPARK_HOME: join(temporaryRoot, 'data') },
  })
  if (launched.stdout.trim() !== manifest.version) {
    throw new Error(`launcher reported ${launched.stdout.trim()} instead of ${manifest.version}`)
  }
  const uninstallRun = await execute(binary, ['uninstall', '--bin', binDir], {
    cwd: consumer,
    env: { ...process.env, SPARK_HOME: join(temporaryRoot, 'data') },
  })
  if (!uninstallRun.stdout.includes('Removed launcher')) {
    throw new Error(`spark uninstall failed in the packaged CLI: ${uninstallRun.stderr}`)
  }
  process.stdout.write(
    `Package smoke passed: ${filename}, ${String(packResult[0]?.size ?? '?')} bytes, ${events.length} events.\n`,
  )
} finally {
  await new Promise((resolveClose) => modelServer?.close(resolveClose) ?? resolveClose())
  await rm(temporaryRoot, { recursive: true, force: true })
}
