const { spawnSync } = require('child_process')
const path = require('path')

const nativeVersion = require('../../../packages/protocol/src/computer-use/native-version.json')

function createNativeHostBuildInfo({ platform, architecture, trustMode, commit, generatedAt }) {
  if (platform !== 'macos' && platform !== 'windows') {
    throw new Error(`Unsupported Native Host build platform: ${platform}`)
  }
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported Native Host build architecture: ${architecture}`)
  }
  if (trustMode !== 'local' && trustMode !== 'signed') {
    throw new Error(`Unsupported Native Host build trust mode: ${trustMode}`)
  }
  if (typeof commit !== 'string' || !/^(?:[a-f0-9]{7,64}|unknown)$/i.test(commit)) {
    throw new Error('Native Host build commit is invalid')
  }
  return {
    schemaVersion: 1,
    platform,
    architecture,
    protocol: {
      minimum: nativeVersion.protocolVersion,
      maximum: nativeVersion.protocolVersion,
    },
    hostVersion: nativeVersion.hostVersion,
    commit: commit.toLowerCase(),
    buildMode: trustMode,
    generatedAt: (generatedAt ?? new Date()).toISOString(),
  }
}

function resolveBuildCommit(
  environment = process.env,
  repositoryRoot = path.resolve(__dirname, '../../..'),
) {
  for (const candidate of [environment.SPARK_BUILD_COMMIT, environment.GITHUB_SHA]) {
    const value = candidate?.trim()
    if (value != null && /^[a-f0-9]{7,64}$/i.test(value)) return value.toLowerCase()
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  const value = result.status === 0 ? result.stdout.trim() : ''
  return /^[a-f0-9]{40,64}$/i.test(value) ? value.toLowerCase() : 'unknown'
}

module.exports = {
  NATIVE_HOST_PROTOCOL_VERSION: nativeVersion.protocolVersion,
  NATIVE_HOST_VERSION: nativeVersion.hostVersion,
  createNativeHostBuildInfo,
  resolveBuildCommit,
}
