import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { NATIVE_HOST_PROTOCOL_VERSION, Sha256Schema } from '@spark/protocol'
import { z } from 'zod'

const execFileAsync = promisify(execFile)
const MAX_MANIFEST_BYTES = 65_536
const MAX_EXECUTABLE_BYTES = 268_435_456
const NATIVE_HOST_SIGNING_IDENTIFIER = 'com.spark-agent.desktop.computer-host'
const MINIMUM_TRUSTED_NATIVE_HOST_VERSION = [0, 1, 0] as const

const NativeHostArtifactBase = {
  schemaVersion: z.literal(1),
  protocolVersion: z.literal(NATIVE_HOST_PROTOCOL_VERSION),
  hostVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'expected a semantic version'),
  architecture: z.enum(['x64', 'arm64']),
  executableFileName: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  sha256: Sha256Schema,
}

const SignedNativeHostArtifactManifestSchema = z.discriminatedUnion('platform', [
  z
    .object({
      ...NativeHostArtifactBase,
      platform: z.literal('macos'),
      signingIdentifier: z.literal(NATIVE_HOST_SIGNING_IDENTIFIER),
      signingTeamIdentifier: z.string().regex(/^[A-Z0-9]{10}$/),
    })
    .strict(),
  z
    .object({
      ...NativeHostArtifactBase,
      platform: z.literal('windows'),
      signingPublisherThumbprint: Sha256Schema,
    })
    .strict(),
])

const LocalNativeHostArtifactManifestSchema = z
  .object({
    ...NativeHostArtifactBase,
    trustMode: z.literal('local'),
    platform: z.enum(['macos', 'windows']),
  })
  .strict()

export const NativeHostArtifactManifestSchema = z.union([
  SignedNativeHostArtifactManifestSchema,
  LocalNativeHostArtifactManifestSchema,
])

export type NativeHostArtifactManifest = z.infer<typeof NativeHostArtifactManifestSchema>

export interface NativeHostCodeSignature {
  identifier: string
  teamIdentifier: string
}

export interface WindowsNativeHostCodeSignature {
  publisherThumbprint: string
}

export interface VerifiedNativeHostArtifact {
  executablePath: string
  manifestPath: string
  manifest: NativeHostArtifactManifest
  trustMode?: 'signed' | 'local'
}

export async function readNativeHostArtifactTrustMode(
  manifestPath: string,
): Promise<'signed' | 'local'> {
  const resolvedManifestPath = resolve(manifestPath)
  const manifestStat = await readTrustedFileStat(resolvedManifestPath, 'manifest')
  assertManifestSize(manifestStat.size)
  const manifestBytes = await readFile(resolvedManifestPath)
  assertManifestSize(manifestBytes.length)
  const manifest = parseManifest(manifestBytes)
  return 'trustMode' in manifest && manifest.trustMode === 'local' ? 'local' : 'signed'
}

export async function verifyLocalNativeHostArtifact(options: {
  executablePath: string
  manifestPath: string
  platform: 'macos' | 'windows'
  architecture: NativeHostArtifactManifest['architecture']
}): Promise<VerifiedNativeHostArtifact> {
  const executablePath = resolve(options.executablePath)
  const manifestPath = resolve(options.manifestPath)
  const executableStat = await readTrustedFileStat(executablePath, 'executable')
  const manifestStat = await readTrustedFileStat(manifestPath, 'manifest')
  assertManifestSize(manifestStat.size)
  if (executableStat.size > MAX_EXECUTABLE_BYTES) {
    throw untrusted('Native Host executable exceeds the trusted artifact size limit')
  }
  const manifestBytes = await readFile(manifestPath)
  assertManifestSize(manifestBytes.length)
  const manifest = parseManifest(manifestBytes)
  assertSupportedHostVersion(manifest.hostVersion)
  if (
    !('trustMode' in manifest) ||
    manifest.trustMode !== 'local' ||
    manifest.platform !== options.platform ||
    manifest.architecture !== options.architecture ||
    manifest.executableFileName !== basename(executablePath)
  ) {
    throw new NativeHostArtifactError(
      'native_host_incompatible',
      'Local Native Host artifact does not match this platform, architecture, or executable name',
    )
  }
  const executableBytes = await readFile(executablePath)
  if (createHash('sha256').update(executableBytes).digest('hex') !== manifest.sha256) {
    throw untrusted('Native Host executable digest does not match its artifact manifest')
  }
  return { executablePath, manifestPath, manifest, trustMode: 'local' }
}

export class NativeHostArtifactError extends Error {
  readonly code: 'native_host_missing' | 'native_host_untrusted' | 'native_host_incompatible'

  constructor(code: NativeHostArtifactError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NativeHostArtifactError'
    this.code = code
  }
}

