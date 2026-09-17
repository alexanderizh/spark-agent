import { app } from 'electron'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { join } from 'node:path'
import {
  MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION,
  codexTargetTriple,
  compareRuntimeVersions,
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
  note?: string
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
    const selection = selectCodexRuntimeArtifact(manifest.artifacts, targetTriple, sdkVersion)
    result.latestChecked = true
    const newestPublished = selection.candidateVersions[0] ?? null
    // 已安装的运行时不低于云端最新制品：已经没有可执行的动作，
    // 此时既不该报错，也不该解释「为什么不装更新的」。
    const installedCoversNewest =
      state.installed && newestPublished != null && !isVersionNewer(newestPublished, state.version)
    if (selection.artifact) {
      result.latestVersion = selection.artifact.version
      result.artifactId = selection.artifact.id
      result.updateAvailable = state.installed
        ? isVersionNewer(selection.artifact.version, state.version)
        : !bundledInDevelopment
      if (selection.reason === 'newest-compatible') {
        log.info(
          `Codex runtime 无与应用内 Codex SDK ${sdkVersion ?? '<unknown>'} 精确配对的制品，` +
            `回退到 ${selection.artifact.version}（候选：${selection.candidateVersions.join(', ')}）`,
        )
      }
      if (
        newestPublished != null &&
        newestPublished !== selection.artifact.version &&
        !installedCoversNewest
      ) {
        // 选中版本不是云端最新：说明「云端还有更新的制品，但它与应用内置 SDK 不配对」，
        // 否则用户只会在「最新」旁边看到自己无法理解的静默。
        result.note =
          `云端已有更新版本 ${newestPublished}，但它与应用内置的 Codex SDK ${sdkVersion ?? '（未知）'} 不配对。` +
          '请先升级 Spark Agent 应用，再更新 Codex 运行时。'
      }
    } else if (installedCoversNewest) {
      // 没有可安装制品，但本机已经跑着不低于云端最新的运行时：按「已是最新」呈现。
      result.latestVersion = state.version
      log.info(
        `Codex runtime ${state.version} 已覆盖云端最新制品 ${newestPublished}（reason=${selection.reason}），无可用更新`,
      )
    } else {
      // 必须显式说明「为什么没有可用更新」，否则用户只能看到一片空白。
      result.error = describeCodexRuntimeSelection(selection, targetTriple, sdkVersion)
      log.warn(
        `Codex runtime 无可安装制品：reason=${selection.reason} triple=${targetTriple} ` +
          `sdk=${sdkVersion ?? '<unknown>'} candidates=${selection.candidateVersions.join(', ') || '<none>'}`,
      )
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
    const selection = selectCodexRuntimeArtifact(manifest.artifacts, targetTriple, sdkVersion)
    const artifact = selection.artifact
    if (!artifact) {
      const reason = describeCodexRuntimeSelection(selection, targetTriple, sdkVersion)
      const message =
        reason.length > 0 ? reason : `云端暂未提供 ${targetTriple} 平台的 Codex 运行时`
      log.warn(
        `Codex runtime 安装中止：reason=${selection.reason} triple=${targetTriple} ` +
          `sdk=${sdkVersion ?? '<unknown>'} candidates=${selection.candidateVersions.join(', ') || '<none>'}`,
      )
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

export type CodexRuntimeSelectionReason =
  /** 命中与应用内 JS SDK 完全配对的制品（最稳）。 */
  | 'exact-sdk-match'
  /** 没有配对制品，退到不高于应用内 SDK 的最新受支持版本。 */
  | 'newest-compatible'
  /** 云端 manifest 没有任何本平台/架构的 Codex runtime。 */
  | 'no-published-runtime'
  /** 云端有该平台制品，但版本全部低于应用声明的协议基线。 */
  | 'below-protocol-baseline'
  /** 云端有制品但全部晚于应用内 SDK（应用比仓库更旧）。 */
  | 'newer-than-app-sdk'

export interface CodexRuntimeSelection {
  artifact?: SparkInstallArtifact
  reason: CodexRuntimeSelectionReason
  /** 通过平台/协议基线过滤后的候选版本（新 → 旧），用于日志与提示。 */
  candidateVersions: string[]
}

/**
 * 选择可安装的 Codex runtime。
 *
 * 历史缺陷：这里曾要求 `artifact.sdkPackage === '@openai/codex-sdk@' + 应用内 SDK`
 * 精确相等。只要云端仓库还没为应用当前的 SDK 版本发布 runtime（应用刚发版、
 * 或应用 pin 了仓库从未发布过的版本），筛选结果就是空集：完整性页既查不到
 * 「可用更新」，点安装也只会得到一句含糊的兼容性报错，而 Codex 自身则完全不可用。
 *
 * 现在的策略与运行时的实际接受规则保持一致（`resolveManagedCodexCli` 只按
 * `MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION` 这个协议基线放行）：
 *   1. 优先精确配对应用内 SDK 的制品；
 *   2. 否则退到「不高于应用内 SDK 的最新受支持版本」——runtime 比应用 JS SDK 旧
 *      是受支持方向（见 codex-runtime.ts 的说明），且这正是此前完全取不到值的场景；
 *   3. 只有在云端制品全部晚于应用内 SDK 时才放弃，并给出可读原因。
 */
export function selectCodexRuntimeArtifact(
  artifacts: SparkInstallArtifact[],
  targetTriple: string,
  sdkVersion: string | null,
  platform = process.platform,
  arch = process.arch,
): CodexRuntimeSelection {
  const published = artifacts.filter((artifact) => {
    const matchesRuntime =
      artifact.runtime === 'codex' || artifact.id.startsWith(CODEX_RUNTIME_ID_PREFIX)
    return (
      matchesRuntime &&
      isSafeRuntimeVersion(artifact.version) &&
      (!artifact.targetTriple || artifact.targetTriple === targetTriple) &&
      (artifact.platform == null || artifact.platform === platform) &&
      (artifact.arch == null || artifact.arch === arch)
    )
  })
  // 低于协议基线的 runtime 连加载都不允许，更不该被推荐安装。
  const supported = published
    .filter(
      (artifact) =>
        compareRuntimeVersions(artifact.version, MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION) >= 0,
    )
    .sort((left, right) => compareVersions(right.version, left.version))
  const candidateVersions = supported.map((artifact) => artifact.version)

  if (supported.length === 0) {
    return {
      reason: published.length > 0 ? 'below-protocol-baseline' : 'no-published-runtime',
      candidateVersions: published.map((artifact) => artifact.version),
    }
  }

  const normalizedSdkVersion = sdkVersion?.trim() ?? ''
  if (normalizedSdkVersion.length > 0) {
    const exact = supported.find((artifact) =>
      isCompatibleWithCodexSdk(artifact, normalizedSdkVersion),
    )
    if (exact) return { artifact: exact, reason: 'exact-sdk-match', candidateVersions }
  }

  const notNewerThanApp = supported.filter(
    (artifact) =>
      normalizedSdkVersion.length === 0 ||
      compareRuntimeVersions(artifact.version, normalizedSdkVersion) <= 0,
  )
  const bestCompatible = notNewerThanApp[0]
  if (bestCompatible != null) {
    return { artifact: bestCompatible, reason: 'newest-compatible', candidateVersions }
  }

  // 走到这里只可能是「所有候选都新于应用内 SDK」。SDK 版本未知时上面的
  // notNewerThanApp 会保留全部候选，因此不会再落到这个分支。
  return { reason: 'newer-than-app-sdk', candidateVersions }
}

/** 兼容既有调用点：只关心选中的制品。 */
export function selectCodexArtifact(
  artifacts: SparkInstallArtifact[],
  targetTriple: string,
  sdkVersion: string | null,
  platform = process.platform,
  arch = process.arch,
): SparkInstallArtifact | undefined {
  return selectCodexRuntimeArtifact(artifacts, targetTriple, sdkVersion, platform, arch).artifact
}

/** 把选择结果翻译成用户能看懂、能自己解决的一句话。 */
export function describeCodexRuntimeSelection(
  selection: CodexRuntimeSelection,
  targetTriple: string,
  sdkVersion: string | null,
): string {
  const sdk = sdkVersion?.trim() || '未知'
  switch (selection.reason) {
    case 'no-published-runtime':
      return (
        `云端仓库暂未提供 ${targetTriple} 平台的 Codex 运行时。` +
        '请检查网络后重试；若持续存在，请等待仓库补齐该平台制品或反馈给维护者。'
      )
    case 'newer-than-app-sdk':
      return (
        `云端 Codex 运行时（${selection.candidateVersions.slice(0, 3).join(' / ')}）全部新于应用内置的` +
        ` Codex SDK ${sdk}，直接安装可能不兼容。请先升级 Spark Agent 应用，再更新 Codex 运行时。`
      )
    case 'below-protocol-baseline':
      return (
        `云端 ${targetTriple} 平台的 Codex 运行时（${selection.candidateVersions.slice(0, 3).join(' / ')}）` +
        `全部低于应用要求的协议基线 ${MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION}，无法安装。` +
        '请等待仓库补齐该平台的运行时制品。'
      )
    default:
      return ''
  }
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
