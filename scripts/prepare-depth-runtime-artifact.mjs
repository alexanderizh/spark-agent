#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const ROOT_PACKAGE = '@huggingface/transformers'
const SKIPPED_PACKAGES = new Set(['onnxruntime-web'])
const RUNTIME_ENTRY = 'node_modules/@huggingface/transformers/src/transformers.js'
const NORMALIZED_TIME = new Date('2000-01-01T00:00:00.000Z')
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32'])
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64'])

export async function prepareDepthRuntimeArtifact(sourceNodeModules, outputDirectory, options) {
  const platform = options?.platform
  const arch = options?.arch
  const revision = options?.revision ?? 1
  const codesignIdentity = options?.codesignIdentity
  const expectedTeamId = options?.expectedTeamId
  const requireCodesign = options?.requireCodesign === true
  const windowsSignTool = options?.windowsSignTool
  const windowsCertificate = options?.windowsCertificate
  const windowsCertificatePassword = options?.windowsCertificatePassword
  const windowsPublisherSha256 = options?.windowsPublisherSha256
  const windowsPowerShell = options?.windowsPowerShell
  const requireWindowsCodesign = options?.requireWindowsCodesign === true
  if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`Unsupported depth runtime target: ${platform}/${arch}`)
  }
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`Invalid depth runtime revision: ${revision}`)
  }

  const sourceRoot = resolve(sourceNodeModules)
  const output = resolve(outputDirectory)
  const packageDirectory = join(output, 'package')
  await rm(packageDirectory, { recursive: true, force: true })
  await mkdir(join(packageDirectory, 'node_modules'), { recursive: true })

  const packages = await collectDependencyClosure(sourceRoot, ROOT_PACKAGE, platform, arch)
  for (const [name, sourceDirectory] of [...packages.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const destination = join(packageDirectory, 'node_modules', ...name.split('/'))
    await copyPackageDirectory(sourceDirectory, destination)
  }
  await pruneOnnxRuntime(packageDirectory, platform, arch)
  await patchTransformersForNodeOnly(packageDirectory)
  const signingTeamId =
    platform === 'darwin'
      ? await signDarwinNativeFiles(packageDirectory, {
          identity: codesignIdentity,
          expectedTeamId,
          required: requireCodesign,
          runCommand: options?.runCommand ?? run,
          captureCommand: options?.captureCommand ?? runCapture,
        })
      : null
  const authenticodeSigned =
    platform === 'win32'
      ? await signWindowsNativeFiles(packageDirectory, {
          signTool: windowsSignTool,
          certificate: windowsCertificate,
          certificatePassword: windowsCertificatePassword,
          publisherSha256: windowsPublisherSha256,
          powerShell: windowsPowerShell,
          required: requireWindowsCodesign,
          runCommand: options?.runCommand ?? run,
          captureCommand: options?.captureCommand ?? runCapture,
        })
      : false

  const transformers = JSON.parse(
    await readFile(
      join(packageDirectory, 'node_modules/@huggingface/transformers/package.json'),
      'utf8',
    ),
  )
  const onnx = JSON.parse(
    await readFile(join(packageDirectory, 'node_modules/onnxruntime-node/package.json'), 'utf8'),
  )
  const version = `${transformers.version}-${onnx.version}-${revision}`
  const artifactId = `runtime.optional-depth-transformers-${transformers.version}-onnx-${onnx.version}-${revision}-${platform}-${arch}`

  const runtimeFiles = await collectRegularFiles(packageDirectory)
  const files = {}
  for (const relativePath of runtimeFiles) {
    files[relativePath] = await sha256File(join(packageDirectory, ...relativePath.split('/')))
  }
  const packageManifest = {
    schemaVersion: 1,
    capabilityId: 'local-depth',
    artifactId,
    version,
    platform,
    arch,
    runtimeEntry: RUNTIME_ENTRY,
    ...(signingTeamId ? { signingTeamId } : {}),
    ...(authenticodeSigned ? { authenticodeSigned: true } : {}),
    packages: {},
    files,
  }
  for (const name of [...packages.keys()].sort()) {
    const packageJson = JSON.parse(
      await readFile(
        join(packageDirectory, 'node_modules', ...name.split('/'), 'package.json'),
        'utf8',
      ),
    )
    packageManifest.packages[name] = packageJson.version
  }
  const packageManifestPath = join(packageDirectory, 'capability-package.json')
  await writeFile(packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`)
  await normalizePackageTimes(packageDirectory)

  const archiveName = `depth-runtime-${version}-${platform}-${arch}.tar.gz`
  const tarPath = join(output, archiveName.replace(/\.gz$/, ''))
  const archivePath = join(output, archiveName)
  await rm(tarPath, { force: true })
  await rm(archivePath, { force: true })
  const archiveFiles = ['capability-package.json', ...runtimeFiles].sort()
  await run('tar', ['-cf', tarPath, '-C', packageDirectory, ...archiveFiles])
  await run('gzip', ['-n', '-9', '-f', tarPath])

  const entry = {
    id: artifactId,
    type: 'runtime',
    name: `Local Depth Runtime ${version} (${platform}-${arch})`,
    version,
    platform,
    arch,
    url: `dependencies/depth-runtime/${archiveName}`,
    sha256: await sha256File(archivePath),
    size: (await stat(archivePath)).size,
    archive: { format: 'tar.gz', contentRoot: '.' },
    notes:
      'Optional Node depth-estimation runtime containing Transformers.js and only the target ONNX/native dependency closure; Apache-2.0/MIT and bundled third-party licenses.',
  }
  const releaseManifestPath = join(
    output,
    `depth-runtime-${version}-${platform}-${arch}-manifest.json`,
  )
  await writeFile(releaseManifestPath, `${JSON.stringify(entry, null, 2)}\n`)
  return { archivePath, entry, packageDirectory, packageManifestPath, releaseManifestPath }
}

async function signDarwinNativeFiles(packageDirectory, options) {
  if (!options.identity) {
    if (options.required) {
      throw new Error('Darwin depth runtime requires DEPTH_RUNTIME_CODESIGN_IDENTITY')
    }
    return null
  }
  if (!options.expectedTeamId) {
    throw new Error('Darwin depth runtime signing requires DEPTH_RUNTIME_EXPECTED_TEAM_ID')
  }

  const nativeFiles = (await collectRegularFiles(packageDirectory))
    .filter((path) => path.endsWith('.dylib') || path.endsWith('.node'))
    .sort((left, right) => {
      const leftBinding = left.endsWith('.node') ? 1 : 0
      const rightBinding = right.endsWith('.node') ? 1 : 0
      return leftBinding - rightBinding || left.localeCompare(right)
    })
  if (nativeFiles.length === 0) {
    throw new Error('Darwin depth runtime contains no native files to sign')
  }

  for (const relativePath of nativeFiles) {
    const absolutePath = join(packageDirectory, ...relativePath.split('/'))
    await options.runCommand('codesign', [
      '--force',
      '--options',
      'runtime',
      '--timestamp',
      '--sign',
      options.identity,
      absolutePath,
    ])
    await options.runCommand('codesign', ['--verify', '--strict', '--verbose=2', absolutePath])
    const details = await options.captureCommand('codesign', ['-dv', '--verbose=4', absolutePath])
    const teamId = details.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim()
    if (teamId !== options.expectedTeamId) {
      throw new Error(
        `Darwin native file has unexpected Team ID: ${relativePath} (${teamId ?? 'missing'})`,
      )
    }
  }
  return options.expectedTeamId
}

async function signWindowsNativeFiles(packageDirectory, options) {
  if (
    !options.signTool ||
    !options.certificate ||
    !options.certificatePassword ||
    !options.publisherSha256 ||
    !options.powerShell
  ) {
    if (options.required) {
      throw new Error(
        'Windows depth runtime requires sign tool, certificate, publisher fingerprint, and PowerShell',
      )
    }
    return false
  }
  if (!/^[0-9a-f]{64}$/i.test(options.publisherSha256)) {
    throw new Error('Windows depth runtime publisher fingerprint must be SHA-256')
  }

  const nativeFiles = (await collectRegularFiles(packageDirectory))
    .filter((path) => /\.(dll|node)$/i.test(path))
    .sort((left, right) => {
      const leftBinding = /\.node$/i.test(left) ? 1 : 0
      const rightBinding = /\.node$/i.test(right) ? 1 : 0
      return leftBinding - rightBinding || left.localeCompare(right)
    })
  if (nativeFiles.length === 0) {
    throw new Error('Windows depth runtime contains no native files to sign')
  }

  for (const relativePath of nativeFiles) {
    const absolutePath = join(packageDirectory, ...relativePath.split('/'))
    await options.runCommand(options.signTool, [
      'sign',
      '/fd',
      'SHA256',
      '/td',
      'SHA256',
      '/tr',
      'http://timestamp.digicert.com',
      '/f',
      options.certificate,
      '/p',
      options.certificatePassword,
      absolutePath,
    ])
    await verifyWindowsAuthenticode(absolutePath, options)
  }
  return true
}

async function verifyWindowsAuthenticode(absolutePath, options) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:SPARK_AUTHENTICODE_PATH',
    '$certificate = $signature.SignerCertificate',
    'if ($null -eq $certificate) { throw "Authenticode signature has no signer certificate" }',
    '$sha = [System.Security.Cryptography.SHA256]::Create()',
    'try { $fingerprint = [Convert]::ToHexString($sha.ComputeHash($certificate.RawData)).ToLowerInvariant() } finally { $sha.Dispose() }',
    'if ($fingerprint -cne $env:SPARK_AUTHENTICODE_EXPECTED_PUBLISHER) { throw "Authenticode signer differs from the configured publisher" }',
    '$expectedSelfSignedPublisher = (($signature.Status -eq "UnknownError" -or $signature.Status -eq "NotTrusted") -and $certificate.Subject -eq $certificate.Issuer)',
    'if ($signature.Status -ne "Valid" -and -not $expectedSelfSignedPublisher) { throw "Authenticode verification failed: $($signature.Status) - $($signature.StatusMessage)" }',
    'if ($null -eq $signature.TimeStamperCertificate) { throw "Authenticode signature has no RFC 3161 timestamp" }',
    'Write-Output $fingerprint',
  ].join('\n')
  await options.captureCommand(
    options.powerShell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: {
        ...process.env,
        SPARK_AUTHENTICODE_PATH: absolutePath,
        SPARK_AUTHENTICODE_EXPECTED_PUBLISHER: options.publisherSha256.toLowerCase(),
      },
    },
  )
}

async function collectDependencyClosure(sourceRoot, rootPackage, platform, arch) {
  const packages = new Map()
  const pending = [{ name: rootPackage, fromDirectory: sourceRoot, optional: false }]
  while (pending.length > 0) {
    const current = pending.shift()
    if (packages.has(current.name) || SKIPPED_PACKAGES.has(current.name)) continue
    if (current.optional && !optionalPackageMatchesTarget(current.name, platform, arch)) continue
    const directory = await resolvePackageDirectory(
      sourceRoot,
      current.fromDirectory,
      current.name,
    ).catch((error) => {
      if (current.optional) return null
      throw error
    })
    if (!directory) continue
    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    packages.set(current.name, directory)
    for (const name of Object.keys(packageJson.dependencies ?? {}).sort()) {
      pending.push({ name, fromDirectory: directory, optional: false })
    }
    for (const name of Object.keys(packageJson.optionalDependencies ?? {}).sort()) {
      pending.push({ name, fromDirectory: directory, optional: true })
    }
  }
  return packages
}

async function resolvePackageDirectory(sourceRoot, fromDirectory, name) {
  const segments = name.split('/')
  const candidates = [
    join(fromDirectory, 'node_modules', ...segments),
    join(sourceRoot, ...segments),
  ]
  for (const candidate of candidates) {
    try {
      const packageJson = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'))
      if (packageJson.name === name) return candidate
    } catch {
      // Try the next hoisted or nested package location.
    }
  }
  throw new Error(`Depth runtime dependency is missing: ${name}`)
}

function optionalPackageMatchesTarget(name, platform, arch) {
  const knownPlatform = name.match(/-(darwin|linux|linuxmusl|win32|windows)-/)
  if (!knownPlatform) return true
  const normalized = knownPlatform[1] === 'windows' ? 'win32' : knownPlatform[1]
  if (normalized !== platform) return false
  const knownArch = name.match(/-(arm64|x64|ia32|arm|ppc64|riscv64|s390x)(?:$|@)/)
  return !knownArch || knownArch[1] === arch
}

async function copyPackageDirectory(source, destination) {
  const visit = async (sourceDirectory, destinationDirectory) => {
    await mkdir(destinationDirectory, { recursive: true })
    const entries = await readdir(sourceDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue
      const sourcePath = join(sourceDirectory, entry.name)
      const destinationPath = join(destinationDirectory, entry.name)
      const stats = await lstat(sourcePath)
      if (stats.isSymbolicLink()) {
        throw new Error(`Depth runtime package contains a symbolic link: ${sourcePath}`)
      }
      if (stats.isDirectory()) await visit(sourcePath, destinationPath)
      else if (stats.isFile()) await copyFile(sourcePath, destinationPath)
    }
  }
  await visit(source, destination)
}

async function pruneOnnxRuntime(packageDirectory, platform, arch) {
  const root = join(packageDirectory, 'node_modules/onnxruntime-node/bin/napi-v6')
  for (const platformEntry of await readdir(root, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) continue
    const platformPath = join(root, platformEntry.name)
    if (platformEntry.name !== platform) {
      await rm(platformPath, { recursive: true, force: true })
      continue
    }
    for (const archEntry of await readdir(platformPath, { withFileTypes: true })) {
      if (archEntry.isDirectory() && archEntry.name !== arch) {
        await rm(join(platformPath, archEntry.name), { recursive: true, force: true })
      }
    }
  }
  await stat(join(root, platform, arch))
}

async function patchTransformersForNodeOnly(packageDirectory) {
  const backendPath = join(
    packageDirectory,
    'node_modules/@huggingface/transformers/src/backends/onnx.js',
  )
  const source = await readFile(backendPath, 'utf8')
  const importPattern = /import \* as ONNX_WEB from ['"]onnxruntime-web\/webgpu['"];?/
  if (!importPattern.test(source)) {
    throw new Error('Transformers ONNX backend no longer matches the reviewed Node-only patch')
  }
  await writeFile(
    backendPath,
    source.replace(
      importPattern,
      'const ONNX_WEB = Object.freeze({}); // Spark Node-only optional runtime',
    ),
  )
}

async function collectRegularFiles(root) {
  const files = []
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const relativePath = relative(root, absolutePath).split(sep).join('/')
      if (entry.isDirectory()) await visit(absolutePath)
      else if (entry.isFile()) files.push(relativePath)
      else throw new Error(`Depth runtime output contains an unsupported entry: ${relativePath}`)
    }
  }
  await visit(root)
  return files.sort()
}

async function normalizePackageTimes(root) {
  const paths = []
  const visit = async (directory) => {
    paths.push(directory)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolutePath)
      else paths.push(absolutePath)
    }
  }
  await visit(root)
  for (const path of paths.reverse()) await utimes(path, NORMALIZED_TIME, NORMALIZED_TIME)
}

function sha256File(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectHash)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

function runCapture(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      const output = Buffer.concat(chunks).toString('utf8')
      if (code === 0) resolveRun(output)
      else rejectRun(new Error(`${command} failed with exit code ${code ?? 'unknown'}: ${output}`))
    })
  })
}

async function main() {
  const platform = process.argv[2]
  const arch = process.argv[3]
  const revision = Number(process.argv[4] || 1)
  const output = resolve(process.argv[5] || `/private/tmp/spark-depth-runtime-${platform}-${arch}`)
  const source = resolve(process.argv[6] || 'node_modules')
  const result = await prepareDepthRuntimeArtifact(source, output, {
    platform,
    arch,
    revision,
    codesignIdentity: process.env.DEPTH_RUNTIME_CODESIGN_IDENTITY,
    expectedTeamId: process.env.DEPTH_RUNTIME_EXPECTED_TEAM_ID,
    requireCodesign: process.env.DEPTH_RUNTIME_REQUIRE_CODESIGN === '1',
    windowsSignTool: process.env.DEPTH_RUNTIME_WINDOWS_SIGNTOOL,
    windowsCertificate: process.env.DEPTH_RUNTIME_WINDOWS_CERTIFICATE,
    windowsCertificatePassword: process.env.DEPTH_RUNTIME_WINDOWS_CERTIFICATE_PASSWORD,
    windowsPublisherSha256: process.env.DEPTH_RUNTIME_WINDOWS_PUBLISHER_SHA256,
    windowsPowerShell: process.env.DEPTH_RUNTIME_WINDOWS_POWERSHELL,
    requireWindowsCodesign: process.env.DEPTH_RUNTIME_WINDOWS_REQUIRE_SIGNING === '1',
  })
  console.log(
    JSON.stringify({
      archive: basename(result.archivePath),
      size: result.entry.size,
      sha256: result.entry.sha256,
      artifactId: result.entry.id,
      releaseManifest: basename(result.releaseManifestPath),
    }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
