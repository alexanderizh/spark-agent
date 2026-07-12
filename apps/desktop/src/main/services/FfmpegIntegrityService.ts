/**
 * FfmpegIntegrityService — FFmpeg 二进制完整性检测与安装
 *
 * 职责：
 *   1. 检测 ffmpeg/ffprobe 是否可用（managed 目录优先 → 系统 PATH 回退）
 *   2. 提供 ffmpeg 二进制下载能力（从自建 minio 仓库下载到 `{userData}/bin/`）
 *   3. 暴露二进制路径供 FfmpegRunner 使用
 *
 * 模式：参考 `PlaywrightIntegrityService.ts`（状态缓存 + 检测 + 安装 + 二次校验）
 * 检测范式参考 `ExternalToolService.ts` / `ShellEnvironmentService.ts`（which/where + 版本解析）
 *
 * 存储约定：
 *   dev & prod 统一: {userData}/bin/<artifact-name>/ffmpeg(.exe) + ffprobe(.exe)
 *   （由 SkillRegistryService.installBinaryArtifact 落盘到 {userData}/bin/）
 */

import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { createLogger } from '@spark/shared'

const log = createLogger('ffmpeg-integrity')
const execFileAsync = promisify(execFile)

const isWin = process.platform === 'win32'
const FFMPEG_EXE = isWin ? 'ffmpeg.exe' : 'ffmpeg'
const FFPROBE_EXE = isWin ? 'ffprobe.exe' : 'ffprobe'

/** 当前平台的 artifact id 后缀，如 "darwin-arm64" */
const PLATFORM_ARCH = `${process.platform}-${process.arch}`

export interface FfmpegIntegrityState {
  ffmpegReady: boolean
  /** 'managed' = 我们从 minio 下载的；'system' = 用户系统 PATH 里的；'none' = 不可用 */
  ffmpegSource: 'managed' | 'system' | 'none'
  ffmpegVersion: string | null
  ffprobeReady: boolean
  /** ffmpeg 可执行文件绝对路径（供 FfmpegRunner 使用） */
  binaryPath: string | null
  /** ffprobe 可执行文件绝对路径 */
  ffprobePath: string | null
  lastError: string | null
}

let cachedState: FfmpegIntegrityState | null = null
/** in-flight 检测去重：并发调用 detectFfmpegIntegrity 只跑一次实际检测 */
let detectInFlight: Promise<FfmpegIntegrityState> | null = null

// ─── Path Resolution ────────────────────────────────────────────────────────

/** `{userData}/bin` —— SkillRegistryService 的 binaryDir */
function getBinaryRootDir(): string {
  return join(app.getPath('userData'), 'bin')
}

/**
 * 扫描 `{userData}/bin/` 下所有子目录，找到含 ffmpeg 可执行文件的目录。
 * 目录名由 installBinaryArtifact 按 artifact.name 生成（如 "FFmpeg-7.1.1-macOS-Apple-Silicon"），
 * 这里不依赖具体名字，靠扫描内容定位，保证升级 / 换包后仍能找到。
 */
function resolveManagedBinaryDir(): string | null {
  const root = getBinaryRootDir()
  if (!existsSync(root)) return null
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }
  for (const name of entries) {
    // 目录名含 ffmpeg 字样优先（排除不相干的 bin 产物）
    if (!/ffmpeg/i.test(name)) continue
    const ffmpegPath = join(root, name, FFMPEG_EXE)
    if (existsSync(ffmpegPath)) {
      return join(root, name)
    }
  }
  // 兜底：扫描所有子目录
  for (const name of entries) {
    const ffmpegPath = join(root, name, FFMPEG_EXE)
    if (existsSync(ffmpegPath)) {
      return join(root, name)
    }
  }
  return null
}

// ─── Version Detection ──────────────────────────────────────────────────────

/** 从 `ffmpeg -version` 首行解析版本号，格式：`ffmpeg version 7.0.2 ...` */
const FFMPEG_VERSION_REGEX = /^ffmpeg version (\S+)/

/**
 * 执行 `<bin> -version` 拿版本号。ffmpeg/ffprobe 都支持 -version。
 * 超时 5s，失败返回 null。
 */
async function readBinaryVersion(binPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binPath, ['-version'], { timeout: 5000 })
    const m = stdout.match(FFMPEG_VERSION_REGEX)
    return m?.[1] ?? null
  } catch (err) {
    log.warn(`readBinaryVersion failed for ${binPath}: ${String(err)}`)
    return null
  }
}

