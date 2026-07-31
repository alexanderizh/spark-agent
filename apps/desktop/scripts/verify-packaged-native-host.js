const { spawn } = require('child_process')
const { createHash } = require('crypto')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { NATIVE_HOST_PROTOCOL_VERSION, NATIVE_HOST_VERSION } = require('./native-host-build-info.js')

const MAX_FILE_BYTES = 1024 * 1024
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_SMOKE_TIMEOUT_MS = 60_000
const SMOKE_ENVIRONMENT_ALLOWLIST = [
  'APPDATA',
  'ComSpec',
  'DISPLAY',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'ProgramData',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
  'XDG_RUNTIME_DIR',
]

async function validatePackagedNativeHost(options) {
  const executable = await readArtifactFile(options.executablePath, { executable: true })
  const manifest = await readJsonFile(options.manifestPath)
  const buildInfo = await readJsonFile(options.buildInfoPath)
  const expected = {
    platform: options.platform,
    architecture: options.architecture,
    executableFileName: path.basename(options.executablePath),
  }

  assertManifest(manifest, expected, executable)
  assertBuildInfo(buildInfo, expected, manifest, options.allowLocal === true)
  return { manifest, buildInfo }
}

async function readArtifactFile(filePath, options = {}) {
  const stat = await fs.lstat(filePath)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Release artifact must be a regular non-symlink file: ${filePath}`)
  }
  if (stat.size <= 0) throw new Error(`Release artifact is empty: ${filePath}`)
  if (options.executable === true && process.platform !== 'win32' && (stat.mode & 0o111) === 0) {
    throw new Error(`Release artifact is not executable: ${filePath}`)
  }
  return fs.readFile(filePath)
}

async function readJsonFile(filePath) {
  const bytes = await readArtifactFile(filePath)
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error(`JSON artifact exceeds size limit: ${filePath}`)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`JSON artifact is malformed: ${filePath}`, { cause: error })
  }
}

function assertManifest(manifest, expected, executable) {
  if (manifest?.schemaVersion !== 1) throw new Error('Native Host manifest schema is invalid')
  if (manifest.platform !== expected.platform) throw new Error('Native Host platform mismatch')
  if (manifest.architecture !== expected.architecture) {
    throw new Error('Native Host architecture mismatch')
  }
  if (manifest.executableFileName !== expected.executableFileName) {
    throw new Error('Native Host executable name mismatch')
  }
  if (manifest.protocolVersion !== NATIVE_HOST_PROTOCOL_VERSION) {
    throw new Error('Native Host protocol version mismatch')
  }
  if (manifest.hostVersion !== NATIVE_HOST_VERSION) {
    throw new Error('Native Host version mismatch')
  }
  const digest = createHash('sha256').update(executable).digest('hex')
  if (manifest.sha256 !== digest) throw new Error('Native Host final-byte digest mismatch')
}

function assertBuildInfo(buildInfo, expected, manifest, allowLocal) {
  if (buildInfo?.schemaVersion !== 1) throw new Error('Native Host build info schema is invalid')
  if (
    buildInfo.platform !== expected.platform ||
    buildInfo.architecture !== expected.architecture
  ) {
    throw new Error('Native Host build provenance target mismatch')
  }
  if (
    buildInfo.protocol?.minimum !== NATIVE_HOST_PROTOCOL_VERSION ||
    buildInfo.protocol?.maximum !== NATIVE_HOST_PROTOCOL_VERSION
  ) {
    throw new Error('Native Host build provenance protocol range mismatch')
  }
  if (
    buildInfo.hostVersion !== NATIVE_HOST_VERSION ||
    manifest.hostVersion !== buildInfo.hostVersion
  ) {
    throw new Error('Native Host build provenance version mismatch')
  }
  if (!/^(?:[a-f0-9]{7,64}|unknown)$/.test(buildInfo.commit ?? '')) {
    throw new Error('Native Host build provenance commit is invalid')
  }
  if (Number.isNaN(Date.parse(buildInfo.generatedAt ?? ''))) {
    throw new Error('Native Host build provenance timestamp is invalid')
  }
  if (buildInfo.buildMode !== 'signed' && buildInfo.buildMode !== 'local') {
    throw new Error('Native Host build provenance mode is invalid')
  }
  if (!allowLocal && buildInfo.buildMode !== 'signed') {
    throw new Error('Release verification requires a signed Native Host build')
  }
  if (!allowLocal && buildInfo.commit === 'unknown') {
    throw new Error('Release verification requires a concrete source commit')
  }
  if (buildInfo.buildMode === 'local' && manifest.trustMode !== 'local') {
    throw new Error('Local Native Host provenance does not match its manifest')
  }
  if (buildInfo.buildMode === 'signed' && manifest.trustMode === 'local') {
    throw new Error('Signed Native Host provenance does not match its manifest')
  }
}

function assertSmokeReport(report, expected) {
  if (report?.ok !== true) throw new Error('Final App Native Host handshake did not become ready')
  const capabilities = report.capabilities
  const diagnostics = report.diagnostics
  if (capabilities?.available !== true || capabilities.platform !== expected.platform) {
    throw new Error('Final App reported an unavailable or mismatched Native Host platform')
  }
  if (
    capabilities.nativeHost?.protocolVersion !== NATIVE_HOST_PROTOCOL_VERSION ||
    capabilities.nativeHost?.hostVersion !== NATIVE_HOST_VERSION ||
    capabilities.nativeHost?.architecture !== expected.architecture ||
    capabilities.nativeHost?.platform !== expected.platform
  ) {
    throw new Error('Final App Native Host capabilities do not match release provenance')
  }
  if (
    diagnostics?.result?.diagnosticCode !== 'native_host_ready' ||
    diagnostics?.result?.stage !== 'handshake' ||
    diagnostics?.runtime?.platform !== expected.platform ||
    diagnostics?.runtime?.architecture !== expected.architecture ||
    diagnostics?.host?.version !== NATIVE_HOST_VERSION ||
    diagnostics?.host?.protocolVersion !== NATIVE_HOST_PROTOCOL_VERSION
  ) {
    throw new Error('Final App Native Host diagnostic report does not prove a valid handshake')
  }
}

function detectWindowsPeArchitecture(executable) {
  if (
    !Buffer.isBuffer(executable) ||
    executable.length < 64 ||
    executable.toString('ascii', 0, 2) !== 'MZ'
  ) {
    throw new Error('Windows executable does not contain a valid DOS header')
  }
  const peOffset = executable.readUInt32LE(0x3c)
  if (
    peOffset + 6 > executable.length ||
    executable.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0'
  ) {
    throw new Error('Windows executable does not contain a valid PE header')
  }
  const machine = executable.readUInt16LE(peOffset + 4)
  if (machine === 0x8664) return 'x64'
  if (machine === 0xaa64) return 'arm64'
  throw new Error(`Unsupported Windows PE machine: 0x${machine.toString(16)}`)
}

async function runFinalAppSmoke(options) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-native-release-smoke-'))
  const reportPath = path.join(tempRoot, 'report.json')
  const userDataPath = path.join(tempRoot, 'user-data')
  try {
    const result = await runCommand(
      options.appExecutable,
      ['--spark-verify-native-host', `--user-data-dir=${userDataPath}`],
      {
        env: {
          ...createSmokeEnvironment({ ...process.env, ...options.env }),
          SPARK_NATIVE_HOST_SMOKE_REPORT: reportPath,
        },
        timeoutMs: options.timeoutMs ?? DEFAULT_SMOKE_TIMEOUT_MS,
      },
    )
    if (result.code !== 0) {
      throw new Error(
        `Final App Native Host smoke exited with ${result.code}: ${summarizeOutput(result.stderr, result.stdout)}`,
      )
    }
    const report = await readJsonFile(reportPath)
    assertSmokeReport(report, options)
    return report
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

function createSmokeEnvironment(environment) {
  const sanitized = {}
  for (const key of SMOKE_ENVIRONMENT_ALLOWLIST) {
    if (environment[key] != null) sanitized[key] = environment[key]
  }
  return sanitized
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
    let settled = false
    let timer
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finish(() => reject(new Error(`${command} exceeded the release verification log limit`)))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', (error) => finish(() => reject(error)))
    child.once('close', (code) =>
      finish(() =>
        resolve({
          code: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        }),
      ),
    )
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new Error(`${command} exceeded the release smoke timeout`)))
    }, options.timeoutMs ?? DEFAULT_SMOKE_TIMEOUT_MS)
  })
}

function summarizeOutput(...outputs) {
  return outputs.join('\n').trim().replace(/\s+/g, ' ').slice(0, 2_000) || '<empty output>'
}

function parseArguments(argv, required) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--allow-local') {
      parsed.allowLocal = true
      continue
    }
    if (!key.startsWith('--') || argv[index + 1] == null) {
      throw new Error(`Invalid release verifier argument: ${key}`)
    }
    parsed[key.slice(2)] = argv[index + 1]
    index += 1
  }
  for (const key of required) {
    if (typeof parsed[key] !== 'string' || parsed[key].trim() === '') {
      throw new Error(`Missing required release verifier argument: --${key}`)
    }
  }
  if (parsed.arch !== 'arm64' && parsed.arch !== 'x64') {
    throw new Error('Release verifier --arch must be arm64 or x64')
  }
  return parsed
}

module.exports = {
  assertBuildInfo,
  assertManifest,
  assertSmokeReport,
  createSmokeEnvironment,
  detectWindowsPeArchitecture,
  parseArguments,
  readArtifactFile,
  runCommand,
  runFinalAppSmoke,
  validatePackagedNativeHost,
}
