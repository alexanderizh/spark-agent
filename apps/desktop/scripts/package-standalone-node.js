const fs = require('fs/promises')
const path = require('path')
const { Arch } = require('builder-util')

function targetArchitecture(value) {
  const architecture = typeof value === 'number' ? Arch[value] : value
  if (architecture !== 'x64' && architecture !== 'arm64') {
    throw new Error(`Standalone Node runtime does not support target architecture: ${architecture}`)
  }
  return architecture
}

function destinationPath(context) {
  const platform = context.electronPlatformName
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename
    return path.join(
      context.appOutDir,
      `${appName}.app`,
      'Contents',
      'Resources',
      'runtime',
      'node',
      'node',
    )
  }
  return path.join(
    context.appOutDir,
    'resources',
    'runtime',
    'node',
    platform === 'win32' ? 'node.exe' : 'node',
  )
}

async function packageStandaloneNodeRuntime(context, options = {}) {
  const targetPlatform = context.electronPlatformName
  const targetArch = targetArchitecture(context.arch)
  const hostPlatform = options.hostPlatform ?? process.platform
  const hostArch = options.hostArch ?? process.arch
  const sourceExecutable =
    options.sourceExecutable ?? process.env.SPARK_STANDALONE_NODE_SOURCE ?? process.execPath
  if (hostPlatform !== targetPlatform || hostArch !== targetArch) {
    throw new Error(
      `Standalone Node runtime build host ${hostPlatform}/${hostArch} does not match target ${targetPlatform}/${targetArch}; run this target on a matching release runner or set SPARK_STANDALONE_NODE_SOURCE`,
    )
  }
  if (options.sourceExecutable == null && process.versions.electron != null) {
    throw new Error('The Electron executable cannot be packaged as the standalone Node runtime')
  }
  const executablePath = destinationPath(context)
  await fs.mkdir(path.dirname(executablePath), { recursive: true })
  await fs.copyFile(sourceExecutable, executablePath)
  if (targetPlatform !== 'win32') await fs.chmod(executablePath, 0o755)
  return { executablePath, sourceExecutable, platform: targetPlatform, architecture: targetArch }
}

module.exports = { packageStandaloneNodeRuntime, destinationPath, targetArchitecture }
