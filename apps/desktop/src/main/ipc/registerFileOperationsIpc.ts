/**
 * 文件操作 IPC（代码查看器文件树资源管理器）
 *
 * 提供：trash（移到系统回收站）/ create-file / create-directory / move / copy。
 * 所有 path 均为相对 workspace root 的 posix 路径，与 WorkspaceTreeEntry.path 同语义。
 *
 * 安全校验三层：
 *   1. resolveInsideRoot —— 词法校验相对路径落在 root 内（防 `../` 越界、防操作 root 本身）
 *   2. isSafeFilePathAllowed —— canonical 校验落在全局白名单根内（防 symlink 逃逸）
 *   3. move/copy 额外校验 toPath 不是 fromPath 子孙（防自嵌套死循环 / 无限递归复制）
 *
 * 错误以 response.error 返回（与 registerFilePreviewIpc 同模式），便于前端直接 toast。
 */

import { shell } from 'electron'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@spark/shared'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { isPathNestedIn, resolveInsideRoot } from './pathGuard.js'
import { resolveSessionScopedWorkspaceRoot } from './sessionWorkspaceRoot.js'
import { typedIpcHandle } from './typed-ipc.js'

const log = createLogger('file-operations-ipc')

/** 新建文件内容上限（与 schema 一致） */
const MAX_CREATE_FILE_BYTES = 10_000_000

type ConflictPolicy = 'error' | 'overwrite' | 'merge' | 'rename'

