const { spawn } = require('child_process')
const { createHash } = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const { Arch } = require('builder-util')
const {
  NATIVE_HOST_PROTOCOL_VERSION,
  NATIVE_HOST_VERSION,
  createNativeHostBuildInfo,
  resolveBuildCommit,
} = require('./native-host-build-info.js')

const SIGNING_IDENTIFIER = 'com.spark-agent.desktop.computer-host'
const EXECUTABLE_NAME = 'SparkComputerHost'
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024

function parseCodeSignatureOutput(output) {
  const identifier = /^Identifier=(.+)$/m.exec(output)?.[1]?.trim()
  const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim()
  if (
    identifier !== SIGNING_IDENTIFIER ||
    teamIdentifier == null ||
    !/^[A-Z0-9]{10}$/.test(teamIdentifier)
  ) {
    throw new Error('Native Host signature does not contain a trusted identifier and Team ID')
  }
  return { identifier, teamIdentifier }
}

function createNativeHostManifest({ executable, architecture, signature }) {
  if (!Buffer.isBuffer(executable) || executable.length === 0) {
    throw new Error('Native Host executable is empty')
  }
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported Native Host architecture: ${architecture}`)
  }
  if (
    signature.identifier !== SIGNING_IDENTIFIER ||
    !/^[A-Z0-9]{10}$/.test(signature.teamIdentifier)
  ) {
    throw new Error('Native Host signature does not match the release identity')
  }
  return {
    schemaVersion: 1,
    protocolVersion: NATIVE_HOST_PROTOCOL_VERSION,
    hostVersion: NATIVE_HOST_VERSION,
    platform: 'macos',
    architecture,
    executableFileName: EXECUTABLE_NAME,
    sha256: createHash('sha256').update(executable).digest('hex'),
    signingIdentifier: signature.identifier,
    signingTeamIdentifier: signature.teamIdentifier,
  }
}

function createLocalNativeHostManifest({ executable, architecture }) {
  if (!Buffer.isBuffer(executable) || executable.length === 0) {
    throw new Error('Native Host executable is empty')
  }
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported Native Host architecture: ${architecture}`)
  }
  return {
    schemaVersion: 1,
    protocolVersion: NATIVE_HOST_PROTOCOL_VERSION,
    hostVersion: NATIVE_HOST_VERSION,
    trustMode: 'local',
    platform: 'macos',
    architecture,
    executableFileName: EXECUTABLE_NAME,
    sha256: createHash('sha256').update(executable).digest('hex'),
  }
}

