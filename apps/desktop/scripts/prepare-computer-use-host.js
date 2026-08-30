const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const { createLocalNativeHostManifest } = require('./package-native-host.js')
const { createLocalWindowsNativeHostManifest } = require('./package-windows-native-host.js')

const execFileAsync = promisify(execFile)

async function prepareComputerUseHost() {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    console.log(`[computer-use-dev] Native Host is not available on ${process.platform}`)
    return null
  }
  if (process.arch !== 'arm64' && process.arch !== 'x64') {
    throw new Error(`Unsupported Computer Use development architecture: ${process.arch}`)
  }

  const electronExecutable = require('electron')
  const resourcesPath =
    process.platform === 'darwin'
      ? path.resolve(path.dirname(electronExecutable), '../Resources')
      : path.join(path.dirname(electronExecutable), 'resources')
  const nativePlatform = process.platform === 'darwin' ? 'macos' : 'windows'
  const executableName =
    process.platform === 'darwin' ? 'SparkComputerHost' : 'SparkComputerHost.exe'
  const destinationDirectory = path.join(
    resourcesPath,
    'native-host',
    `${nativePlatform}-${process.arch}`,
  )
  await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o755 })

  let sourceExecutable
  let manifest
  if (process.platform === 'darwin') {
    const packageRoot = path.resolve(__dirname, '../native/macos/SparkComputerHost')
    const swiftArchitecture = process.arch === 'x64' ? 'x86_64' : 'arm64'
    await run('swift', ['build', '-c', 'debug', '--arch', swiftArchitecture], packageRoot)
    sourceExecutable = path.join(
      packageRoot,
      '.build',
      `${swiftArchitecture}-apple-macosx`,
      'debug',
      executableName,
    )
    const destinationExecutable = path.join(destinationDirectory, executableName)
    await fs.copyFile(sourceExecutable, destinationExecutable)
    await fs.chmod(destinationExecutable, 0o755)
    await run('/usr/bin/codesign', [
      '--force',
      '--identifier',
      'com.spark-agent.desktop.computer-host',
      '--sign',
      '-',
      destinationExecutable,
    ])
    manifest = createLocalNativeHostManifest({
      executable: await fs.readFile(destinationExecutable),
      architecture: process.arch,
    })
  } else {
    const packageRoot = path.resolve(__dirname, '../native/windows/spark-computer-host')
    await run('cargo', ['build', '--locked', '--features', 'local-trust'], packageRoot)
    sourceExecutable = path.join(packageRoot, 'target', 'debug', executableName)
    const destinationExecutable = path.join(destinationDirectory, executableName)
    await fs.copyFile(sourceExecutable, destinationExecutable)
    await fs.chmod(destinationExecutable, 0o755)
    manifest = createLocalWindowsNativeHostManifest({
      executable: await fs.readFile(destinationExecutable),
      architecture: process.arch,
    })
  }

  await fs.writeFile(
    path.join(destinationDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o644 },
  )
  console.log(
    `[computer-use-dev] prepared ${nativePlatform}-${process.arch} local Host in ${destinationDirectory}`,
  )
  return destinationDirectory
}

async function run(command, args, cwd) {
  await execFileAsync(command, args, {
    ...(cwd == null ? {} : { cwd }),
    env: process.env,
    timeout: 10 * 60_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
}

if (require.main === module) {
  prepareComputerUseHost().catch((error) => {
    console.error(`[computer-use-dev] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

module.exports = { prepareComputerUseHost }
