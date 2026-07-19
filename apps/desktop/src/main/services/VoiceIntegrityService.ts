import { app } from 'electron'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

interface VoiceStateNative {
  version: string
  platformKey: string
  artifactId: string
}
interface VoiceStateModel {
  version: string
  artifactId: string
}
interface VoiceState {
  native?: VoiceStateNative
  model?: VoiceStateModel
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

export function resolveVoiceModelPaths(): VoiceModelPaths | null {
  const platformKey = voicePlatformKey()
  const state = readVoiceState()
  if (!platformKey || !state.native || !state.model) return null
  if (state.native.platformKey !== platformKey) return null
  const nativeDir = join(getVoiceNativeDir(), `${state.native.version}-${platformKey}`)
  const modelDir = join(getVoiceModelDir(), state.model.version)
  if (!existsSync(nativeDir) || !existsSync(modelDir)) return null
  let nativeMain = ''
  try {
    const pkg = JSON.parse(readFileSync(join(nativeDir, 'package.json'), 'utf8')) as {
      main?: string
    }
    if (pkg.main && existsSync(join(nativeDir, pkg.main))) {
      nativeMain = join(nativeDir, pkg.main)
    }
  } catch {
    // package.json 缺失或损坏，交给检测流程报告 missing。
  }
  if (!nativeMain) return null
  return { nativeDir, modelDir, nativeMain }
}

function isNativeInstalled(state: VoiceState, platformKey: VoicePlatformKey | null): boolean {
  if (!state.native || !platformKey) return false
  if (state.native.platformKey !== platformKey) return false
  return resolveVoiceModelPaths() != null
}

function isModelInstalled(state: VoiceState): boolean {
  if (!state.model) return false
  const dir = join(getVoiceModelDir(), state.model.version)
  if (!existsSync(dir)) return false
  return existsSync(join(dir, 'model-package.json'))
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

export async function checkVoiceIntegrity(
  checkLatest: boolean,
): Promise<VoiceIntegrityStatus> {
  const platformKey = voicePlatformKey()
  const state = readVoiceState()
  const nativeInstalled = isNativeInstalled(state, platformKey)
  const modelInstalled = isModelInstalled(state)

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
  ]

  const status: VoiceIntegrityStatus = {
    ready: nativeInstalled && modelInstalled,
    downloading: false,
    supported: platformKey != null,
    unsupportedReason:
      platformKey == null
        ? `当前平台不支持语音输入 (${process.platform}/${process.arch})`
        : null,
    components,
    lastError: null,
  }

  if (!checkLatest || !platformKey) return status

  try {
    const manifest = await fetchSparkInstallManifest()
    const nativeArtifact = selectVoiceNativeArtifact(manifest.artifacts)
    const modelArtifact = selectVoiceModelArtifact(manifest.artifacts)
    const nativeComp = components.find((c) => c.component === 'native')
    const modelComp = components.find((c) => c.component === 'model')
    if (nativeArtifact && nativeComp) {
      nativeComp.latestVersion = nativeArtifact.version
      nativeComp.artifactId = nativeArtifact.id
    }
    if (modelArtifact && modelComp) {
      modelComp.latestVersion = modelArtifact.version
      modelComp.artifactId = modelArtifact.id
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
  const label = component === 'native' ? '运行时' : '模型'
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
    return { success: false, message, status: await checkVoiceIntegrity(false) }
  }

  const platformKey = voicePlatformKey()
  if (!platformKey) {
    const message = `当前平台不支持语音输入 (${process.platform}/${process.arch})`
    report({ component: 'native', state: 'error', downloaded: 0, total: 0, percent: null, message })
    return { success: false, message, status: await checkVoiceIntegrity(false) }
  }

  // 非强制且已就绪：直接返回
  if (!force) {
    const current = await checkVoiceIntegrity(false)
    if (current.ready) {
      return { success: true, message: '语音包已就绪', status: current }
    }
  }

  installInFlight = true
  const root = getVoiceRootPath()
  const stagingRoot = join(root, `.staging-${process.pid}-${Date.now()}`)
  let modelArtifact: SparkInstallArtifact | undefined
  let nativeArtifact: SparkInstallArtifact | undefined

  try {
    const manifest = await fetchSparkInstallManifest()
    nativeArtifact = selectVoiceNativeArtifact(manifest.artifacts)
    modelArtifact = selectVoiceModelArtifact(manifest.artifacts)

    if (!nativeArtifact || !modelArtifact) {
      const missing = [
        !nativeArtifact && '运行时',
        !modelArtifact && '模型',
      ]
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

    // 1. 先装模型（跨平台、相对小）
    await installComponent({
      component: 'model',
      artifact: modelArtifact,
      destFinal: join(getVoiceModelDir(), modelArtifact.version),
      stagingRoot,
      manifest,
      report,
    })

    // 2. 再装 native 运行时（按平台）
    await installComponent({
      component: 'native',
      artifact: nativeArtifact,
      destFinal: join(getVoiceNativeDir(), `${nativeArtifact.version}-${platformKey}`),
      stagingRoot,
      manifest,
      report,
    })

    await writeVoiceState({
      native: {
        version: nativeArtifact.version,
        platformKey,
        artifactId: nativeArtifact.id,
      },
      model: { version: modelArtifact.version, artifactId: modelArtifact.id },
    })

    const message = '语音包安装成功'
    report({
      component: 'native',
      state: 'done',
      downloaded: 0,
      total: 0,
      percent: 100,
      message,
    })
    log.info(
      `Voice pack installed: native ${nativeArtifact.version}, model ${modelArtifact.version}`,
    )
    return { success: true, message, status: await checkVoiceIntegrity(false) }
  } catch (err) {
    const message = `语音包安装失败：${err instanceof Error ? err.message : String(err)}`
    log.error(message)
    report({
      component: nativeArtifact ? 'native' : 'model',
      state: 'error',
      downloaded: 0,
      total: 0,
      percent: null,
      message,
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
