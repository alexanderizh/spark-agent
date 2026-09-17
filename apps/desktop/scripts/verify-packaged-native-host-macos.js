#!/usr/bin/env node

const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const {
  parseArguments,
  runCommand,
  runFinalAppSmoke,
  validatePackagedNativeHost,
} = require('./verify-packaged-native-host.js')

// `spctl` 与 `xcrun stapler validate` 都要联网向 Apple 核验公证状态：票据较大时
// stapler 会先从 api.apple-cloudkit.com 的 ticket-delivery 端点下载真实票据再校验。
// Apple 侧偶发网络超时会直接判死整条发布流水线（0.11.74 的 mac-x64 就是这样失败
// 并需要人工重跑的），而这两个命令都是只读、幂等的，因此对明确的网络瞬时错误做
// 有界重试。真正的签名/公证缺陷不带网络错误特征，会立即上报，不会被重试掩盖。
const CONNECTED_VERIFICATION_MAX_ATTEMPTS = 3
const CONNECTED_VERIFICATION_INITIAL_DELAY_MS = 10_000
const TRANSIENT_NETWORK_FAILURE_PATTERN =
  /NSURLError|timed out|timeout|connection|network|temporarily unavailable|try again|ECONN|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|TLS|SSL|HTTP 5\d\d/i

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 判定错误信息是否属于 Apple 侧网络瞬时故障，而不是真实的签名/公证失败。 */
function isTransientNetworkFailure(message) {
  return TRANSIENT_NETWORK_FAILURE_PATTERN.test(String(message))
}

/**
 * 对只读核验做有界重试：仅当错误信息带网络瞬时特征时重试，其他错误原样抛出。
 * `sleep` 可注入，便于测试时不必真的等待。
 */
async function retryTransientNetworkFailures(operation, options = {}) {
  const maxAttempts = options.maxAttempts ?? CONNECTED_VERIFICATION_MAX_ATTEMPTS
  const initialDelayMs = options.initialDelayMs ?? CONNECTED_VERIFICATION_INITIAL_DELAY_MS
  const label = options.label ?? '联网核验'
  const sleep = options.sleep ?? delay

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= maxAttempts || !isTransientNetworkFailure(message)) throw error
      const attemptDelayMs = initialDelayMs * attempt
      console.warn(
        `[release-verify] ${label} 第 ${attempt}/${maxAttempts} 次失败（Apple 侧网络瞬时错误），已等待 ${Math.round(attemptDelayMs / 1000)} 秒后重试：${message}`,
      )
      await sleep(attemptDelayMs)
    }
  }
}

async function verifyPackagedMacNativeHost(options) {
  const appPath = path.resolve(options.appPath)
  const executablePath = path.join(appPath, 'Contents', 'Helpers', 'SparkComputerHost')
  const provenanceRoot = path.join(
    appPath,
    'Contents',
    'Resources',
    'native-host',
    `macos-${options.architecture}`,
  )
  const contract = await validatePackagedNativeHost({
    platform: 'macos',
    architecture: options.architecture,
    executablePath,
    manifestPath: path.join(provenanceRoot, 'manifest.json'),
    buildInfoPath: path.join(provenanceRoot, 'native-host-build.json'),
    allowLocal: options.allowLocal,
  })

  const executableMode = (await fs.lstat(executablePath)).mode & 0o777
  if (executableMode !== 0o755) {
    throw new Error(`macOS Native Host mode must be 0755, received 0${executableMode.toString(8)}`)
  }
  const expectedSlice = options.architecture === 'x64' ? 'x86_64' : 'arm64'
  await requireArchitecture(executablePath, expectedSlice)

  await verifyMacSignatures({
    appPath,
    executablePath,
    manifest: contract.manifest,
    allowLocal: options.allowLocal,
  })
  if (!options.allowLocal) {
    await requireConnectedSuccess(
      '/usr/sbin/spctl',
      ['-a', '-vv', '--type', 'execute', appPath],
      'spctl Gatekeeper 评估',
    )
    await requireConnectedSuccess(
      '/usr/bin/xcrun',
      ['stapler', 'validate', appPath],
      'stapler validate',
    )
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-native-applications-'))
  const installedAppPath = path.join(tempRoot, 'Applications', path.basename(appPath))
  try {
    await fs.mkdir(path.dirname(installedAppPath), { recursive: true })
    await requireSuccess('/usr/bin/ditto', [appPath, installedAppPath])
    const installedExecutablePath = path.join(
      installedAppPath,
      'Contents',
      'Helpers',
      'SparkComputerHost',
    )
    await validatePackagedNativeHost({
      platform: 'macos',
      architecture: options.architecture,
      executablePath: installedExecutablePath,
      manifestPath: path.join(
        installedAppPath,
        'Contents',
        'Resources',
        'native-host',
        `macos-${options.architecture}`,
        'manifest.json',
      ),
      buildInfoPath: path.join(
        installedAppPath,
        'Contents',
        'Resources',
        'native-host',
        `macos-${options.architecture}`,
        'native-host-build.json',
      ),
      allowLocal: options.allowLocal,
    })
    await verifyMacSignatures({
      appPath: installedAppPath,
      executablePath: installedExecutablePath,
      manifest: contract.manifest,
      allowLocal: options.allowLocal,
    })
    const appExecutable = path.join(installedAppPath, 'Contents', 'MacOS', 'Spark Agent')
    await requireArchitecture(appExecutable, expectedSlice)
    await runFinalAppSmoke({
      appExecutable,
      platform: 'macos',
      architecture: options.architecture,
    })
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
  return contract
}

async function verifyMacSignatures({ appPath, executablePath, manifest, allowLocal }) {
  await requireSuccess('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', executablePath])
  await requireSuccess('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    appPath,
  ])
  if (allowLocal) return
  const hostSignature = await inspectMacSignature(executablePath)
  const appSignature = await inspectMacSignature(appPath)
  if (
    hostSignature.identifier !== manifest.signingIdentifier ||
    hostSignature.teamIdentifier !== manifest.signingTeamIdentifier ||
    appSignature.teamIdentifier !== manifest.signingTeamIdentifier
  ) {
    throw new Error('macOS App, Native Host and manifest signing identities do not match')
  }
  if (!hostSignature.hardenedRuntime || !appSignature.hardenedRuntime) {
    throw new Error('macOS App and Native Host must both enable hardened runtime')
  }
}