interface OpResult {
  ok: boolean
  error?: string
  /** rename 策略下后端实际使用的目标相对路径（posix），前端据此提示「已复制为 xxx_copy」 */
  finalPath?: string
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// resolveInsideRoot / isPathNestedIn 已抽到 ./pathGuard.ts（纯函数，便于单测覆盖安全逻辑）

/** 二次安全校验：canonical 路径必须落在全局白名单根内（防 symlink 逃逸到敏感目录）。 */
function assertSafeAbsPath(absPath: string): void {
  if (!isSafeFilePathAllowed(absPath)) {
    throw new Error('目标路径不在允许操作的目录中')
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/**
 * 解析 from/to 双路径并完成安全校验，返回 [fromAbs, toAbs]。
 * 额外拒绝 toPath 落在 fromPath 内（move 会自嵌套，copy 会无限递归）。
 */
function resolvePair(rootPath: string, fromPath: string, toPath: string): [string, string] {
  const fromAbs = resolveInsideRoot(rootPath, fromPath)
  const toAbs = resolveInsideRoot(rootPath, toPath)
  assertSafeAbsPath(fromAbs)
  assertSafeAbsPath(toAbs)
  // toAbs 落在 fromAbs 之内（含自身）→ 禁止（move 会自嵌套，copy 会无限递归）
  if (isPathNestedIn(fromAbs, toAbs)) {
    throw new Error('目标路径不能是源路径自身或其子目录')
  }
  return [fromAbs, toAbs]
}

/**
 * 处理目标已存在的冲突。
 * - error：存在即抛错
 * - overwrite：删除目标后继续
 * - merge：目录对目录交由调用方逐项合并；文件视为 overwrite
 */
async function resolveConflict(
  toAbs: string,
  ifExists: ConflictPolicy,
  isDirectory: boolean,
): Promise<void> {
  if (!(await pathExists(toAbs))) return
  if (ifExists === 'error') {
    throw new Error('目标已存在')
  }
  if (ifExists === 'overwrite') {
    await fs.rm(toAbs, { recursive: true, force: true })
    return
  }
  // merge：目录交由调用方合并；文件直接覆盖
  if (!isDirectory) {
    await fs.rm(toAbs, { force: true })
  }
}

/** merge 模式下把 fromDir 内容逐项移入 toDir（toDir 已存在）。 */
async function mergeMove(fromDir: string, toDir: string): Promise<void> {
  const children = await fs.readdir(fromDir)
  for (const name of children) {
    const fromChild = path.join(fromDir, name)
    const toChild = path.join(toDir, name)
    try {
      await fs.rename(fromChild, toChild)
    } catch (err) {
      // 跨设备（EXDEV）：回退为复制 + 删除
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      await fs.cp(fromChild, toChild, { recursive: true, force: true })
      await fs.rm(fromChild, { recursive: true, force: true })
    }
  }
  await fs.rm(fromDir, { recursive: true, force: true })
}

export async function trashPath(rootPath: string, relPath: string): Promise<OpResult> {
  try {
    const abs = resolveInsideRoot(rootPath, relPath)
    assertSafeAbsPath(abs)
    if (!(await pathExists(abs))) {
      return { ok: false, error: '文件或目录不存在' }
    }
    await shell.trashItem(abs)
    return { ok: true }
  } catch (err) {
    log.warn(`file:trash failed, path=${relPath}, error=${errMsg(err)}`)
    return { ok: false, error: errMsg(err) }
  }
}

export async function createFile(
  rootPath: string,
  relPath: string,
  content: string | undefined,
): Promise<OpResult> {
  try {
    const abs = resolveInsideRoot(rootPath, relPath)
    assertSafeAbsPath(abs)
    if (await pathExists(abs)) {
      return { ok: false, error: '文件已存在' }
    }
    const text = content ?? ''
    if (Buffer.byteLength(text, 'utf8') > MAX_CREATE_FILE_BYTES) {
      return { ok: false, error: '文件内容过大' }
    }
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, text, 'utf8')
    return { ok: true }
  } catch (err) {
    log.warn(`file:create-file failed, path=${relPath}, error=${errMsg(err)}`)
    return { ok: false, error: errMsg(err) }
  }
}

export async function createDirectory(rootPath: string, relPath: string): Promise<OpResult> {
  try {
    const abs = resolveInsideRoot(rootPath, relPath)
    assertSafeAbsPath(abs)
    if (await pathExists(abs)) {
      return { ok: false, error: '目录已存在' }
    }
    await fs.mkdir(abs, { recursive: true })
    return { ok: true }
  } catch (err) {
    log.warn(`file:create-directory failed, path=${relPath}, error=${errMsg(err)}`)
    return { ok: false, error: errMsg(err) }
  }
}

export async function movePath(
  rootPath: string,
  fromPath: string,
  toPath: string,
  ifExists: ConflictPolicy,
): Promise<OpResult> {
  try {
    const [fromAbs, toAbs] = resolvePair(rootPath, fromPath, toPath)
    if (!(await pathExists(fromAbs))) {
      return { ok: false, error: '源文件或目录不存在' }
    }
    const fromStat = await fs.stat(fromAbs)
    await resolveConflict(toAbs, ifExists, fromStat.isDirectory())
    // merge 目录：把 from 子项逐个移入已存在的 to
    if (ifExists === 'merge' && fromStat.isDirectory() && (await pathExists(toAbs))) {
      await mergeMove(fromAbs, toAbs)
      return { ok: true }
    }
    try {
      await fs.rename(fromAbs, toAbs)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      // 跨设备：回退为递归复制 + 删除源
      await fs.cp(fromAbs, toAbs, { recursive: true, force: true })
      await fs.rm(fromAbs, { recursive: true, force: true })
    }
    return { ok: true }
  } catch (err) {
    log.warn(`file:move failed, from=${fromPath}, to=${toPath}, error=${errMsg(err)}`)
    return { ok: false, error: errMsg(err) }
  }
}

/**
 * rename 策略：为 toAbs 找一个不冲突、且不等于 fromAbs / 不落在 fromAbs 内的目标绝对路径。
 * 命名：base_copy.ext → base_copy1.ext → base_copy2.ext …（无扩展名则 base_copy / base_copy1）。
 */
async function findNonConflictCopyName(toAbs: string, fromAbs: string): Promise<string> {
  const dir = path.dirname(toAbs)
  const ext = path.extname(toAbs)
  const base = path.basename(toAbs, ext)
  for (let i = 0; i < 10000; i++) {
    const suffix = i === 0 ? '_copy' : `_copy${i}`
    const candidate = path.join(dir, `${base}${suffix}${ext}`)
    if (
      candidate !== fromAbs &&
      !isPathNestedIn(fromAbs, candidate) &&
      !(await pathExists(candidate))
    ) {
      return candidate
    }
  }
  throw new Error('无法找到可用的目标文件名')
}

/** 绝对路径 → 相对 workspace root 的 posix 路径（用于 finalPath 返回前端提示） */
function toRelPosix(absPath: string, rootPath: string): string {
  return path.relative(rootPath, absPath).split(path.sep).join('/')
}

export async function copyPath(
  rootPath: string,
  fromPath: string,
  toPath: string,
  ifExists: ConflictPolicy,
): Promise<OpResult> {
  try {
    const fromAbs = resolveInsideRoot(rootPath, fromPath)
    assertSafeAbsPath(fromAbs)
    if (!(await pathExists(fromAbs))) {
      return { ok: false, error: '源文件或目录不存在' }
    }
    const fromStat = await fs.stat(fromAbs)
    const requestedToAbs = resolveInsideRoot(rootPath, toPath)
    assertSafeAbsPath(requestedToAbs)

    let toAbs = requestedToAbs
    let finalPath: string | undefined
    if (ifExists === 'rename') {
      // 目标已存在 或 与源相同 → 自动改名 base_copy(.ext) / base_copy1 / base_copy2 …
      if ((await pathExists(requestedToAbs)) || requestedToAbs === fromAbs) {
        toAbs = await findNonConflictCopyName(requestedToAbs, fromAbs)
        finalPath = toRelPosix(toAbs, rootPath)
      }
    } else {
      // error/overwrite/merge：禁止移到自身或子孙目录（move 会自嵌套，copy 会无限递归）
      if (isPathNestedIn(fromAbs, requestedToAbs)) {
        throw new Error('目标路径不能是源路径自身或其子目录')
      }
      await resolveConflict(requestedToAbs, ifExists, fromStat.isDirectory())
    }

    if (fromStat.isDirectory()) {
      // 目录复制：recursive；merge 模式靠 force 合并覆盖同名，error 模式靠 errorOnExist 兜底
      await fs.cp(fromAbs, toAbs, {
        recursive: true,
        force: ifExists !== 'error',
        errorOnExist: ifExists === 'error',
      })
    } else {
      await fs.copyFile(fromAbs, toAbs)
    }
    const result: OpResult = { ok: true }
    if (finalPath != null) result.finalPath = finalPath
    return result
  } catch (err) {
    log.warn(`file:copy failed, from=${fromPath}, to=${toPath}, error=${errMsg(err)}`)
    return { ok: false, error: errMsg(err) }
  }
}

export function registerFileOperationsIpc(): void {
  typedIpcHandle('file:trash', async (req) => {
    const rootPath = await resolveSessionScopedWorkspaceRoot(req.workspaceId, req.sessionId)
    return trashPath(rootPath, req.path)
  })

  typedIpcHandle('file:create-file', async (req) => {
    const rootPath = await resolveSessionScopedWorkspaceRoot(req.workspaceId, req.sessionId)
    return createFile(rootPath, req.path, req.content)
  })

  typedIpcHandle('file:create-directory', async (req) => {
    const rootPath = await resolveSessionScopedWorkspaceRoot(req.workspaceId, req.sessionId)
    return createDirectory(rootPath, req.path)
  })

  typedIpcHandle('file:move', async (req) => {
    const rootPath = await resolveSessionScopedWorkspaceRoot(req.workspaceId, req.sessionId)
    return movePath(rootPath, req.fromPath, req.toPath, req.ifExists ?? 'error')
  })

  typedIpcHandle('file:copy', async (req) => {
    const rootPath = await resolveSessionScopedWorkspaceRoot(req.workspaceId, req.sessionId)
    return copyPath(rootPath, req.fromPath, req.toPath, req.ifExists ?? 'error')
  })
}
