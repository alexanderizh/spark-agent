const FOREIGN_ONNX_PLATFORMS = {
  darwin: ['linux', 'win32'],
  win32: ['darwin', 'linux'],
  linux: ['darwin', 'win32'],
}

function foreignOnnxRuntimeExclusions(platform) {
  const foreignPlatforms = FOREIGN_ONNX_PLATFORMS[platform]
  if (!foreignPlatforms) {
    throw new Error(`Unsupported Electron platform for ONNX runtime filtering: ${platform}`)
  }
  return foreignPlatforms.map(
    (foreignPlatform) =>
      `!**/node_modules/onnxruntime-node/bin/napi-v6/${foreignPlatform}/**`,
  )
}

function beforePack(context) {
  const files = context.packager.config.files
  for (const exclusion of foreignOnnxRuntimeExclusions(context.electronPlatformName)) {
    if (!files.includes(exclusion)) files.push(exclusion)
  }
}

module.exports = beforePack
module.exports.beforePack = beforePack
module.exports.foreignOnnxRuntimeExclusions = foreignOnnxRuntimeExclusions
