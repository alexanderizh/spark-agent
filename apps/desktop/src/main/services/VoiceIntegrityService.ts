import { app } from 'electron'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import {
  fetchSparkInstallManifest,
  resolveArtifactUrl,
  resolveArtifactUrlString,
  type SparkInstallArtifact,
  type SparkInstallManifest,
} from '../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'
import { installBinaryArchive } from '../../../../../packages/agent-runtime/src/services/skill-registry/tarball-installer.js'
import { createLogger } from '@spark/shared'
import type {
  VoiceComponentStatus,
  VoiceInstallProgress,
  VoiceIntegrityStatus,
  VoicePackComponent,
} from '@spark/protocol'

const log = createLogger('voice-integrity')

/** manifest 中语音包 artifact id 前缀约定 */
const VOICE_NATIVE_ID_PREFIX = 'voice.native.'
const VOICE_MODEL_ID_PREFIX = 'voice.model.'
const VOICE_REFINE_ID_PREFIX = 'voice.refine.'
const VOICE_KWS_ID_PREFIX = 'voice.kws.'
/** 识别模型约 219MB，弱网下不能沿用通用归档的 2 分钟超时。 */
const VOICE_ARCHIVE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

/** sherpa-onnx-node 提供 prebuilt 的平台组合 */
export type VoicePlatformKey = 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'linux-x64'

export function voicePlatformKey(
  platform = process.platform,
  arch = process.arch,
): VoicePlatformKey | null {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  return null
}

export function getVoiceRootPath(): string {
  try {
    return join(app.getPath('userData'), 'voice')
  } catch {
    // 单测与非 Electron 消费方：app.getPath 不可用时回落到工作目录。
    return join(process.cwd(), '.spark-agent', 'voice')
  }
}

export function getVoiceNativeDir(): string {
  return join(getVoiceRootPath(), 'native')
}

export function getVoiceModelDir(): string {
  return join(getVoiceRootPath(), 'model')
}

export function getVoiceRefineDir(): string {
  return join(getVoiceRootPath(), 'refine')
}

export function getVoiceKwsDir(): string {
  return join(getVoiceRootPath(), 'kws')
}

interface VoiceStateNative {
  version: string
  platformKey: string
  artifactId: string
}
interface VoiceStateModel {
  version: string
  artifactId: string
}
interface VoiceStateRefine {
  version: string
  artifactId: string
}
interface VoiceStateKws {
  version: string
  artifactId: string
}
interface VoiceState {
  native?: VoiceStateNative
  model?: VoiceStateModel
  refine?: VoiceStateRefine
  kws?: VoiceStateKws
  updatedAt?: string
}

