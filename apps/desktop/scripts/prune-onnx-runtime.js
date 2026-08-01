const fs = require('fs/promises')
const path = require('path')

const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32'])
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64'])

async function prunePackagedOnnxRuntime(resourcesPath, platform, arch) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported ONNX target platform: ${platform}`)
  }
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`Unsupported ONNX target architecture: ${arch}`)
  }

  const napiRoot = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
  )
  const platformEntries = await fs.readdir(napiRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const removed = []

  for (const entry of platformEntries) {
    if (!entry.isDirectory()) continue
    const platformPath = path.join(napiRoot, entry.name)
    if (entry.name !== platform) {
      await fs.rm(platformPath, { recursive: true, force: true })
      removed.push(entry.name)
      continue
    }

    for (const archEntry of await fs.readdir(platformPath, { withFileTypes: true })) {
      if (!archEntry.isDirectory() || archEntry.name === arch) continue
      await fs.rm(path.join(platformPath, archEntry.name), { recursive: true, force: true })
      removed.push(`${platform}/${archEntry.name}`)
    }
  }

  const targetPath = path.join(napiRoot, platform, arch)
  const targetFiles = await fs.readdir(targetPath).catch(() => [])
  if (platformEntries.length > 0 && targetFiles.length === 0) {
    throw new Error(`Packaged ONNX runtime is missing target ${platform}/${arch}`)
  }
  return {
    kept: targetFiles.length > 0 ? [`${platform}/${arch}`] : [],
    removed,
  }
}

module.exports = { prunePackagedOnnxRuntime }
