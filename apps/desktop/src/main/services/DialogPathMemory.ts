/**
 * DialogPathMemory — 文件选择/保存对话框的「上次目录」全局记忆
 *
 * 为什么需要这个
 * ────────────
 * Electron 的 showOpenDialog/showSaveDialog 默认从系统记忆或主目录打开，用户在
 * 快速创建里选了图片后，再在别的入口（导入 Provider、导出 Agent、保存图片…）
 * 打开对话框又会回到默认位置，每次都要重新逐级进入目标文件夹。
 * 这里把「上次成功选择的目录」持久化到 userData 下的 JSON，供所有对话框共享：
 * 打开对话框时注入为 defaultPath，成功选择后回写。
 *
 * 优先级规则
 * ─────────
 * - 调用方显式传了 defaultPath（如下载目录、带文件名的导出路径）→ 尊重调用方，
 *   只在成功选择后更新记忆；
 * - 未传 defaultPath（或只传了纯文件名）→ 注入记忆目录作为起始位置。
 *
 * 存储
 * ───
 * - `<userData>/dialog-path-memory.json`，模块级缓存，写失败仅记日志不阻断对话框。
 * - open 与 save 各自记忆（lastOpenDir / lastSaveDir），互不干扰。
 */

import {
  app,
  dialog,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron'
import { createLogger } from '@spark/shared'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

const log = createLogger('dialog-path-memory')

interface DialogPathMemoryState {
  lastOpenDir?: string
  lastSaveDir?: string
}

let cachedState: DialogPathMemoryState | null = null

function stateFilePath(): string {
  return join(app.getPath('userData'), 'dialog-path-memory.json')
}

function loadState(): DialogPathMemoryState {
  if (cachedState != null) return cachedState
  cachedState = {}
  try {
    const raw = readFileSync(stateFilePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.lastOpenDir === 'string' && record.lastOpenDir.length > 0) {
        cachedState.lastOpenDir = record.lastOpenDir
      }
      if (typeof record.lastSaveDir === 'string' && record.lastSaveDir.length > 0) {
        cachedState.lastSaveDir = record.lastSaveDir
      }
    }
  } catch {
    // 首次运行或文件损坏时从空状态开始，不影响对话框功能。
  }
  return cachedState
}

function persistState(state: DialogPathMemoryState): void {
  cachedState = state
  try {
    writeFileSync(stateFilePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch (err) {
    log.warn(`failed to persist dialog path memory: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 记忆目录不存在（被移动/删除）时忽略，避免对话框落在失效路径。 */
function usableDirectory(dir: string | undefined): string | undefined {
  if (dir == null || dir.length === 0) return undefined
  try {
    return existsSync(dir) && isAbsolute(dir) ? dir : undefined
  } catch {
    return undefined
  }
}

function rememberOpenDir(filePaths: readonly string[]): void {
  const first = filePaths[0]
  if (first == null || first.length === 0) return
  const dir = dirname(first)
  if (!existsSync(dir)) return
  const state = loadState()
  if (state.lastOpenDir === dir) return
  log.info(`remember open dir=${dir}`)
  persistState({ ...state, lastOpenDir: dir })
}

function rememberSaveDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) return
  const state = loadState()
  if (state.lastSaveDir === dir) return
  log.info(`remember save dir=${dir}`)
  persistState({ ...state, lastSaveDir: dir })
}

/**
 * `dialog.showOpenDialog` 的全局记忆版本：
 * 未显式指定 defaultPath 时从上次打开目录开始，成功选择后回写记忆。
 */
export async function showTrackedOpenDialog(
  options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  const effectiveOptions: OpenDialogOptions = { ...options }
  if (effectiveOptions.defaultPath == null) {
    const remembered = usableDirectory(loadState().lastOpenDir)
    if (remembered != null) effectiveOptions.defaultPath = remembered
  }
  const result = await dialog.showOpenDialog(effectiveOptions)
  if (!result.canceled && result.filePaths.length > 0) rememberOpenDir(result.filePaths)
  return result
}

/**
 * `dialog.showSaveDialog` 的全局记忆版本：
 * defaultPath 缺省或只有文件名时拼上上次保存目录；成功保存后回写记忆。
 */
export async function showTrackedSaveDialog(
  options: SaveDialogOptions,
): Promise<SaveDialogReturnValue> {
  const effectiveOptions: SaveDialogOptions = { ...options }
  const rememberedSaveDir = usableDirectory(loadState().lastSaveDir)
  if (rememberedSaveDir != null) {
    if (effectiveOptions.defaultPath == null) {
      effectiveOptions.defaultPath = rememberedSaveDir
    } else if (!isAbsolute(effectiveOptions.defaultPath)) {
      // 只有文件名的 defaultPath（如 spark-agent-export-2026-09-18.json）落到记忆目录
      effectiveOptions.defaultPath = join(rememberedSaveDir, effectiveOptions.defaultPath)
    }
  }
  const result = await dialog.showSaveDialog(effectiveOptions)
  if (!result.canceled && result.filePath) rememberSaveDir(result.filePath)
  return result
}
