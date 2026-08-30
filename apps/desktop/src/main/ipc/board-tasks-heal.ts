/**
 * 任务面板历史附件自愈逻辑（纯函数，无 electron / db 依赖）。
 *
 * 背景：早期版本的 board-tasks.json 里，部分任务的 attachment.path 指向
 * macOS 系统临时目录（`$TMPDIR/spark-agent-pasted-images/*.png`），这些文件
 * 已被 macOS 周期性清理。打开任务面板时渲染端把这些坏 path 编码成
 * `safe-file://` 给 `<img>`，触发 SafeFileProtocol 返回 404，控制台刷红字。
 *
 * 本模块在读取任务列表时自愈：剔除「全部路径均已失效、且都落在系统临时目录」
 * 的附件条目，并把清理结果原子写回 board-tasks.json。任一路径仍存在的附件
 * 一律保留；非临时目录的失效路径保守保留，交由渲染端 onError 降级。
 *
 * 拆分为独立模块而非内联在 index.ts，是为了：
 * 1. index.ts 体量已大（>8000 行），遵循单文件拆分习惯；
 * 2. 纯函数 + 依赖注入（exists / tempRoots）可在 vitest 直接单测，
 *    无需 mock electron / better-sqlite3 等顶层副作用导入。
 */

import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** 附件条目中与自愈相关的字段（结构兼容 protocol BoardTaskAttachment）。 */
export interface BoardTaskAttachmentLike {
  path?: string
  previewPath?: string
}

/** 任务记录中与自愈相关的字段（结构兼容 index.ts 的 BoardTaskRecord）。 */
export interface BoardTaskHealRecord {
  attachmentsJson: string
}

export interface BoardTaskHealOptions {
  /** 判断文件是否存在，默认 existsSync；注入便于单测。 */
  exists?: (targetPath: string) => boolean
  /** 视为「系统临时目录」的根前缀列表；注入便于单测，默认取 getDefaultSystemTempRoots()。 */
  tempRoots?: string[]
}

/**
 * macOS / Linux 系统 temp 的常见根前缀。
 * 与「当前用户的 $TMPDIR」无关、跨重启稳定，确保即便用户当前 TMPDIR 与
 * 历史数据里记录的 TMPDIR 不同，仍能识别为系统临时目录。
 */
const SYSTEM_TEMP_PREFIXES = Object.freeze([
  '/var/folders', // macOS 每用户 temp/conf 根（$TMPDIR 的父级）
  '/private/var/folders', // macOS 经过 /private→/ 解析后的真实路径
  '/tmp',
  '/private/tmp',
  '/var/tmp',
])

/** 默认的系统临时目录根前缀集合：os.tmpdir() + 上述硬编码前缀。 */
export function getDefaultSystemTempRoots(): string[] {
  const roots = new Set<string>()
  try {
    roots.add(path.resolve(tmpdir()))
  } catch {
    /* tmpdir 解析失败时忽略，仍保留硬编码前缀 */
  }
  for (const prefix of SYSTEM_TEMP_PREFIXES) roots.add(prefix)
  return Array.from(roots).filter((value) => value.length > 0)
}

function isWithinDirectory(targetPath: string, directory: string): boolean {
  const relative = path.relative(directory, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** 判断路径是否落在任一系统临时目录根下。 */
export function isStaleTempPath(targetPath: string, tempRoots: string[]): boolean {
  const resolved = path.resolve(targetPath)
  return tempRoots.some((root) => isWithinDirectory(resolved, path.resolve(root)))
}

/** 安全 parse JSON 字段，失败返回 fallback（与 index.ts 语义一致，独立定义避免循环依赖）。 */
function safeParseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * 自愈单个任务的 attachmentsJson。
 *
 * 规则（保守优先，宁可保留交前端降级，也不误删）：
 * - path/previewPath 均为空 → 保留（无路径可判，保持原状）；
 * - 任一路径仍存在 → 保留（有效附件）；
 * - 全部路径失效且均落在系统临时目录 → 剔除（macOS 已清理的死链接，无恢复价值）；
 * - 全部路径失效但存在非临时目录的路径 → 保留（可能是用户自定义目录或外部路径，
 *   交由渲染端 onError 降级，避免误删用户期望可见的附件）。
 *
 * @returns `{ record, changed }`：changed=true 时 record 为携带新 attachmentsJson 的副本，
 *          否则为原引用（便于上层按 changed 决定是否写盘，做到幂等）。
 */
export function healBoardTaskAttachments<T extends BoardTaskHealRecord>(
  record: T,
  options: BoardTaskHealOptions = {},
): { record: T; changed: boolean } {
  const exists = options.exists ?? existsSync
  const tempRoots = options.tempRoots ?? getDefaultSystemTempRoots()
  const attachments = safeParseJson<BoardTaskAttachmentLike[]>(record.attachmentsJson, [])
  if (attachments.length === 0) return { record, changed: false }

  const healed = attachments.filter((attachment) => {
    const paths = [attachment.path, attachment.previewPath].filter((value): value is string =>
      Boolean(value && value.trim().length > 0),
    )
    if (paths.length === 0) return true
    if (paths.some((candidate) => exists(candidate))) return true
    if (paths.every((candidate) => isStaleTempPath(candidate, tempRoots))) return false
    return true
  })

  if (healed.length === attachments.length) return { record, changed: false }
  return { record: { ...record, attachmentsJson: JSON.stringify(healed) }, changed: true }
}

/**
 * 批量自愈任务列表，返回（可能的）新列表与是否有变更。
 * 未变更的元素保持原引用，便于上层浅比较。
 */
export function healBoardTasks<T extends BoardTaskHealRecord>(
  tasks: T[],
  options: BoardTaskHealOptions = {},
): { tasks: T[]; changed: boolean } {
  let changed = false
  const healed = tasks.map((task) => {
    const result = healBoardTaskAttachments(task, options)
    if (result.changed) changed = true
    return result.record
  })
  return { tasks: healed, changed }
}
