/**
 * electron-builder 24 only applies `electronLanguages` to the app-level
 * `Contents/Resources/*.lproj` folders on macOS. Electron's framework keeps a
 * second, much larger copy unless we prune it before code signing.
 */
const fs = require('fs/promises')
const path = require('path')
const { packageMacNativeHost } = require('./package-native-host.js')
const {
  inspectWindowsAuthenticode,
  normalizePublisherThumbprint,
  packageWindowsNativeHost,
  resolveWindowsNativeHostTrustMode,
  signWindowsNativeHost,
} = require('./package-windows-native-host.js')
const { packageStandaloneNodeRuntime, targetArchitecture } = require('./package-standalone-node.js')
const { prunePackagedOnnxRuntime } = require('./prune-onnx-runtime.js')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

const MAC_LOCALES_TO_KEEP = new Set(['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj'])

async function pruneMacElectronLocales(appPath) {
  const resourcesDir = path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
  )
  const entries = await fs.readdir(resourcesDir, { withFileTypes: true })
  const localeDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.lproj'))
    .map((entry) => entry.name)

  await Promise.all(
    localeDirectories
      .filter((name) => !MAC_LOCALES_TO_KEEP.has(name))
      .map((name) => fs.rm(path.join(resourcesDir, name), { recursive: true, force: true })),
  )

  const kept = localeDirectories.filter((name) => MAC_LOCALES_TO_KEEP.has(name)).sort()
  const expected = [...MAC_LOCALES_TO_KEEP].sort()
  if (JSON.stringify(kept) !== JSON.stringify(expected)) {
    throw new Error(
      `Electron locale pruning expected ${expected.join(', ')}, found ${kept.join(', ') || '<none>'}`,
    )
  }
  return { kept, removed: localeDirectories.length - kept.length }
}

async function hardenElectronFuses(context, dependencies = { flipFuses }) {
  const productFilename = context.packager.appInfo.productFilename
  const executablePath =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename)
      : context.electronPlatformName === 'win32'
        ? path.join(
            context.appOutDir,
            `${context.packager.platformSpecificBuildOptions.executableName ?? productFilename}.exe`,
          )
        : path.join(context.appOutDir, productFilename)
  await dependencies.flipFuses(executablePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })
}

async function signWindowsStandaloneNodeRuntime(context, runtime, dependencies = {}) {
  const environment = dependencies.environment ?? process.env
  if (resolveWindowsNativeHostTrustMode(environment) === 'local') {
    return { signed: false }
  }

  const expectedPublisherThumbprint = normalizePublisherThumbprint(
    environment.SPARK_WINDOWS_PUBLISHER_THUMBPRINT,
  )
  const sign = dependencies.sign ?? signWindowsNativeHost
  const inspect = dependencies.inspect ?? inspectWindowsAuthenticode
  await sign(context.packager, runtime.executablePath)
  const signature = await inspect(runtime.executablePath, {
    environment,
    expectedPublisherThumbprint,
  })
  if (
    signature.publisherThumbprint !== expectedPublisherThumbprint ||
    signature.timestamped !== true
  ) {
    throw new Error(
      'Standalone Node runtime must use the configured timestamped Authenticode publisher',
    )
  }
  console.log('[after-pack] Standalone Node runtime: signed and publisher verified')
  return { signed: true, signature }
}

function packagedResourcesPath(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
    )
  }
  return path.join(context.appOutDir, 'resources')
}

async function pruneOnnxForContext(
  context,
  dependencies = { prunePackagedOnnxRuntime },
) {
  return dependencies.prunePackagedOnnxRuntime(
    packagedResourcesPath(context),
    context.electronPlatformName,
    targetArchitecture(context.arch),
  )
}

module.exports = async function afterPack(context) {
  const standaloneNodeRuntime = await packageStandaloneNodeRuntime(context)
  const onnxResult = await pruneOnnxForContext(context)
  console.log(
    `[after-pack] ONNX runtime: kept ${onnxResult.kept.join(', ') || '<none>'}, removed ${onnxResult.removed.join(', ') || '<none>'}`,
  )
  if (context.electronPlatformName === 'win32') {
    await signWindowsStandaloneNodeRuntime(context, standaloneNodeRuntime)
    await packageWindowsNativeHost(context)
    await hardenElectronFuses(context)
    return
  }
  if (context.electronPlatformName !== 'darwin') {
    await hardenElectronFuses(context)
    return
  }
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const result = await pruneMacElectronLocales(appPath)
  console.log(
    `[after-pack] Electron locales: kept ${result.kept.join(', ')}, removed ${result.removed}`,
  )
  await packageMacNativeHost(context)
  await hardenElectronFuses(context)
}

module.exports.pruneMacElectronLocales = pruneMacElectronLocales
module.exports.hardenElectronFuses = hardenElectronFuses
module.exports.pruneOnnxForContext = pruneOnnxForContext
module.exports.signWindowsStandaloneNodeRuntime = signWindowsStandaloneNodeRuntime
