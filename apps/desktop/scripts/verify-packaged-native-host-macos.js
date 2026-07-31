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
    await requireSuccess('/usr/sbin/spctl', ['-a', '-vv', '--type', 'execute', appPath])
    await requireSuccess('/usr/bin/xcrun', ['stapler', 'validate', appPath])
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

module.exports = { parseMacSignatureOutput, verifyPackagedMacNativeHost }
