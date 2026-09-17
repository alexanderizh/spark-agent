import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const WORKFLOW_PATH = '.github/workflows/publish-desktop-release.yml'
const FUNCTION_CALL = 'run_mac_build_with_retry'
const FUNCTION_NAME = 'run_mac_build_with_retry() {'
const FUNCTION_INDENT = '          '
const FUNCTION_END = `\n${FUNCTION_INDENT}}\n`

// Apple 侧联网核验超时的真实片段（0.11.74 mac-x64 因此失败并需要人工重跑）。
const APPLE_TIMEOUT_OUTPUT = [
  'Processing: /tmp/Spark Agent.app',
  'error is Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."',
  'NSErrorFailingURLKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/public/records/lookup',
  'The validate action failed! Error 68.',
].join('\n')
const PERMANENT_OUTPUT = 'codesign verification failed: code object is not signed at all'
const HDIUTIL_BUSY_OUTPUT = 'Command failed: hdiutil detach /dev/disk7\nerror: Resource busy'

const hasBash = spawnSync('bash', ['-c', 'true']).status === 0

test(
  'retries the macOS build once on an Apple-side network failure',
  { skip: !hasBash },
  async () => {
    const result = await runGate({
      buildOutput: APPLE_TIMEOUT_OUTPUT,
      buildExitCodes: [1, 0],
    })

    assert.equal(result.status, 0)
    assert.equal(result.buildRuns, 2)
    assert.equal(result.retryReason, 'apple-network')
    assert.equal(result.hdiutilRuns, 0)
  },
)

test('does not retry a permanent macOS build failure', { skip: !hasBash }, async () => {
  const result = await runGate({
    buildOutput: PERMANENT_OUTPUT,
    buildExitCodes: [65, 0],
  })

  assert.equal(result.status, 65)
  assert.equal(result.buildRuns, 1)
  assert.equal(result.retryReason, null)
})

test('force-detaches busy disk images before the DMG retry', { skip: !hasBash }, async () => {
  const result = await runGate({
    buildOutput: HDIUTIL_BUSY_OUTPUT,
    buildExitCodes: [1, 0],
  })

  assert.equal(result.status, 0)
  assert.equal(result.buildRuns, 2)
  assert.equal(result.retryReason, 'dmg-detach')
  assert.equal(result.hdiutilRuns, 1)
})

test(
  'stops retrying after the bounded attempts when the network stays down',
  { skip: !hasBash },
  async () => {
    const result = await runGate({
      buildOutput: APPLE_TIMEOUT_OUTPUT,
      buildExitCodes: [1, 1],
    })

    assert.equal(result.status, 1)
    assert.equal(result.buildRuns, 2)
    assert.equal(result.retryReason, 'apple-network')
  },
)

async function runGate({ buildOutput, buildExitCodes }) {
  const root = await mkdtemp(join(tmpdir(), 'spark-mac-retry-gate-'))
  const scriptDir = join(root, 'apps', 'desktop', 'scripts')
  const binDir = join(root, 'bin')
  const runnerTemp = join(root, 'runner-temp')
  await Promise.all([
    mkdir(scriptDir, { recursive: true }),
    mkdir(join(root, 'apps', 'desktop', 'dist'), { recursive: true }),
    mkdir(binDir, { recursive: true }),
    mkdir(runnerTemp, { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(scriptDir, 'build-mac-release.sh'), buildStub, { mode: 0o755 }),
    writeFile(join(binDir, 'hdiutil'), hdiutilStub, { mode: 0o755 }),
    writeFile(join(root, 'scenario-output.txt'), buildOutput),
    writeFile(join(root, 'scenario-exit-1.txt'), String(buildExitCodes[0])),
    writeFile(join(root, 'scenario-exit-2.txt'), String(buildExitCodes[1])),
  ])
  await chmod(join(scriptDir, 'build-mac-release.sh'), 0o755)
  await chmod(join(binDir, 'hdiutil'), 0o755)
  await writeFile(join(root, 'gate.sh'), `${await extractRetryFunction()}\n${FUNCTION_CALL}\n`)

  const run = spawnSync('bash', ['-eo', 'pipefail', 'gate.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: runnerTemp,
      RUNNER_OS: 'macOS',
      PUBLISH_OPT: '--publish never',
    },
  })

  return {
    status: run.status,
    buildRuns: await countLines(root, 'trace-build.txt'),
    hdiutilRuns: await countLines(root, 'trace-hdiutil.txt'),
    retryReason:
      /\[retry\] Apple-side transient network failure \(([a-z-]+)\)/.exec(run.stdout)?.[1] ??
      (/\[retry\] DMG detach hit 'Resource busy'/.test(run.stdout) ? 'dmg-detach' : null),
  }
}

/**
 * 从真实 workflow 里抽出 retry 闸门函数，避免测试断言的是复制品而不是线上逻辑。
 * `${{ matrix.arch }}` 是 GitHub 表达式，替换成固定值后即可在本机 bash 中执行。
 */
async function extractRetryFunction() {
  const workflow = await readFile(WORKFLOW_PATH, 'utf8')
  const start = workflow.indexOf(`${FUNCTION_INDENT}${FUNCTION_NAME}`)
  assert.notEqual(start, -1, 'workflow 必须定义 run_mac_build_with_retry')
  const end = workflow.indexOf(FUNCTION_END, start)
  assert.notEqual(end, -1, 'run_mac_build_with_retry 必须有配对的结束花括号')
  return workflow.slice(start, end + FUNCTION_END.length).replaceAll('${{ matrix.arch }}', 'test')
}

async function countLines(root, name) {
  const content = await readFile(join(root, name), 'utf8').catch(() => '')
  return content.trim() === '' ? 0 : content.trim().split('\n').length
}

const buildStub = `#!/usr/bin/env bash
echo run >> trace-build.txt
attempts=$(cat scenario-attempts.txt 2>/dev/null || echo 0)
attempts=$((attempts + 1))
echo "\${attempts}" > scenario-attempts.txt
cat scenario-output.txt
exit "$(cat "scenario-exit-\${attempts}.txt")"
`

const hdiutilStub = `#!/usr/bin/env bash
echo "\${*}" >> trace-hdiutil.txt
exit 0
`
