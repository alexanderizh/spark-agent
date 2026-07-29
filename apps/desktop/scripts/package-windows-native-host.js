const { spawn } = require('child_process')
const { createHash } = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const { Arch } = require('builder-util')

const HOST_VERSION = '0.1.0'
const EXECUTABLE_NAME = 'SparkComputerHost.exe'
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024

function normalizePublisherThumbprint(value) {
  const normalized = String(value).replace(/[\s:]/g, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Windows publisher certificate SHA-256 thumbprint is invalid')
  }
  return normalized
}

function createWindowsNativeHostManifest({ executable, architecture, publisherThumbprint }) {
  if (!Buffer.isBuffer(executable) || executable.length === 0) {
    throw new Error('Windows Native Host executable is empty')
  }
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported Windows Native Host architecture: ${architecture}`)
  }
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    hostVersion: HOST_VERSION,
    platform: 'windows',
    architecture,
    executableFileName: EXECUTABLE_NAME,
    sha256: createHash('sha256').update(executable).digest('hex'),
    signingPublisherThumbprint: normalizePublisherThumbprint(publisherThumbprint),
  }
}

function createLocalWindowsNativeHostManifest({ executable, architecture }) {
  if (!Buffer.isBuffer(executable) || executable.length === 0) {
    throw new Error('Windows Native Host executable is empty')
  }
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported Windows Native Host architecture: ${architecture}`)
  }
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    hostVersion: HOST_VERSION,
    trustMode: 'local',
    platform: 'windows',
    architecture,
    executableFileName: EXECUTABLE_NAME,
    sha256: createHash('sha256').update(executable).digest('hex'),
  }
}

async function packageWindowsNativeHost(context) {
  if (context.electronPlatformName !== 'win32') return { packaged: false, reason: 'not-windows' }
  const architecture = Arch[context.arch]
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(
      `Windows Native Host packaging does not support Electron architecture: ${architecture}`,
    )
  }
  const configuredThumbprint = process.env.SPARK_WINDOWS_PUBLISHER_THUMBPRINT
  const localTrust = resolveWindowsNativeHostTrustMode(process.env) === 'local'
  const publisherThumbprint = localTrust ? null : normalizePublisherThumbprint(configuredThumbprint)

  const packageRoot = path.resolve(__dirname, '../native/windows/spark-computer-host')
  const rustTarget = architecture === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  await runCommand(
    'cargo',
    [
      'build',
      '--locked',
      '--release',
      '--target',
      rustTarget,
      ...(localTrust ? ['--features', 'local-trust'] : []),
    ],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        ...(publisherThumbprint == null
          ? {}
          : { SPARK_WINDOWS_PUBLISHER_THUMBPRINT: publisherThumbprint }),
      },
    },
  )
  const sourceExecutable = path.join(packageRoot, 'target', rustTarget, 'release', EXECUTABLE_NAME)
  const destinationDirectory = path.join(
    context.appOutDir,
    'resources',
    'native-host',
    `windows-${architecture}`,
  )
  const destinationExecutable = path.join(destinationDirectory, EXECUTABLE_NAME)
  await fs.mkdir(destinationDirectory, { recursive: true })
  await fs.copyFile(sourceExecutable, destinationExecutable)
  const executable = await fs.readFile(destinationExecutable)
  let manifest
  if (localTrust) {
    manifest = createLocalWindowsNativeHostManifest({ executable, architecture })
  } else {
    await signWindowsNativeHost(context.packager, destinationExecutable)
    const signature = await inspectWindowsAuthenticode(destinationExecutable, {
      expectedPublisherThumbprint: publisherThumbprint,
    })
    if (signature.publisherThumbprint !== publisherThumbprint) {
      throw new Error('Windows Native Host signer differs from SPARK_WINDOWS_PUBLISHER_THUMBPRINT')
    }
    if (!signature.timestamped) {
      throw new Error(
        'Windows Native Host Authenticode signature is missing its RFC 3161 timestamp',
      )
    }
    manifest = createWindowsNativeHostManifest({
      executable: await fs.readFile(destinationExecutable),
      architecture,
      publisherThumbprint: signature.publisherThumbprint,
    })
  }
  const manifestPath = path.join(destinationDirectory, 'manifest.json')
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
  console.log(
    `[after-pack] Windows Native Host: packaged ${architecture}, trust=${localTrust ? 'local' : 'signed'}, sha256=${manifest.sha256}`,
  )
  return { packaged: true, destinationExecutable, manifestPath, manifest }
}

async function signWindowsNativeHost(packager, executablePath) {
  if (typeof packager?.signIf !== 'function') {
    throw new Error('electron-builder Windows signer is unavailable for Native Host packaging')
  }
  const signed = await packager.signIf(executablePath)
  if (signed !== true) {
    throw new Error('electron-builder did not sign the Windows Native Host executable')
  }
}

