const { targetArchitecture } = require('./package-standalone-node.js')

const FOREIGN_ONNX_PLATFORMS = {
  darwin: ['linux', 'win32'],
  win32: ['darwin', 'linux'],
  linux: ['darwin', 'win32'],
}

const ONNX_ARCHITECTURES = ['arm64', 'x64']

function foreignOnnxRuntimeExclusions(platform, arch) {
  const foreignPlatforms = FOREIGN_ONNX_PLATFORMS[platform]
  if (!foreignPlatforms) {
    throw new Error(`Unsupported Electron platform for ONNX runtime filtering: ${platform}`)
  }
  const targetArch = targetArchitecture(arch)
  return [
    ...foreignPlatforms.map(
      (foreignPlatform) => `!**/node_modules/onnxruntime-node/bin/napi-v6/${foreignPlatform}/**`,
    ),
    ...ONNX_ARCHITECTURES.filter((candidate) => candidate !== targetArch).map(
      (foreignArch) =>
        `!**/node_modules/onnxruntime-node/bin/napi-v6/${platform}/${foreignArch}/**`,
    ),
  ]
}

function appendFileExclusions(files, exclusions) {
  if (!Array.isArray(files)) {
    throw new Error('Electron builder files configuration is not an array')
  }

  const fileSets = files.filter((entry) => entry && typeof entry === 'object')
  if (fileSets.length === 0) {
    for (const exclusion of exclusions) {
      if (!files.includes(exclusion)) files.push(exclusion)
    }
    return
  }

  const defaultFileSet = fileSets.find(
    (entry) => (entry.from == null || entry.from === '.') && Array.isArray(entry.filter),
  )
  if (!defaultFileSet) {
    throw new Error('Electron builder files configuration has no default filter file set')
  }
  for (const exclusion of exclusions) {
    if (!defaultFileSet.filter.includes(exclusion)) defaultFileSet.filter.push(exclusion)
  }
}

function beforePack(context) {
  appendFileExclusions(
    context.packager.config.files,
    foreignOnnxRuntimeExclusions(context.electronPlatformName, context.arch),
  )
}

module.exports = beforePack
module.exports.appendFileExclusions = appendFileExclusions
module.exports.beforePack = beforePack
module.exports.foreignOnnxRuntimeExclusions = foreignOnnxRuntimeExclusions
