#!/usr/bin/env node

const path = require('path')
const { inspectWindowsAuthenticode } = require('./package-windows-native-host.js')
const {
  detectWindowsPeArchitecture,
  parseArguments,
  readArtifactFile,
  runFinalAppSmoke,
  validatePackagedNativeHost,
} = require('./verify-packaged-native-host.js')

// A cold connection can inspect both the App and Host signatures (2 × 120s) before the 20s
// protocol handshake, and packaged diagnostics may perform one bounded reconnect. Keep the
// outer release gate long enough for both attempts while still terminating deterministically.
const WINDOWS_RELEASE_SMOKE_TIMEOUT_MS = 600_000

async function verifyPackagedWindowsNativeHost(options) {
  const appDirectory = path.resolve(options.appDirectory)
  const provenanceRoot = path.join(
    appDirectory,
    'resources',
    'native-host',
    `windows-${options.architecture}`,
  )
  const executablePath = path.join(provenanceRoot, 'SparkComputerHost.exe')
  const contract = await validatePackagedNativeHost({
    platform: 'windows',
    architecture: options.architecture,
    executablePath,
    manifestPath: path.join(provenanceRoot, 'manifest.json'),
    buildInfoPath: path.join(provenanceRoot, 'native-host-build.json'),
    allowLocal: options.allowLocal,
  })
  const appExecutable = path.join(appDirectory, 'SparkWork.exe')
  const hostArchitecture = detectWindowsPeArchitecture(await readArtifactFile(executablePath))
  const appArchitecture = detectWindowsPeArchitecture(await readArtifactFile(appExecutable))
  if (hostArchitecture !== options.architecture || appArchitecture !== options.architecture) {
    throw new Error('Windows App or Native Host PE architecture does not match the release target')
  }

  if (!options.allowLocal) {
    const expectedPublisherThumbprint = contract.manifest.signingPublisherThumbprint
    const hostSignature = await inspectWindowsAuthenticode(executablePath, {
      expectedPublisherThumbprint,
    })
    const appSignature = await inspectWindowsAuthenticode(appExecutable, {
      expectedPublisherThumbprint,
    })
    if (!hostSignature.timestamped || !appSignature.timestamped) {
      throw new Error('Windows App and Native Host must both have RFC 3161 timestamps')
    }
  }

  await runFinalAppSmoke({
    appExecutable,
    platform: 'windows',
    architecture: options.architecture,
    timeoutMs: WINDOWS_RELEASE_SMOKE_TIMEOUT_MS,
  })
  return contract
}

if (require.main === module) {
  const args = parseArguments(process.argv.slice(2), ['app-dir', 'arch'])
  verifyPackagedWindowsNativeHost({
    appDirectory: args['app-dir'],
    architecture: args.arch,
    allowLocal: args.allowLocal === true,
  })
    .then(() => console.log('[release-verify] Windows Native Host and final App handshake passed'))
    .catch((error) => {
      console.error(
        `[release-verify] Windows failed: ${error instanceof Error ? error.message : error}`,
      )
      process.exitCode = 1
    })
}

module.exports = { WINDOWS_RELEASE_SMOKE_TIMEOUT_MS, verifyPackagedWindowsNativeHost }