/**
 * 检测系统 PATH 里的 ffmpeg（用户自己装的）。
 * 用 which/where 定位后跑 -version 拿版本。
 */
async function detectSystemFfmpeg(): Promise<{
  path: string
  version: string | null
} | null> {
  try {
    const whichCmd = isWin ? 'where' : 'which'
    const { stdout } = await execFileAsync(whichCmd, ['ffmpeg'], { timeout: 3000 })
    const path = stdout.trim().split(/[\r\n]/)[0]
    if (!path) return null
    const version = await readBinaryVersion(path)
    // version 为 null 说明 ffmpeg 虽存在但无法正常执行（如 dyld 库缺失崩溃），
    // 视为不可用——否则会误判 ffmpegReady=true 但实际所有操作都失败。
    if (!version) return null
    return { path, version }
  } catch {
    return null
  }
}

/** 探测系统 PATH 里的 ffprobe 路径（不要求版本，只确认存在）。 */
async function detectSystemFfprobe(): Promise<string | null> {
  try {
    const whichCmd = isWin ? 'where' : 'which'
    const { stdout } = await execFileAsync(whichCmd, ['ffprobe'], { timeout: 3000 })
    const path = stdout.trim().split(/[\r\n]/)[0]
    return path || null
  } catch {
    return null
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * 返回当前 ffmpeg/ffprobe 可执行文件路径，供 FfmpegRunner 使用。
 * 不刷新缓存（用 detectFfmpegIntegrity 刷新）。
 * 找不到时抛错——调用方应在调用前确保 ffmpegReady。
 */
export async function resolveFfmpegBin(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const state = cachedState ?? (await detectFfmpegIntegrity())
  if (!state.ffmpegReady || !state.binaryPath) {
    throw new Error(
      'FFmpeg 不可用。请在「设置 → 完整性」中下载 FFmpeg，或确认系统已安装 ffmpeg 并在 PATH 中。',
    )
  }
  // ffprobe 可能在系统 PATH 但不在 managed 目录；尽力解析
  let ffprobe = state.ffprobePath
  if (!ffprobe) {
    const managedDir = resolveManagedBinaryDir()
    if (managedDir) {
      const candidate = join(managedDir, FFPROBE_EXE)
      if (existsSync(candidate)) ffprobe = candidate
    }
  }
  if (!ffprobe) ffprobe = await detectSystemFfprobe()
  if (!ffprobe) {
    throw new Error('ffprobe 不可用。关键帧时间戳解析等能力需要 ffprobe，请重新下载 FFmpeg 包。')
  }
  return { ffmpeg: state.binaryPath, ffprobe }
}

/** 同步返回缓存状态（未检测时返回 null）。 */
export function getCachedFfmpegIntegrity(): FfmpegIntegrityState | null {
  return cachedState
}

/**
 * 检测当前 ffmpeg 完整性状态，刷新缓存并返回。
 *
 * 优先级：managed 目录 > 系统 PATH > none。
 * 并发安全：多次调用共享同一个 in-flight promise，避免检测风暴。
 */
export function detectFfmpegIntegrity(): Promise<FfmpegIntegrityState> {
  if (detectInFlight) return detectInFlight
  detectInFlight = doDetectFfmpegIntegrity().finally(() => {
    detectInFlight = null
  })
  return detectInFlight
}

async function doDetectFfmpegIntegrity(): Promise<FfmpegIntegrityState> {
  // 1. managed 目录（我们从 minio 下载的）
  const managedDir = resolveManagedBinaryDir()
  if (managedDir) {
    const ffmpegPath = join(managedDir, FFMPEG_EXE)
    const ffprobePath = join(managedDir, FFPROBE_EXE)
    if (existsSync(ffmpegPath)) {
      const version = await readBinaryVersion(ffmpegPath)
      if (version) {
        const state: FfmpegIntegrityState = {
          ffmpegReady: true,
          ffmpegSource: 'managed',
          ffmpegVersion: version,
          ffprobeReady: existsSync(ffprobePath),
          binaryPath: ffmpegPath,
          ffprobePath: existsSync(ffprobePath) ? ffprobePath : null,
          lastError: cachedState?.lastError ?? null,
        }
        cachedState = state
        return state
      }
    }
  }

  // 2. 系统 PATH
  const systemFfmpeg = await detectSystemFfmpeg()
  if (systemFfmpeg?.version) {
    // version 非空说明 ffmpeg 能正常执行 -version（而非 dyld 崩溃等）
    const systemFfprobe = await detectSystemFfprobe()
    const state: FfmpegIntegrityState = {
      ffmpegReady: true,
      ffmpegSource: 'system',
      ffmpegVersion: systemFfmpeg.version,
      ffprobeReady: systemFfprobe !== null,
      binaryPath: systemFfmpeg.path,
      ffprobePath: systemFfprobe,
      lastError: cachedState?.lastError ?? null,
    }
    cachedState = state
    return state
  }

  // 3. 不可用
  const state: FfmpegIntegrityState = {
    ffmpegReady: false,
    ffmpegSource: 'none',
    ffmpegVersion: null,
    ffprobeReady: false,
    binaryPath: null,
    ffprobePath: null,
    lastError: cachedState?.lastError ?? null,
  }
  cachedState = state
  return state
}

/**
 * 从 minio 仓库下载并安装 ffmpeg 二进制。
 *
 * 走 SkillRegistryService.installBinaryArtifact（复用下载/SHA256/解压链路），
 * 落盘到 `{userData}/bin/<artifact-name>/`。下载后做 chmod（mac/linux）+ 二次校验。
 *
 * @param artifactId 可选；缺省按当前平台选 `binary.ffmpeg-<plat>-<arch>`
 *                   （manifest 里需有对应条目；版本号取最新可用）
 * @param onProgress 下载进度回调（已下载字节 / 总字节）
 * @param installFn  注入的安装函数（由 IPC 层提供，避免这里硬依赖 SkillRegistryService）
 */
export async function installFfmpeg(
  installFn: (artifactId: string, onProgress: (d: number, t: number) => void) => Promise<{ destPath: string; entries: string[] }>,
  opts: {
    artifactId?: string
    onProgress?: (downloaded: number, total: number) => void
    onLog?: (line: string) => void
  } = {},
): Promise<{ success: boolean; message?: string }> {
  const onLog = opts.onLog ?? (() => {})
  // artifactId 缺省时，需要调用方（IPC 层）从 manifest 选当前平台的最新条目。
  // 这里要求显式传入，避免本服务耦合 manifest 拉取逻辑。
  const artifactId = opts.artifactId
  if (!artifactId) {
    const message = `未指定 FFmpeg artifactId，且 manifest 中无当前平台 (${PLATFORM_ARCH}) 的默认条目`
    log.error(message)
    cachedState = { ...(await detectFfmpegIntegrity()), lastError: message }
    return { success: false, message }
  }

  onLog(`[ffmpeg] 开始下载 ${artifactId} ...`)
  let result: { destPath: string; entries: string[] }
  try {
    result = await installFn(artifactId, opts.onProgress ?? (() => {}))
  } catch (err) {
    const message = `FFmpeg 下载失败: ${err instanceof Error ? err.message : String(err)}`
    log.error(message)
    cachedState = { ...(await detectFfmpegIntegrity()), lastError: message }
    return { success: false, message }
  }

  onLog(`[ffmpeg] 解压完成，落盘到 ${result.destPath}`)

  // chmod +x（mac/linux）。Windows 无需。
  if (!isWin) {
    const { chmod } = await import('node:fs/promises')
    for (const entry of result.entries) {
      if (/^ffmpeg(\.exe)?$/i.test(entry) || /^ffprobe(\.exe)?$/i.test(entry)) {
        try {
          await chmod(join(result.destPath, entry), 0o755)
        } catch {
          // ignore chmod failure
        }
      }
    }
  }

  // 二次校验
  const nextState = await detectFfmpegIntegrity()
  if (!nextState.ffmpegReady || nextState.ffmpegSource !== 'managed') {
    const message = `FFmpeg 下载完成，但未能在 ${result.destPath} 检测到可用的 ffmpeg 二进制`
    log.error(message)
    cachedState = { ...nextState, lastError: message }
    return { success: false, message }
  }

  onLog(`[ffmpeg] 安装成功，版本 ${nextState.ffmpegVersion}`)
  cachedState = { ...nextState, lastError: null }
  return { success: true }
}

/** 重置缓存。安装失败后强制下次重新检测。 */
export function invalidateFfmpegCache(): void {
  cachedState = null
}