async function packageMacNativeHost(context) {
  if (context.electronPlatformName !== 'darwin') return { packaged: false, reason: 'not-macos' }
  const architecture = Arch[context.arch]
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Native Host packaging does not support Electron architecture: ${architecture}`)
  }
  const requestedTrustMode = resolveMacNativeHostTrustMode(process.env)
  const signingIdentity = await resolveSigningIdentity(requestedTrustMode)
  if (requestedTrustMode === 'signed' && signingIdentity == null) {
    throw new Error('Signed macOS Native Host packaging requires a Developer ID identity')
  }
  const localTrust = requestedTrustMode === 'local' || signingIdentity == null

  const packageRoot = path.resolve(__dirname, '../native/macos/SparkComputerHost')
  const swiftArchitecture = architecture === 'x64' ? 'x86_64' : 'arm64'
  await runCommand(
    'swift',
    [
      'build',
      '-c',
      'release',
      '--arch',
      swiftArchitecture,
      ...(localTrust ? ['-Xswiftc', '-DSPARK_COMPUTER_LOCAL_TRUST'] : []),
    ],
    {
      cwd: packageRoot,
    },
  )
  const sourceExecutable = path.join(
    packageRoot,
    '.build',
    `${swiftArchitecture}-apple-macosx`,
    'release',
    EXECUTABLE_NAME,
  )
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const { destinationExecutable, manifestPath } = macNativeHostDestinationPaths(
    appPath,
    architecture,
  )
  await fs.mkdir(path.dirname(destinationExecutable), { recursive: true, mode: 0o755 })
  await fs.mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o755 })
  await fs.copyFile(sourceExecutable, destinationExecutable)
  await fs.chmod(destinationExecutable, 0o755)

  await runCommand('/usr/bin/codesign', [
    '--force',
    ...(localTrust ? [] : ['--options', 'runtime', '--timestamp']),
    '--identifier',
    SIGNING_IDENTIFIER,
    '--sign',
    localTrust ? '-' : signingIdentity,
    destinationExecutable,
  ])
  await runCommand('/usr/bin/codesign', [
    '--verify',
    '--strict',
    '--verbose=2',
    destinationExecutable,
  ])
  const executable = await fs.readFile(destinationExecutable)
  let manifest
  if (localTrust) {
    manifest = createLocalNativeHostManifest({ executable, architecture })
  } else {
    const details = await runCommand('/usr/bin/codesign', [
      '-d',
      '--verbose=4',
      destinationExecutable,
    ])
    const signature = parseCodeSignatureOutput(`${details.stdout}\n${details.stderr}`)
    if (
      process.env.APPLE_TEAM_ID != null &&
      process.env.APPLE_TEAM_ID !== signature.teamIdentifier
    ) {
      throw new Error('Native Host signing Team ID differs from APPLE_TEAM_ID')
    }
    manifest = createNativeHostManifest({ executable, architecture, signature })
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
  const buildInfoPath = path.join(path.dirname(manifestPath), 'native-host-build.json')
  const buildInfo = createNativeHostBuildInfo({
    platform: 'macos',
    architecture,
    trustMode: localTrust ? 'local' : 'signed',
    commit: resolveBuildCommit(process.env),
  })
  await fs.writeFile(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`, { mode: 0o644 })
  console.log(
    `[after-pack] Native Host: packaged ${architecture}, trust=${localTrust ? 'local' : 'signed'}, sha256=${manifest.sha256}`,
  )
  return { packaged: true, destinationExecutable, manifestPath, manifest, buildInfoPath, buildInfo }
}

function macNativeHostDestinationPaths(appPath, architecture) {
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported Native Host architecture: ${architecture}`)
  }
  return {
    destinationExecutable: path.join(appPath, 'Contents', 'Helpers', EXECUTABLE_NAME),
    manifestPath: path.join(
      appPath,
      'Contents',
      'Resources',
      'native-host',
      `macos-${architecture}`,
      'manifest.json',
    ),
  }
}

function resolveMacNativeHostTrustMode(environment = process.env) {
  const explicit = environment.SPARK_NATIVE_HOST_TRUST_MODE?.trim().toLowerCase()
  if (explicit === 'local' || explicit === 'signed') return explicit
  if (explicit != null && explicit !== '') {
    throw new Error('SPARK_NATIVE_HOST_TRUST_MODE must be signed or local')
  }
  if (environment.CSC_IDENTITY_AUTO_DISCOVERY?.trim().toLowerCase() === 'false') return 'local'
  if (environment.CSC_NAME?.trim()) return 'signed'
  return 'auto'
}

async function resolveSigningIdentity(requestedTrustMode = resolveMacNativeHostTrustMode()) {
  if (requestedTrustMode === 'local') return null
  if (process.env.CSC_NAME?.trim()) return process.env.CSC_NAME.trim()
  const result = await runCommand('security', ['find-identity', '-v', '-p', 'codesigning'], {
    allowFailure: true,
  })
  if (result.code !== 0) return null
  return /"([^"]*Developer ID Application[^"]*)"/.exec(result.stdout)?.[1] ?? null
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let outputBytes = 0
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        reject(new Error(`${command} exceeded the packaging log limit`))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', reject)
    child.once('close', (code) => {
      const result = {
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
      if (result.code !== 0 && options.allowFailure !== true) {
        const detail = `${result.stderr}\n${result.stdout}`.trim().slice(0, 2_000)
        reject(
          new Error(`${command} failed with exit ${result.code}: ${detail || '<empty output>'}`),
        )
      } else {
        resolve(result)
      }
    })
  })
}

module.exports = {
  createNativeHostManifest,
  createLocalNativeHostManifest,
  packageMacNativeHost,
  parseCodeSignatureOutput,
  resolveMacNativeHostTrustMode,
  macNativeHostDestinationPaths,
}
