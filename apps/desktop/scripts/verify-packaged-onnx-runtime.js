const fs = require('fs/promises')
const path = require('path')
const { listPackage } = require('@electron/asar')

async function collectNativeEntries(resourcesPath) {
  const napiRoot = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
  )
  const entries = []
  let platformEntries
  try {
    platformEntries = await fs.readdir(napiRoot, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  for (const platformEntry of platformEntries) {
    if (!platformEntry.isDirectory()) continue
    const platformPath = path.join(napiRoot, platformEntry.name)
    for (const archEntry of await fs.readdir(platformPath, { withFileTypes: true })) {
      if (archEntry.isDirectory()) entries.push(`${platformEntry.name}/${archEntry.name}`)
    }
  }
  return entries.sort()
}

function collectAsarNativeEntries(files) {
  const marker = 'node_modules/onnxruntime-node/bin/napi-v6/'
  const entries = new Set()
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/').replace(/^\/+/, '')
    const markerIndex = normalized.indexOf(marker)
    if (markerIndex < 0) continue
    const [platform, arch] = normalized.slice(markerIndex + marker.length).split('/')
    if (platform && arch) entries.add(`${platform}/${arch}`)
  }
  return [...entries].sort()
}

async function verifyPackagedOnnxRuntime({
  resourcesPath,
  platform,
  arch,
  nativeRuntime = 'target',
  listAsarFiles = async (asarPath) => listPackage(asarPath),
}) {
  if (!['target', 'absent'].includes(nativeRuntime)) {
    throw new Error(`Unsupported native runtime mode: ${nativeRuntime}`)
  }
  const entries = await collectNativeEntries(resourcesPath)
  const target = `${platform}/${arch}`
  const unexpectedEntries =
    nativeRuntime === 'absent' ? entries : entries.filter((entry) => entry !== target)
  if (unexpectedEntries.length > 0) {
    const label = nativeRuntime === 'absent' ? 'unexpected' : 'foreign'
    throw new Error(`${label} ONNX runtime entries: ${unexpectedEntries.join(', ')}`)
  }
  if (nativeRuntime === 'target' && !entries.includes(target)) {
    throw new Error(`missing ONNX runtime entry: ${target}`)
  }

  const asarFiles = await listAsarFiles(path.join(resourcesPath, 'app.asar'))
  const asarEntries = collectAsarNativeEntries(asarFiles)
  const unexpectedAsarEntries =
    nativeRuntime === 'absent'
      ? asarEntries
      : asarEntries.filter((entry) => entry !== target)
  if (unexpectedAsarEntries.length > 0) {
    const label = nativeRuntime === 'absent' ? 'unexpected' : 'foreign'
    throw new Error(
      `${label} ONNX runtime entries in app.asar: ${unexpectedAsarEntries.join(', ')}`,
    )
  }
  const webRuntimePresent = asarFiles.some((file) =>
    file.includes('node_modules/onnxruntime-web/'),
  )
  if (webRuntimePresent) {
    throw new Error('onnxruntime-web is present in app.asar')
  }
  return { target, foreignEntries: unexpectedEntries, webRuntimePresent }
}

function readRequiredArgument(args, name) {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return value
}

async function main(args = process.argv.slice(2)) {
  const resourcesPath = path.resolve(readRequiredArgument(args, '--resources'))
  const platform = readRequiredArgument(args, '--platform')
  const arch = readRequiredArgument(args, '--arch')
  const nativeRuntime = readRequiredArgument(args, '--native')
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`)
  }
  if (!['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported architecture: ${arch}`)
  }
  if (!['target', 'absent'].includes(nativeRuntime)) {
    throw new Error(`Unsupported native runtime mode: ${nativeRuntime}`)
  }
  const result = await verifyPackagedOnnxRuntime({
    resourcesPath,
    platform,
    arch,
    nativeRuntime,
  })
  console.log(JSON.stringify(result))
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[verify-packaged-onnx] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

module.exports = {
  collectAsarNativeEntries,
  collectNativeEntries,
  verifyPackagedOnnxRuntime,
}