export async function verifyNativeHostArtifact(options: {
  executablePath: string
  manifestPath: string
  platform: 'macos'
  architecture: NativeHostArtifactManifest['architecture']
  expectedTeamIdentifier: string
  inspectCodeSignature?: (executablePath: string) => Promise<NativeHostCodeSignature>
}): Promise<VerifiedNativeHostArtifact> {
  const executablePath = resolve(options.executablePath)
  const manifestPath = resolve(options.manifestPath)
  const executableStat = await readTrustedFileStat(executablePath, 'executable')
  const manifestStat = await readTrustedFileStat(manifestPath, 'manifest')
  assertManifestSize(manifestStat.size)
  if (executableStat.size > MAX_EXECUTABLE_BYTES) {
    throw untrusted('Native Host executable exceeds the trusted artifact size limit')
  }

  const manifestBytes = await readFile(manifestPath)
  assertManifestSize(manifestBytes.length)
  const manifest = parseManifest(manifestBytes)
  assertSupportedHostVersion(manifest.hostVersion)
  if (manifest.platform !== 'macos' || 'trustMode' in manifest) {
    throw new NativeHostArtifactError(
      'native_host_incompatible',
      'Native Host artifact does not contain a macOS signing identity',
    )
  }
  if (!/^[A-Z0-9]{10}$/.test(options.expectedTeamIdentifier)) {
    throw untrusted('SparkWork application signing Team ID is invalid')
  }
  if (
    manifest.platform !== options.platform ||
    manifest.architecture !== options.architecture ||
    manifest.executableFileName !== basename(executablePath)
  ) {
    throw new NativeHostArtifactError(
      'native_host_incompatible',
      'Native Host artifact does not match this platform, architecture, or executable name',
    )
  }
  if (manifest.signingTeamIdentifier !== options.expectedTeamIdentifier) {
    throw untrusted('Native Host signing team does not match the SparkWork application')
  }

  const executableBytes = await readFile(executablePath)
  const digest = createHash('sha256').update(executableBytes).digest('hex')
  if (digest !== manifest.sha256) {
    throw untrusted('Native Host executable digest does not match its artifact manifest')
  }

  let signature: NativeHostCodeSignature
  try {
    signature = await (options.inspectCodeSignature ?? inspectMacCodeSignature)(executablePath)
  } catch (error) {
    if (error instanceof NativeHostArtifactError) throw error
    throw untrusted('Native Host code signature verification failed', error)
  }
  if (
    signature.identifier !== manifest.signingIdentifier ||
    signature.teamIdentifier !== manifest.signingTeamIdentifier
  ) {
    throw untrusted('Native Host code signature does not match its artifact manifest')
  }

  return { executablePath, manifestPath, manifest, trustMode: 'signed' }
}

export async function verifyWindowsNativeHostArtifact(options: {
  executablePath: string
  manifestPath: string
  platform: 'windows'
  architecture: NativeHostArtifactManifest['architecture']
  expectedPublisherThumbprint: string
  inspectCodeSignature?: (executablePath: string) => Promise<WindowsNativeHostCodeSignature>
}): Promise<VerifiedNativeHostArtifact> {
  const executablePath = resolve(options.executablePath)
  const manifestPath = resolve(options.manifestPath)
  const executableStat = await readTrustedFileStat(executablePath, 'executable')
  const manifestStat = await readTrustedFileStat(manifestPath, 'manifest')
  assertManifestSize(manifestStat.size)
  if (executableStat.size > MAX_EXECUTABLE_BYTES) {
    throw untrusted('Native Host executable exceeds the trusted artifact size limit')
  }

  const manifestBytes = await readFile(manifestPath)
  assertManifestSize(manifestBytes.length)
  const manifest = parseManifest(manifestBytes)
  assertSupportedHostVersion(manifest.hostVersion)
  if ('trustMode' in manifest) {
    throw new NativeHostArtifactError(
      'native_host_incompatible',
      'Signed Windows Native Host verification cannot accept a local artifact',
    )
  }
  const expectedPublisherThumbprint = options.expectedPublisherThumbprint.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(expectedPublisherThumbprint)) {
    throw untrusted('SparkWork publisher certificate thumbprint is invalid')
  }
  if (
    manifest.platform !== 'windows' ||
    manifest.architecture !== options.architecture ||
    manifest.executableFileName !== basename(executablePath)
  ) {
    throw new NativeHostArtifactError(
      'native_host_incompatible',
      'Native Host artifact does not match this Windows platform, architecture, or executable name',
    )
  }
  if (manifest.signingPublisherThumbprint !== expectedPublisherThumbprint) {
    throw untrusted('Native Host signing publisher does not match the SparkWork application')
  }

  const executableBytes = await readFile(executablePath)
  if (createHash('sha256').update(executableBytes).digest('hex') !== manifest.sha256) {
    throw untrusted('Native Host executable digest does not match its artifact manifest')
  }

  let signature: WindowsNativeHostCodeSignature
  try {
    signature = await (options.inspectCodeSignature ?? inspectWindowsCodeSignature)(executablePath)
  } catch (error) {
    if (error instanceof NativeHostArtifactError) throw error
    throw untrusted('Native Host Authenticode verification failed', error)
  }
  if (signature.publisherThumbprint.toLowerCase() !== manifest.signingPublisherThumbprint) {
    throw untrusted('Native Host publisher does not match its artifact manifest')
  }
  return { executablePath, manifestPath, manifest, trustMode: 'signed' }
}