async function inspectMacSignature(executablePath) {
  const result = await runCommand('/usr/bin/codesign', ['-d', '--verbose=4', executablePath])
  if (result.code !== 0) throw new Error(`Unable to inspect macOS signature: ${result.stderr}`)
  return parseMacSignatureOutput(`${result.stdout}\n${result.stderr}`)
}

function parseMacSignatureOutput(output) {
  const identifier = /^Identifier=(.+)$/m.exec(output)?.[1]?.trim()
  const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim()
  const flags = /^CodeDirectory .+ flags=(.+)$/m.exec(output)?.[1] ?? ''
  if (identifier == null || teamIdentifier == null) {
    throw new Error('macOS signature output is missing its identifier or Team ID')
  }
  return {
    identifier,
    teamIdentifier,
    hardenedRuntime: /(?:^|[,(])runtime(?:[),]|$)/.test(flags),
  }
}

async function requireArchitecture(executablePath, expectedSlice) {
  const result = await runCommand('/usr/bin/lipo', ['-archs', executablePath])
  const slices = result.stdout.trim().split(/\s+/)
  if (result.code !== 0 || slices.length !== 1 || slices[0] !== expectedSlice) {
    throw new Error(
      `Unexpected executable architecture for ${executablePath}: ${result.stdout.trim()}`,
    )
  }
}

async function requireSuccess(command, args) {
  const result = await runCommand(command, args)
  if (result.code !== 0) {
    throw new Error(`${command} verification failed: ${(result.stderr || result.stdout).trim()}`)
  }
}

/**
 * 与 requireSuccess 等价，但用于需要联网核验的只读命令：对 Apple 侧网络瞬时错误
 * （含 runCommand 自身超时中止）做有界重试，其他错误立即上报。
 */
async function requireConnectedSuccess(command, args, label) {
  await retryTransientNetworkFailures(
    async () => {
      const result = await runCommand(command, args)
      if (result.code !== 0) {
        throw new Error(
          `${command} verification failed: ${(result.stderr || result.stdout).trim()}`,
        )
      }
    },
    { label },
  )
}

if (require.main === module) {
  const args = parseArguments(process.argv.slice(2), ['app', 'arch'])
  verifyPackagedMacNativeHost({
    appPath: args.app,
    architecture: args.arch,
    allowLocal: args.allowLocal === true,
  })
    .then(() => console.log('[release-verify] macOS Native Host and final App handshake passed'))
    .catch((error) => {
      console.error(
        `[release-verify] macOS failed: ${error instanceof Error ? error.message : error}`,
      )
      process.exitCode = 1
    })
}

module.exports = {
  isTransientNetworkFailure,
  parseMacSignatureOutput,
  retryTransientNetworkFailures,
  verifyPackagedMacNativeHost,
}
