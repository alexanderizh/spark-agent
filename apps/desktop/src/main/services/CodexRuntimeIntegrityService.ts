import { app } from 'electron'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { join } from 'node:path'
import {
  codexTargetTriple,
  getCodexRuntimeRoot as getRuntimeRootFromEnv,
  readManagedCodexRuntimeState,
} from '../../../../../packages/agent-runtime/src/sdk/codex-runtime.js'
import { resolveBundledCodexCli } from '../../../../../packages/agent-runtime/src/sdk/codex-sdk-executor.js'
import {
  fetchSparkInstallManifest,
  resolveArtifactUrl,
  resolveArtifactUrlString,
  type SparkInstallArtifact,
} from '../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'
import { installBinaryArchive } from '../../../../../packages/agent-runtime/src/services/skill-registry/tarball-installer.js'
import { createLogger } from '@spark/shared'
import type { SdkIntegrityInstallProgress } from '@spark/protocol'

const log = createLogger('codex-runtime-integrity')
const CODEX_RUNTIME_ID_PREFIX = 'runtime.codex'
const CODEX_SDK_PACKAGE = '@openai/codex-sdk'

type CodexRuntimeInstallProgress = Omit<SdkIntegrityInstallProgress, 'packageName'>
type CodexRuntimeProgressListener = (progress: CodexRuntimeInstallProgress) => void

export interface CodexRuntimeIntegrity {
  installed: boolean
  installedVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  latestChecked: boolean
  targetTriple: string | null
  artifactId: string | null
  error?: string
}

export function getCodexRuntimeRootPath(): string {
  try {
    return join(app.getPath('userData'), 'agent-runtimes', 'codex')
  } catch {
    // Unit tests and non-Electron consumers may not expose app.getPath yet.
    return join(process.cwd(), '.spark-agent', 'agent-runtimes', 'codex')
  }
}

/** 在任何 SessionService 可能创建前设置，避免 Codex executor 看到旧环境。 */
export function configureCodexRuntimeEnvironment(): string {
  const root = getCodexRuntimeRootPath()
  process.env.SPARK_CODEX_RUNTIME_ROOT = root
  const sdkVersion = detectCodexSdkVersion()
  if (sdkVersion) process.env.SPARK_CODEX_SDK_VERSION = sdkVersion
  if (app.isPackaged) process.env.SPARK_CODEX_REQUIRE_RUNTIME = '1'
  return root
}

function detectCodexSdkVersion(): string | null {
  try {
    // Codex SDK 只暴露 ESM `import` 条件；createRequire().resolve() 会因没有
    // CommonJS `require` export 而抛 ERR_PACKAGE_PATH_NOT_EXPORTED。findPackageJSON
    // 直接定位包元数据，不依赖该包是否提供 CommonJS 入口。
    const packagePath = findPackageJSON(CODEX_SDK_PACKAGE, import.meta.url)
    if (!packagePath) return null
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      name?: string
      version?: string
    }
    if (pkg.name === CODEX_SDK_PACKAGE && pkg.version) return pkg.version
  } catch {
    // 完整性服务会单独报告 JS SDK 缺失；启动配置保持非阻塞。
  }
  return null
}

export async function checkCodexRuntimeIntegrity(
  checkLatest: boolean,
  sdkVersion: string | null = null,
): Promise<CodexRuntimeIntegrity> {
  const root = configureCodexRuntimeEnvironment()
  const state = readManagedCodexRuntimeState(root)
  const bundledInDevelopment = !app.isPackaged && resolveBundledCodexCli() != null
  const targetTriple = state.targetTriple === 'unsupported' ? null : state.targetTriple
  const result: CodexRuntimeIntegrity = {
    installed: state.installed || bundledInDevelopment,
    installedVersion: state.installed ? state.version : bundledInDevelopment ? 'bundled' : null,
    latestVersion: null,
    updateAvailable: false,
    latestChecked: false,
    targetTriple,
    artifactId: null,
  }

  if (!checkLatest || !targetTriple) return result

  try {
    const manifest = await fetchSparkInstallManifest()
    const artifact = selectCodexArtifact(manifest.artifacts, targetTriple, sdkVersion)
    result.latestChecked = true
    if (artifact) {
      result.latestVersion = artifact.version
      result.artifactId = artifact.id
      result.updateAvailable = state.installed
        ? isVersionNewer(artifact.version, state.version)
        : !bundledInDevelopment
    }
  } catch (error) {
    result.latestChecked = true
    result.error = error instanceof Error ? error.message : String(error)
    log.warn(`Failed to check Codex runtime manifest: ${result.error}`)
  }
  return result
}