async function readTrustedFileStat(filePath: string, label: string) {
  let fileStat: Awaited<ReturnType<typeof lstat>>
  try {
    fileStat = await lstat(filePath)
  } catch (error) {
    throw new NativeHostArtifactError(
      'native_host_missing',
      `Native Host ${label} is not installed`,
      { cause: error },
    )
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw untrusted(`Native Host ${label} must be a regular non-symlink file`)
  }
  if ((fileStat.mode & 0o022) !== 0) {
    throw untrusted(`Native Host ${label} must not be group- or world-writable`)
  }
  return fileStat
}

function parseManifest(bytes: Buffer): NativeHostArtifactManifest {
  try {
    return NativeHostArtifactManifestSchema.parse(JSON.parse(bytes.toString('utf8')))
  } catch (error) {
    throw new NativeHostArtifactError(
      'native_host_untrusted',
      'Native Host artifact manifest is invalid',
      { cause: error },
    )
  }
}

function assertManifestSize(size: number): void {
  if (size > MAX_MANIFEST_BYTES) {
    throw untrusted('Native Host artifact manifest exceeds the size limit')
  }
}

function assertSupportedHostVersion(hostVersion: string): void {
  const [core] = hostVersion.split('-', 1)
  const parts = core?.split('.').map(Number)
  if (parts == null || parts.length !== 3) {
    throw untrusted('Native Host version is invalid')
  }
  for (const [index, minimum] of MINIMUM_TRUSTED_NATIVE_HOST_VERSION.entries()) {
    const current = parts[index] ?? -1
    if (current > minimum) return
    if (current < minimum) {
      throw untrusted('Native Host version is below the minimum trusted release')
    }
  }
}

export async function inspectMacCodeSignature(
  executablePath: string,
): Promise<NativeHostCodeSignature> {
  await execFileAsync(
    '/usr/bin/codesign',
    ['--verify', '--strict', '--verbose=2', executablePath],
    {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 64 * 1_024,
    },
  )
  const result = await execFileAsync('/usr/bin/codesign', ['-d', '--verbose=4', executablePath], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1_024,
  })
  const output = `${result.stdout}\n${result.stderr}`
  const identifier = /^Identifier=(.+)$/m.exec(output)?.[1]?.trim()
  const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim()
  if (identifier == null || teamIdentifier == null) {
    throw untrusted('Native Host code signature identity is incomplete')
  }
  const signature = { identifier, teamIdentifier }
  await execFileAsync(
    '/usr/bin/codesign',
    ['--verify', '--strict', `-R=${createMacCodeRequirement(signature)}`, executablePath],
    {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 64 * 1_024,
    },
  )
  return signature
}

export async function inspectWindowsCodeSignature(
  executablePath: string,
): Promise<WindowsNativeHostCodeSignature> {
  const systemRoot = process.env.SystemRoot
  if (systemRoot == null || !/^[A-Za-z]:\\Windows$/i.test(systemRoot)) {
    throw untrusted('Windows system directory is unavailable')
  }
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$signature = Get-AuthenticodeSignature -LiteralPath $args[0]',
    'if ($signature.Status -ne "Valid" -or $null -eq $signature.SignerCertificate) { exit 3 }',
    '$sha = [System.Security.Cryptography.SHA256]::Create()',
    'try { $hash = $sha.ComputeHash($signature.SignerCertificate.RawData) } finally { $sha.Dispose() }',
    '[Convert]::ToBase64String($hash)',
  ].join('; ')
  const result = await execFileAsync(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
      executablePath,
    ],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1_024, windowsHide: true },
  )
  const encoded = result.stdout.trim()
  const digest = Buffer.from(encoded, 'base64')
  if (digest.length !== 32 || digest.toString('base64') !== encoded) {
    throw untrusted('Windows Authenticode signer certificate is invalid')
  }
  return { publisherThumbprint: digest.toString('hex') }
}

export function createMacCodeRequirement(signature: NativeHostCodeSignature): string {
  if (
    !/^[A-Za-z0-9.-]{1,200}$/.test(signature.identifier) ||
    !/^[A-Z0-9]{10}$/.test(signature.teamIdentifier)
  ) {
    throw untrusted('Native Host code signature identity contains invalid characters')
  }
  return `anchor apple generic and identifier "${signature.identifier}" and certificate leaf[subject.OU] = "${signature.teamIdentifier}"`
}

function untrusted(message: string, cause?: unknown): NativeHostArtifactError {
  return new NativeHostArtifactError('native_host_untrusted', message, { cause })
}