function readVoiceState(): VoiceState {
  try {
    const raw = readFileSync(join(getVoiceRootPath(), 'voice-state.json'), 'utf8')
    const parsed = JSON.parse(raw) as VoiceState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeVoiceState(state: VoiceState): Promise<void> {
  const root = getVoiceRootPath()
  await mkdir(root, { recursive: true })
  const target = join(root, 'voice-state.json')
  const tmp = `${target}.tmp-${process.pid}`
  await writeFile(
    tmp,
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
  await rename(tmp, target)
}

/** 供 VoiceRecognitionService 使用：解析已激活的 native 模块与模型目录。 */
export interface VoiceModelPaths {
  nativeDir: string
  modelDir: string
  /** native 模块 .node 入口绝对路径（package.json.main 解析） */
  nativeMain: string
}

function resolveContainedPath(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null
  const resolvedRoot = resolve(root)
  const candidate = resolve(resolvedRoot, relativePath)
  if (candidate === resolvedRoot || !candidate.startsWith(`${resolvedRoot}${sep}`)) return null
  return candidate
}

function resolveInstalledNative(
  state: VoiceState,
  platformKey: VoicePlatformKey | null,
): { nativeDir: string; nativeMain: string } | null {
  if (!state.native || !platformKey || state.native.platformKey !== platformKey) return null
  if (typeof state.native.version !== 'string' || !isSafeVersion(state.native.version)) return null
  const nativeDir = join(getVoiceNativeDir(), `${state.native.version}-${platformKey}`)
  if (!existsSync(nativeDir)) return null
  try {
    const pkg = JSON.parse(readFileSync(join(nativeDir, 'package.json'), 'utf8')) as {
      main?: unknown
    }
    if (typeof pkg.main !== 'string') return null
    const nativeMain = resolveContainedPath(nativeDir, pkg.main)
    if (!nativeMain || !existsSync(nativeMain)) return null
    return { nativeDir, nativeMain }
  } catch {
    return null
  }
}

export function resolveVoiceModelPaths(): VoiceModelPaths | null {
  const platformKey = voicePlatformKey()
  const state = readVoiceState()
  const native = resolveInstalledNative(state, platformKey)
  if (!native || !state.model || !isModelInstalled(state)) return null
  const modelDir = join(getVoiceModelDir(), state.model.version)
  return { nativeDir: native.nativeDir, modelDir, nativeMain: native.nativeMain }
}

/** 已安装的离线精修模型（可选组件）解析结果 */
export interface VoiceRefinePaths {
  version: string
  /** SenseVoice 离线模型 onnx 文件绝对路径 */
  modelPath: string
  /** tokens.txt 绝对路径 */
  tokensPath: string
}

/**
 * 解析已安装的离线精修模型；未安装或描述无效时返回 null（调用方回退纯流式识别）。
 * refine-package.json 结构：{ version, kind: 'sense-voice', model, tokens }
 */
export function resolveVoiceRefinePaths(): VoiceRefinePaths | null {
  const state = readVoiceState()
  if (!state.refine || !isRefineInstalled(state)) return null
  const dir = join(getVoiceRefineDir(), state.refine.version)
  try {
    const pkgPath = join(dir, 'refine-package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      version?: unknown
      kind?: unknown
      model?: unknown
      tokens?: unknown
    }
    if (pkg.kind !== 'sense-voice') return null
    if (typeof pkg.model !== 'string' || typeof pkg.tokens !== 'string') return null
    const modelPath = resolveContainedPath(dir, pkg.model)
    const tokensPath = resolveContainedPath(dir, pkg.tokens)
    if (!modelPath || !tokensPath || !existsSync(modelPath) || !existsSync(tokensPath)) return null
    return {
      version: typeof pkg.version === 'string' ? pkg.version : state.refine.version,
      modelPath,
      tokensPath,
    }
  } catch {
    return null
  }
}

function isNativeInstalled(state: VoiceState, platformKey: VoicePlatformKey | null): boolean {
  return resolveInstalledNative(state, platformKey) != null
}

function isModelInstalled(state: VoiceState): boolean {
  if (!state.model) return false
  if (typeof state.model.version !== 'string' || !isSafeVersion(state.model.version)) return false
  const dir = join(getVoiceModelDir(), state.model.version)
  if (!existsSync(dir)) return false
  return existsSync(join(dir, 'model-package.json'))
}

function isRefineInstalled(state: VoiceState): boolean {
  if (!state.refine) return false
  if (typeof state.refine.version !== 'string' || !isSafeVersion(state.refine.version)) return false
  const dir = join(getVoiceRefineDir(), state.refine.version)
  if (!existsSync(dir)) return false
  return existsSync(join(dir, 'refine-package.json'))
}

function isKwsInstalled(state: VoiceState): boolean {
  if (!state.kws) return false
  if (typeof state.kws.version !== 'string' || !isSafeVersion(state.kws.version)) return false
  const dir = join(getVoiceKwsDir(), state.kws.version)
  if (!existsSync(dir)) return false
  return existsSync(join(dir, 'kws-package.json'))
}

function isVoiceRefineVersionInstalled(version: string): boolean {
  if (!isSafeVersion(version)) return false
  return existsSync(join(getVoiceRefineDir(), version, 'refine-package.json'))
}

function isVoiceKwsVersionInstalled(version: string): boolean {
  if (!isSafeVersion(version)) return false
  return existsSync(join(getVoiceKwsDir(), version, 'kws-package.json'))
}

/** 已安装的唤醒词模型（可选组件）解析结果 */
export interface VoiceKwsPaths {
  version: string
  encoderPath: string
  decoderPath: string
  joinerPath: string
  tokensPath: string
  phonePath: string | null
  /** 包内默认 keywords.txt（含全部预设唤醒词） */
  keywordsPath: string | null
}

/**
 * 解析已安装的唤醒词模型；未安装或描述无效时返回 null（语音助手常驻聆听不可用，
 * 快捷键唤醒不受影响）。kws-package.json 结构：
 * { version, kind: 'kws', encoder, decoder, joiner, tokens, phone?, keywords? }
 */
export function resolveVoiceKwsPaths(): VoiceKwsPaths | null {
  const state = readVoiceState()
  if (!state.kws || !isKwsInstalled(state)) return null
  const dir = join(getVoiceKwsDir(), state.kws.version)
  try {
    const pkgPath = join(dir, 'kws-package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      version?: unknown
      kind?: unknown
      encoder?: unknown
      decoder?: unknown
      joiner?: unknown
      tokens?: unknown
      phone?: unknown
      keywords?: unknown
    }
    if (pkg.kind !== 'kws') return null
    if (
      typeof pkg.encoder !== 'string' ||
      typeof pkg.decoder !== 'string' ||
      typeof pkg.joiner !== 'string' ||
      typeof pkg.tokens !== 'string'
    ) {
      return null
    }
    const encoderPath = resolveContainedPath(dir, pkg.encoder)
    const decoderPath = resolveContainedPath(dir, pkg.decoder)
    const joinerPath = resolveContainedPath(dir, pkg.joiner)
    const tokensPath = resolveContainedPath(dir, pkg.tokens)
    if (
      !encoderPath ||
      !decoderPath ||
      !joinerPath ||
      !tokensPath ||
      !existsSync(encoderPath) ||
      !existsSync(decoderPath) ||
      !existsSync(joinerPath) ||
      !existsSync(tokensPath)
    ) {
      return null
    }
    const phonePath = typeof pkg.phone === 'string' ? resolveContainedPath(dir, pkg.phone) : null
    const keywordsPath =
      typeof pkg.keywords === 'string' ? resolveContainedPath(dir, pkg.keywords) : null
    return {
      version: typeof pkg.version === 'string' ? pkg.version : state.kws.version,
      encoderPath,
      decoderPath,
      joinerPath,
      tokensPath,
      phonePath: phonePath != null && existsSync(phonePath) ? phonePath : null,
      keywordsPath: keywordsPath != null && existsSync(keywordsPath) ? keywordsPath : null,
    }
  } catch {
    return null
  }
}

function isVoiceModelVersionInstalled(version: string): boolean {
  if (!isSafeVersion(version)) return false
  return existsSync(join(getVoiceModelDir(), version, 'model-package.json'))
}

function isVoiceNativeVersionInstalled(version: string, platformKey: VoicePlatformKey): boolean {
  if (!isSafeVersion(version)) return false
  const syntheticState: VoiceState = {
    native: { version, platformKey, artifactId: 'recovered-from-disk' },
  }
  return resolveInstalledNative(syntheticState, platformKey) != null
}

export function selectVoiceNativeArtifact(
  artifacts: SparkInstallArtifact[],
  platform = process.platform,
  arch = process.arch,
): SparkInstallArtifact | undefined {
  const candidates = artifacts.filter((a) => {
    if (a.type !== 'voice') return false
    if (!a.id.startsWith(VOICE_NATIVE_ID_PREFIX)) return false
    if (!isSafeVersion(a.version)) return false
    if (a.platform != null && a.platform !== platform) return false
    if (a.arch != null && a.arch !== arch) return false
    return true
  })
  return candidates.sort((a, b) => compareVersions(b.version, a.version))[0]
}

export function selectVoiceModelArtifact(
  artifacts: SparkInstallArtifact[],
): SparkInstallArtifact | undefined {
  const candidates = artifacts.filter((a) => {
    if (a.type !== 'voice') return false
    if (!a.id.startsWith(VOICE_MODEL_ID_PREFIX)) return false
    if (!isSafeVersion(a.version)) return false
    return true
  })
  return candidates.sort((a, b) => compareVersions(b.version, a.version))[0]
}

/** 离线精修模型为可选组件，manifest 未提供时允许静默缺失 */
export function selectVoiceRefineArtifact(
  artifacts: SparkInstallArtifact[],
): SparkInstallArtifact | undefined {
  const candidates = artifacts.filter((a) => {
    if (a.type !== 'voice') return false
    if (!a.id.startsWith(VOICE_REFINE_ID_PREFIX)) return false
    if (!isSafeVersion(a.version)) return false
    return true
  })
  return candidates.sort((a, b) => compareVersions(b.version, a.version))[0]
}

/** 唤醒词模型为可选组件，manifest 未提供时允许静默缺失 */
export function selectVoiceKwsArtifact(
  artifacts: SparkInstallArtifact[],
): SparkInstallArtifact | undefined {
  const candidates = artifacts.filter((a) => {
    if (a.type !== 'voice') return false
    if (!a.id.startsWith(VOICE_KWS_ID_PREFIX)) return false
    if (!isSafeVersion(a.version)) return false
    return true
  })
  return candidates.sort((a, b) => compareVersions(b.version, a.version))[0]
}

export async function checkVoiceIntegrity(checkLatest: boolean): Promise<VoiceIntegrityStatus> {
  const platformKey = voicePlatformKey()
  const state = readVoiceState()
  const nativeInstalled = isNativeInstalled(state, platformKey)
  const modelInstalled = isModelInstalled(state)
  const refineInstalled = isRefineInstalled(state)
  const kwsInstalled = isKwsInstalled(state)

  const components: VoiceComponentStatus[] = [
    {
      component: 'native',
      state: nativeInstalled ? 'ready' : 'missing',
      installedVersion: state.native?.version ?? null,
      latestVersion: null,
      artifactId: state.native?.artifactId ?? null,
      percent: null,
      message: nativeInstalled ? null : '未安装语音识别运行时',
    },
    {
      component: 'model',
      state: modelInstalled ? 'ready' : 'missing',
      installedVersion: state.model?.version ?? null,
      latestVersion: null,
      artifactId: state.model?.artifactId ?? null,
      percent: null,
      message: modelInstalled ? null : '未安装语音识别模型',
    },
    {
      component: 'refine',
      state: refineInstalled ? 'ready' : 'missing',
      installedVersion: state.refine?.version ?? null,
      latestVersion: null,
      artifactId: state.refine?.artifactId ?? null,
      percent: null,
      message: refineInstalled ? null : '未安装离线精修模型（可选，用于说完后整段优化）',
    },
    {
      component: 'kws',
      state: kwsInstalled ? 'ready' : 'missing',
      installedVersion: state.kws?.version ?? null,
      latestVersion: null,
      artifactId: state.kws?.artifactId ?? null,
      percent: null,
      message: kwsInstalled ? null : '未安装唤醒词模型（可选，用于语音助手常驻聆听）',
    },
  ]

  const status: VoiceIntegrityStatus = {
    ready: nativeInstalled && modelInstalled,
    downloading: false,
    supported: platformKey != null,
    unsupportedReason:
      platformKey == null ? `当前平台不支持语音输入 (${process.platform}/${process.arch})` : null,
    components,
    lastError: null,
  }

  if (!checkLatest || !platformKey) return status

  try {
    const manifest = await fetchSparkInstallManifest()
    const nativeArtifact = selectVoiceNativeArtifact(manifest.artifacts)
    const modelArtifact = selectVoiceModelArtifact(manifest.artifacts)
    const refineArtifact = selectVoiceRefineArtifact(manifest.artifacts)
    const kwsArtifact = selectVoiceKwsArtifact(manifest.artifacts)
    const nativeComp = components.find((c) => c.component === 'native')
    const modelComp = components.find((c) => c.component === 'model')
    const refineComp = components.find((c) => c.component === 'refine')
    const kwsComp = components.find((c) => c.component === 'kws')
    if (nativeArtifact && nativeComp) {
      nativeComp.latestVersion = nativeArtifact.version
      nativeComp.artifactId = nativeArtifact.id
    }
    if (modelArtifact && modelComp) {
      modelComp.latestVersion = modelArtifact.version
      modelComp.artifactId = modelArtifact.id
    }
    if (refineArtifact && refineComp) {
      refineComp.latestVersion = refineArtifact.version
      refineComp.artifactId = refineArtifact.id
    }
    if (kwsArtifact && kwsComp) {
      kwsComp.latestVersion = kwsArtifact.version
      kwsComp.artifactId = kwsArtifact.id
    }
  } catch (err) {
    status.lastError = err instanceof Error ? err.message : String(err)
    log.warn(`Failed to check voice manifest: ${status.lastError}`)
  }
  return status
}

let installInFlight = false

export function isVoiceInstallInFlight(): boolean {
  return installInFlight
}

interface InstallComponentParams {
  component: VoicePackComponent
  artifact: SparkInstallArtifact
  destFinal: string
  stagingRoot: string
  manifest: SparkInstallManifest
  report: (progress: VoiceInstallProgress) => void
}

async function installComponent(params: InstallComponentParams): Promise<void> {
  const { component, artifact, destFinal, stagingRoot, manifest, report } = params
  const manifestTotal = artifact.size ?? 0
  const stagingDir = join(stagingRoot, component)
  const label = component === 'native' ? '运行时' : component === 'refine' ? '精修模型' : '模型'
  const progressBase = { component, artifactId: artifact.id, version: artifact.version }

  const sha256 = artifact.sha256
  if (!sha256 || !/^[0-9a-f]{64}$/i.test(sha256)) {
    throw new Error(`语音${label} artifact 缺少有效的 SHA256`)
  }

  report({
    ...progressBase,
    state: 'preparing',
    downloaded: 0,
    total: manifestTotal,
    percent: 0,
    message: `正在准备语音${label}下载`,
  })

  const resolvedUrl = resolveArtifactUrl(manifest, artifact)
  const fallbackUrls = artifact.fallbackUrls?.map((u) => resolveArtifactUrlString(manifest, u))

  report({
    ...progressBase,
    state: 'downloading',
    downloaded: 0,
    total: manifestTotal,
    percent: 0,
    message: `正在下载语音${label}`,
  })

  await installBinaryArchive({
    url: resolvedUrl,
    ...(fallbackUrls?.length ? { fallbackUrls } : {}),
    sha256,
    ...(artifact.archive?.format ? { format: artifact.archive.format } : {}),
    ...(artifact.archive?.contentRoot ? { contentRoot: artifact.archive.contentRoot } : {}),
    destDir: stagingDir,
    downloadTimeoutMs: VOICE_ARCHIVE_DOWNLOAD_TIMEOUT_MS,
    onProgress: (downloaded, responseTotal) => {
      const total = responseTotal > 0 ? responseTotal : manifestTotal
      const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null
      const completed = total > 0 && downloaded >= total
      report({
        ...progressBase,
        state: completed ? 'verifying' : 'downloading',
        downloaded,
        total,
        percent,
        message: completed ? '下载完成，正在校验并解压' : `正在下载语音${label}`,
      })
    },
  })

  report({
    ...progressBase,
    state: 'activating',
    downloaded: manifestTotal,
    total: manifestTotal,
    percent: 100,
    message: `正在激活语音${label}`,
  })

  // 原子激活：删旧目录 -> rename staging -> 最终目录
  await rm(destFinal, { recursive: true, force: true })
  await mkdir(join(destFinal, '..'), { recursive: true })
  await rename(stagingDir, destFinal)
}

export async function installVoicePack(
  force = false,
  onProgress?: (progress: VoiceInstallProgress) => void,
): Promise<{ success: boolean; message: string; status: VoiceIntegrityStatus }> {
  const report = (progress: VoiceInstallProgress) => {
    try {
      onProgress?.(progress)
    } catch {
      // UI 进度回调不得中断安装。
    }
  }

  if (installInFlight) {
    const message = '语音包正在安装中，请稍候'
    const status = await checkVoiceIntegrity(false)
    return { success: false, message, status: { ...status, downloading: true } }
  }

  const platformKey = voicePlatformKey()
  if (!platformKey) {
    const message = `当前平台不支持语音输入 (${process.platform}/${process.arch})`
    report({ component: 'native', state: 'error', downloaded: 0, total: 0, percent: null, message })
    return { success: false, message, status: await checkVoiceIntegrity(false) }
  }

  installInFlight = true
  const root = getVoiceRootPath()
  const stagingRoot = join(root, `.staging-${process.pid}-${Date.now()}`)
  let modelArtifact: SparkInstallArtifact | undefined
  let nativeArtifact: SparkInstallArtifact | undefined
  let refineArtifact: SparkInstallArtifact | undefined
  let kwsArtifact: SparkInstallArtifact | undefined
  let activeComponent: VoicePackComponent = 'model'

  try {
    report({
      component: 'model',
      state: 'preparing',
      downloaded: 0,
      total: 0,
      percent: null,
      message: '正在获取语音包下载信息',
    })
    const manifest = await fetchSparkInstallManifest()
    nativeArtifact = selectVoiceNativeArtifact(manifest.artifacts)
    modelArtifact = selectVoiceModelArtifact(manifest.artifacts)
    refineArtifact = selectVoiceRefineArtifact(manifest.artifacts)
    kwsArtifact = selectVoiceKwsArtifact(manifest.artifacts)

    if (!nativeArtifact || !modelArtifact) {
      const missing = [!nativeArtifact && '运行时', !modelArtifact && '模型']
        .filter(Boolean)
        .join('与')
      const message = `云端暂未提供语音${missing}安装包 (${platformKey})`
      report({
        component: nativeArtifact ? 'model' : 'native',
        state: 'error',
        downloaded: 0,
        total: 0,
        percent: null,
        message,
      })
      return { success: false, message, status: await checkVoiceIntegrity(false) }
    }

    const installedState = readVoiceState()
    const modelIsCurrent = isVoiceModelVersionInstalled(modelArtifact.version)
    const nativeIsCurrent = isVoiceNativeVersionInstalled(nativeArtifact.version, platformKey)
    const refineIsCurrent =
      refineArtifact != null && isVoiceRefineVersionInstalled(refineArtifact.version)
    const kwsIsCurrent = kwsArtifact != null && isVoiceKwsVersionInstalled(kwsArtifact.version)
    const installModel = force || !modelIsCurrent
    const installNative = force || !nativeIsCurrent
    const installRefine = refineArtifact != null && (force || !refineIsCurrent)
    const installKws = kwsArtifact != null && (force || !kwsIsCurrent)

    // 非强制且核心组件已就绪、可选组件也无需补装：直接返回。
    // 精修/唤醒词模型是可选增强，云端未提供时不算缺失。
    if (!force) {
      const current = await checkVoiceIntegrity(false)
      if (current.ready && !installRefine && !installKws) {
        return { success: true, message: '语音包已就绪', status: current }
      }
    }

    const nextState: VoiceState = { ...installedState }

    // 模型体积最大，先完成并原子激活；已安装同版本时不重复下载。
    if (installModel) {
      activeComponent = 'model'
      await installComponent({
        component: 'model',
        artifact: modelArtifact,
        destFinal: join(getVoiceModelDir(), modelArtifact.version),
        stagingRoot,
        manifest,
        report,
      })
    }
    nextState.model = { version: modelArtifact.version, artifactId: modelArtifact.id }
    // 每完成一个组件就持久化，后续组件失败时重试不会重复下载大模型。
    await writeVoiceState(nextState)

    if (installNative) {
      activeComponent = 'native'
      await installComponent({
        component: 'native',
        artifact: nativeArtifact,
        destFinal: join(getVoiceNativeDir(), `${nativeArtifact.version}-${platformKey}`),
        stagingRoot,
        manifest,
        report,
      })
    }
    nextState.native = {
      version: nativeArtifact.version,
      platformKey,
      artifactId: nativeArtifact.id,
    }
    await writeVoiceState(nextState)

    if (refineArtifact && installRefine) {
      activeComponent = 'refine'
      await installComponent({
        component: 'refine',
        artifact: refineArtifact,
        destFinal: join(getVoiceRefineDir(), refineArtifact.version),
        stagingRoot,
        manifest,
        report,
      })
      nextState.refine = { version: refineArtifact.version, artifactId: refineArtifact.id }
      await writeVoiceState(nextState)
    }

    if (kwsArtifact && installKws) {
      activeComponent = 'kws'
      await installComponent({
        component: 'kws',
        artifact: kwsArtifact,
        destFinal: join(getVoiceKwsDir(), kwsArtifact.version),
        stagingRoot,
        manifest,
        report,
      })
      nextState.kws = { version: kwsArtifact.version, artifactId: kwsArtifact.id }
      await writeVoiceState(nextState)
    }

    const optionalOnly = !installModel && !installNative && (installRefine || installKws)
    const message = optionalOnly ? '语音可选组件安装成功' : '语音包安装成功'
    report({
      component: activeComponent,
      state: 'done',
      downloaded: 0,
      total: 0,
      percent: 100,
      message,
    })
    log.info(
      `Voice pack installed: native ${nativeArtifact.version}, model ${modelArtifact.version}` +
        (refineArtifact && installRefine ? `, refine ${refineArtifact.version}` : '') +
        (kwsArtifact && installKws ? `, kws ${kwsArtifact.version}` : ''),
    )
    return { success: true, message, status: await checkVoiceIntegrity(false) }
  } catch (err) {
    const rawError = err instanceof Error ? err.message : String(err)
    const detail = /(?:timeout|timed out|aborted)/i.test(rawError)
      ? '下载超时，请检查网络或代理后重试'
      : rawError
    const message = `语音包安装失败：${detail}`
    log.error(message)
    report({
      component: activeComponent,
      state: 'error',
      downloaded: 0,
      total: 0,
      percent: null,
      message: detail,
    })
    return { success: false, message, status: await checkVoiceIntegrity(false) }
  } finally {
    installInFlight = false
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

function isSafeVersion(version: string): boolean {
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