export async function installCodexRuntime(
  sdkVersion: string | null = null,
  onProgress?: CodexRuntimeProgressListener,
): Promise<{ success: boolean; message: string; newVersion?: string }> {
  const report = (progress: CodexRuntimeInstallProgress) => {
    try {
      onProgress?.(progress)
    } catch {
      // UI progress must never interrupt installation.
    }
  }
  const root = configureCodexRuntimeEnvironment()
  const targetTriple = codexTargetTriple()
  if (!targetTriple) {
    const message = `当前平台不支持 Codex runtime (${process.platform}/${process.arch})`
    report({ state: 'error', downloaded: 0, total: 0, percent: null, message })
    return { success: false, message }
  }
  if (!sdkVersion) {
    const message = '应用内缺少 Codex JS SDK，请先升级或重新安装 Spark Agent'
    report({ state: 'error', downloaded: 0, total: 0, percent: null, message })
    return { success: false, message }
  }

  const stagingRoot = join(root, `.staging-${process.pid}-${Date.now()}`)
  let artifactProgress: Pick<CodexRuntimeInstallProgress, 'artifactId' | 'version'> = {}
  let downloadedBytes = 0
  let totalBytes = 0
  report({
    state: 'preparing',
    downloaded: 0,
    total: 0,
    percent: 0,
    message: '正在获取 Codex 运行时清单',
  })
  try {
    const manifest = await fetchSparkInstallManifest()
    const artifact = selectCodexArtifact(manifest.artifacts, targetTriple, sdkVersion)
    if (!artifact) {
      const message = `云端暂未提供与 @openai/codex-sdk@${sdkVersion} 兼容的 Codex runtime (${targetTriple})`
      report({ state: 'error', downloaded: 0, total: 0, percent: null, message })
      return {
        success: false,
        message,
      }
    }
    validateCodexArtifact(artifact, targetTriple)
    const manifestTotal = artifact.size ?? 0
    const progressBase = { artifactId: artifact.id, version: artifact.version }
    artifactProgress = progressBase
    totalBytes = manifestTotal

    const versionDir = join(stagingRoot, artifact.version, targetTriple)
    await mkdir(versionDir, { recursive: true })
    const resolvedUrl = resolveArtifactUrl(manifest, artifact)
    const fallbackUrls = artifact.fallbackUrls?.map((url) =>
      resolveArtifactUrlString(manifest, url),
    )
    report({
      ...progressBase,
      state: 'downloading',
      downloaded: 0,
      total: manifestTotal,
      percent: 0,
      message: '正在下载 Codex 运行时',
    })
    await installBinaryArchive({
      url: resolvedUrl,
      ...(fallbackUrls?.length ? { fallbackUrls } : {}),
      ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
      ...(artifact.archive?.format ? { format: artifact.archive.format } : {}),
      ...(artifact.archive?.contentRoot ? { contentRoot: artifact.archive.contentRoot } : {}),
      destDir: versionDir,
      onProgress: (downloaded, responseTotal) => {
        const total = responseTotal > 0 ? responseTotal : manifestTotal
        downloadedBytes = downloaded
        totalBytes = total
        const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null
        const completed = total > 0 && downloaded >= total
        report({
          ...progressBase,
          state: completed ? 'verifying' : 'downloading',
          downloaded,
          total,
          percent,
          message: completed ? '下载完成，正在校验并解压' : '正在下载 Codex 运行时',
        })
      },
    })

    const executablePath = join(
      versionDir,
      'bin',
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    )
    const packageManifestPath = join(versionDir, 'codex-package.json')
    if (!existsSync(executablePath) || !existsSync(packageManifestPath)) {
      throw new Error('下载的 Codex runtime 缺少 bin/codex 或 codex-package.json')
    }
    if (process.platform !== 'win32') {
      await chmod(executablePath, 0o755)
      const codeModeHost = join(versionDir, 'bin', 'codex-code-mode-host')
      if (existsSync(codeModeHost)) await chmod(codeModeHost, 0o755)
    }

    report({
      ...progressBase,
      state: 'activating',
      downloaded: totalBytes > 0 ? totalBytes : downloadedBytes,
      total: totalBytes,
      percent: 100,
      message: '正在激活 Codex 运行时',
    })

    const targetDir = join(root, artifact.version, targetTriple)
    await mkdir(join(root, artifact.version), { recursive: true })
    await rm(targetDir, { recursive: true, force: true })
    await rename(versionDir, targetDir)

    await mkdir(root, { recursive: true })
    const activePath = join(root, 'active.json')
    const activeTempPath = `${activePath}.tmp-${process.pid}`
    await writeFile(
      activeTempPath,
      `${JSON.stringify(
        {
          artifactId: artifact.id,
          version: artifact.version,
          targetTriple,
          sdkPackage: artifact.sdkPackage ?? CODEX_SDK_PACKAGE,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await rename(activeTempPath, activePath)
    log.info(`Codex runtime ${artifact.version} activated from ${artifact.id}`)
    const message = `Codex runtime ${artifact.version} 安装成功`
    report({
      ...progressBase,
      state: 'done',
      downloaded: totalBytes > 0 ? totalBytes : downloadedBytes,
      total: totalBytes,
      percent: 100,
      message,
    })
    return { success: true, message, newVersion: artifact.version }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(`Codex runtime install failed: ${message}`)
    const failureMessage = `Codex runtime 安装失败：${message}`
    report({
      ...artifactProgress,
      state: 'error',
      downloaded: downloadedBytes,
      total: totalBytes,
      percent:
        totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null,
      message: failureMessage,
    })
    return { success: false, message: failureMessage }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function selectCodexArtifact(
  artifacts: SparkInstallArtifact[],
  targetTriple: string,
  sdkVersion: string | null,
  platform = process.platform,
  arch = process.arch,
): SparkInstallArtifact | undefined {
  const candidates = artifacts.filter((artifact) => {
    const matchesRuntime =
      artifact.runtime === 'codex' || artifact.id.startsWith(CODEX_RUNTIME_ID_PREFIX)
    return (
      matchesRuntime &&
      isSafeRuntimeVersion(artifact.version) &&
      isCompatibleWithCodexSdk(artifact, sdkVersion) &&
      (!artifact.targetTriple || artifact.targetTriple === targetTriple) &&
      (artifact.platform == null || artifact.platform === platform) &&
      (artifact.arch == null || artifact.arch === arch)
    )
  })
  return candidates.sort((left, right) => compareVersions(right.version, left.version))[0]
}

function isCompatibleWithCodexSdk(
  artifact: SparkInstallArtifact,
  sdkVersion: string | null,
): boolean {
  if (!sdkVersion) return false
  const expected = `@openai/codex-sdk@${sdkVersion}`
  return artifact.sdkPackage === expected || artifact.dependencies?.includes(expected) === true
}

function validateCodexArtifact(artifact: SparkInstallArtifact, targetTriple: string): void {
  if (artifact.type !== 'binary')
    throw new Error(`Codex runtime artifact 类型错误：${artifact.type}`)
  if (!/^[0-9a-f]{64}$/i.test(artifact.sha256 ?? '')) {
    throw new Error('Codex runtime artifact 缺少有效的 SHA256')
  }
  if (artifact.targetTriple && artifact.targetTriple !== targetTriple) {
    throw new Error(`Codex runtime 平台不匹配：${artifact.targetTriple}`)
  }
  if (!isSafeRuntimeVersion(artifact.version)) {
    throw new Error(`Codex runtime 版本号不安全：${artifact.version}`)
  }
  if (artifact.sdkPackage && !artifact.sdkPackage.startsWith('@openai/codex-sdk@')) {
    throw new Error(`Codex runtime SDK 依赖不受支持：${artifact.sdkPackage}`)
  }
}

function isSafeRuntimeVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
}

function compareVersions(left: string, right: string): number {
  const a = (left.replace(/^v/, '').split(/[.+-]/)[0] ?? '').split('.').map(Number)
  const b = (right.replace(/^v/, '').split(/[.+-]/)[0] ?? '').split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return left.localeCompare(right)
}

function isVersionNewer(latest: string, installed: string): boolean {
  return compareVersions(latest, installed) > 0
}

/** 测试与诊断使用；保持调用方不需要知道环境变量细节。 */
export function configuredCodexRuntimeRoot(): string | null {
  return getRuntimeRootFromEnv()
}