function resolveWindowsNativeHostTrustMode(environment = process.env) {
  const explicit = environment.SPARK_NATIVE_HOST_TRUST_MODE?.trim().toLowerCase()
  if (explicit === 'local' || explicit === 'signed') return explicit
  if (explicit != null && explicit !== '') {
    throw new Error('SPARK_NATIVE_HOST_TRUST_MODE must be signed or local')
  }
  const thumbprint = environment.SPARK_WINDOWS_PUBLISHER_THUMBPRINT?.trim()
  const certificate = (environment.WIN_CSC_LINK ?? environment.CSC_LINK)?.trim()
  const password = (environment.WIN_CSC_KEY_PASSWORD ?? environment.CSC_KEY_PASSWORD)?.trim()
  return thumbprint && certificate && password ? 'signed' : 'local'
}

async function inspectWindowsAuthenticode(executablePath, options = {}) {
  const environment = options.environment ?? process.env
  const expectedPublisherThumbprint =
    options.expectedPublisherThumbprint ?? environment.SPARK_WINDOWS_PUBLISHER_THUMBPRINT
  const expectedPublisherFingerprint =
    expectedPublisherThumbprint == null || expectedPublisherThumbprint.trim() === ''
      ? null
      : Buffer.from(normalizePublisherThumbprint(expectedPublisherThumbprint), 'hex').toString(
          'base64',
        )
  const systemRoot = environment.SystemRoot
  if (systemRoot == null || !/^[A-Za-z]:\\Windows$/i.test(systemRoot)) {
    throw new Error('Windows system directory is unavailable for Authenticode verification')
  }
  const powershell = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const script = `
$ErrorActionPreference = "Stop"
$path = $env:SPARK_AUTHENTICODE_PATH
if ([string]::IsNullOrWhiteSpace($path)) {
  throw "SPARK_AUTHENTICODE_PATH is empty"
}
$signature = Get-AuthenticodeSignature -LiteralPath $path
$certificate = $signature.SignerCertificate
if ($null -eq $certificate) {
  throw "Authenticode signature has no signer certificate: $($signature.Status) - $($signature.StatusMessage)"
}
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $hash = $sha.ComputeHash($certificate.RawData)
}
finally {
  $sha.Dispose()
}
$encoded = [Convert]::ToBase64String($hash)
$expectedPublisher = $env:SPARK_AUTHENTICODE_EXPECTED_PUBLISHER
if (
  -not [string]::IsNullOrWhiteSpace($expectedPublisher) -and
  $encoded -cne $expectedPublisher
) {
  throw "Authenticode signer differs from the configured publisher"
}
if (
  ($signature.Status -eq "UnknownError" -or $signature.Status -eq "NotTrusted") -and
  $certificate.Subject -eq $certificate.Issuer
) {
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  $certificateAdded = $false
  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $existing = $store.Certificates.Find(
      [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
      $certificate.Thumbprint,
      $false
    )
    if ($existing.Count -eq 0) {
      $store.Add($certificate)
      $certificateAdded = $true
    }
    $store.Close()
    $signature = Get-AuthenticodeSignature -LiteralPath $path
  }
  finally {
    try {
      if ($certificateAdded) {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $store.Remove($certificate)
      }
    }
    finally {
      $store.Close()
    }
  }
}
if ($signature.Status -ne "Valid") {
  throw "Authenticode signature verification failed: $($signature.Status) - $($signature.StatusMessage)"
}
$encoded
if ($null -eq $signature.TimeStamperCertificate) { "0" } else { "1" }
`.trim()
  const result = await (options.runCommand ?? runCommand)(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ],
    {
      env: {
        ...environment,
        SPARK_AUTHENTICODE_PATH: executablePath,
        ...(expectedPublisherFingerprint == null
          ? {}
          : { SPARK_AUTHENTICODE_EXPECTED_PUBLISHER: expectedPublisherFingerprint }),
      },
    },
  )
  const [encoded, timestamped] = result.stdout.trim().split(/\r?\n/)
  if (encoded == null || (timestamped !== '0' && timestamped !== '1')) {
    throw new Error('Windows Native Host Authenticode result is malformed')
  }
  const digest = Buffer.from(encoded, 'base64')
  if (digest.length !== 32 || digest.toString('base64') !== encoded) {
    throw new Error('Windows Native Host Authenticode signer certificate is invalid')
  }
  return { publisherThumbprint: digest.toString('hex'), timestamped: timestamped === '1' }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
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
      if (result.code !== 0) {
        reject(
          new Error(
            `${command} failed with exit ${result.code}: ${result.stderr.trim().slice(0, 2_000)}`,
          ),
        )
      } else {
        resolve(result)
      }
    })
  })
}

module.exports = {
  createWindowsNativeHostManifest,
  createLocalWindowsNativeHostManifest,
  inspectWindowsAuthenticode,
  normalizePublisherThumbprint,
  packageWindowsNativeHost,
  resolveWindowsNativeHostTrustMode,
  signWindowsNativeHost,
}
