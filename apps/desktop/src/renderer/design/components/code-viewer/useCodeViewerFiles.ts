/**
 * useCodeViewerFiles —— 「代码」tab 的文件内容读写 / 脏标 / 外部变更检测。
 *
 * 设计要点：
 *  - 文件 tabs 列表（OpenCodeFile[]）与激活路径由 ChatView 受控持有并传入；本 hook 只负责
 *    「每个 absPath 的内容运行时态」（content / savedContent / state / externalChanged），
 *    与 tabs 增删解耦。
 *  - 仅激活 tab 按需读取（file:read）；非激活且已保存的内容立即释放，脏内容保留。
 *  - 关闭 tab 会清理对应 runtime；异步读取返回前若已关闭/切走，不再把大字符串写回内存。
 *  - 编辑：editActive 更新 content；content !== savedContent 即脏。
 *  - 保存：file:write-text。保存前重读磁盘与 savedContent 对比，若磁盘已被外部（agent 等）
 *    修改，抛 CodeFileExternalChangeError 由 UI 弹「覆盖 / 重载」确认，绝不静默覆盖。
 *
 * 未接入 FileWatcherService 的实时推送（externalChanged 目前仅在保存前探测时置位）；
 * 实时监听作为后续增强，当前接口已预留 externalChanged 字段。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OpenCodeFile, CodeFileRuntime } from './types'

type RuntimeMap = Record<string, CodeFileRuntime>

/** 代码编辑器单文件读取上限；限制在主进程完整读取和 IPC 序列化之前执行。 */
export const CODE_VIEWER_MAX_FILE_BYTES = 5 * 1024 * 1024

const EMPTY_RUNTIME: CodeFileRuntime = {
  content: '',
  savedContent: '',
  state: 'idle',
}

/** 保存时探测到磁盘已被外部修改 —— 交给 UI 弹覆盖/重载确认，而非静默覆盖 */
export class CodeFileExternalChangeError extends Error {
  readonly absPath: string
  readonly diskContent: string
  constructor(absPath: string, diskContent: string) {
    super('文件已被外部修改')
    this.name = 'CodeFileExternalChangeError'
    this.absPath = absPath
    this.diskContent = diskContent
  }
}

type FileReadResp = {
  content?: string
  encoding?: string
  error?: string
  errorCode?: string
  size?: number
}
type FileWriteResp = { success: boolean }

export interface UseCodeViewerFilesResult {
  runtimes: RuntimeMap
  activeRuntime: CodeFileRuntime | undefined
  editActive: (content: string) => void
  /** 保存激活文件；磁盘已被外部修改时抛 CodeFileExternalChangeError */
  saveActive: () => Promise<void>
  /** 强制重读激活文件（外部变更后用户选「重载」时调用） */
  reloadActive: () => Promise<void>
  /** 用给定磁盘内容覆盖本地编辑后保存（用户选「覆盖」时调用） */
  forceSaveActive: () => Promise<void>
  isDirty: (absPath: string) => boolean
}

export function useCodeViewerFiles(
  files: OpenCodeFile[],
  activeAbsPath: string | null,
): UseCodeViewerFilesResult {
  const [runtimes, setRuntimes] = useState<RuntimeMap>({})
  const loadingPathsRef = useRef<Set<string>>(new Set())
  const readGenerationRef = useRef<Map<string, number>>(new Map())
  const openPathsRef = useRef<Set<string>>(new Set())
  const activeAbsPathRef = useRef<string | null>(activeAbsPath)

  // 异步回调必须看到当前 tab/active，而不能捕获发起读取时的旧 props。
  openPathsRef.current = new Set(files.map((file) => file.absPath))
  activeAbsPathRef.current = activeAbsPath

  const readFile = useCallback(async (absPath: string) => {
    if (loadingPathsRef.current.has(absPath)) return
    const generation = (readGenerationRef.current.get(absPath) ?? 0) + 1
    readGenerationRef.current.set(absPath, generation)
    loadingPathsRef.current.add(absPath)
    setRuntimes((prev) => ({
      ...prev,
      [absPath]: { ...(prev[absPath] ?? EMPTY_RUNTIME), state: 'loading', error: undefined },
    }))
    try {
      const res = (await window.spark.invoke('file:read', {
        filePath: absPath,
        maxBytes: CODE_VIEWER_MAX_FILE_BYTES,
        rejectBinary: true,
      })) as FileReadResp
      if (
        readGenerationRef.current.get(absPath) !== generation ||
        !openPathsRef.current.has(absPath) ||
        activeAbsPathRef.current !== absPath
      ) {
        return
      }
      if (res.error) {
        setRuntimes((prev) => ({
          ...prev,
          [absPath]: { ...EMPTY_RUNTIME, state: 'error', error: res.error },
        }))
      } else {
        const content = res.content ?? ''
        const encoding = res.encoding ?? 'utf-8'
        setRuntimes((prev) => ({
          ...prev,
          [absPath]: { content, savedContent: content, state: 'ready', encoding },
        }))
      }
    } catch (err) {
      if (
        readGenerationRef.current.get(absPath) !== generation ||
        !openPathsRef.current.has(absPath) ||
        activeAbsPathRef.current !== absPath
      ) {
        return
      }
      setRuntimes((prev) => ({
        ...prev,
        [absPath]: {
          ...EMPTY_RUNTIME,
          state: 'error',
          error: err instanceof Error ? err.message : String(err),
        },
      }))
    } finally {
      if (readGenerationRef.current.get(absPath) === generation) {
        loadingPathsRef.current.delete(absPath)
      }
    }
  }, [])

  // P2：只在文件真正成为 active 时读取。打开十几个 tab 不再立刻读取十几份内容。
  useEffect(() => {
    if (
      activeAbsPath != null &&
      openPathsRef.current.has(activeAbsPath) &&
      runtimes[activeAbsPath] == null &&
      !loadingPathsRef.current.has(activeAbsPath)
    ) {
      void readFile(activeAbsPath)
    }
  }, [activeAbsPath, runtimes, readFile])

  // P1 + P2 内存回收：关闭项全部删除；非激活项只保留未保存内容，已保存内容可按需重读。
  useEffect(() => {
    const openPaths = openPathsRef.current
    // 切走或关闭时让尚未完成的读取失效。这样同一路径随即重新激活/重新打开时，
    // 会发起新请求，旧请求即使更晚返回也不能覆盖新一轮 runtime。
    for (const path of loadingPathsRef.current) {
      if (!openPaths.has(path) || path !== activeAbsPath) {
        readGenerationRef.current.set(path, (readGenerationRef.current.get(path) ?? 0) + 1)
        loadingPathsRef.current.delete(path)
      }
    }
    setRuntimes((prev) => {
      let changed = false
      const next: RuntimeMap = {}
      for (const [path, runtime] of Object.entries(prev)) {
        const dirty = runtime.state === 'ready' && runtime.content !== runtime.savedContent
        if (openPaths.has(path) && (path === activeAbsPath || dirty)) {
          next[path] = runtime
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [files, activeAbsPath])

  const editActive = useCallback(
    (content: string) => {
      if (activeAbsPath == null) return
      setRuntimes((prev) => {
        const cur = prev[activeAbsPath] ?? EMPTY_RUNTIME
        return { ...prev, [activeAbsPath]: { ...cur, content } }
      })
    },
    [activeAbsPath],
  )

  const writeBack = useCallback(
    async (absPath: string, content: string) => {
      // encoding 来自读取时识别的源编码，按原编码写回避免保存后文件被静默转码
      const encoding = runtimes[absPath]?.encoding
      const res = (await window.spark.invoke('file:write-text', {
        path: absPath,
        content,
        ...(encoding != null ? { encoding } : {}),
      })) as FileWriteResp
      if (!res.success) throw new Error('写入失败')
      setRuntimes((prev) => ({
        ...prev,
        [absPath]: {
          ...(prev[absPath] ?? EMPTY_RUNTIME),
          savedContent: content,
          externalChanged: false,
        },
      }))
    },
    [runtimes],
  )

  const saveActive = useCallback(async () => {
    if (activeAbsPath == null) return
    const rt = runtimes[activeAbsPath]
    if (rt == null || rt.state !== 'ready') return
    if (rt.content === rt.savedContent) return // 未编辑

    // 保存前重读磁盘，检测外部变更
    let diskContent: string | null = null
    try {
      const r = (await window.spark.invoke('file:read', {
        filePath: activeAbsPath,
        maxBytes: CODE_VIEWER_MAX_FILE_BYTES,
        rejectBinary: true,
      })) as FileReadResp
      if (!r.error) diskContent = r.content ?? ''
    } catch {
      /* 读取失败则跳过检测，按原内容保存 */
    }
    if (diskContent != null && diskContent !== rt.savedContent) {
      setRuntimes((prev) => ({
        ...prev,
        [activeAbsPath]: { ...(prev[activeAbsPath] ?? EMPTY_RUNTIME), externalChanged: true },
      }))
      throw new CodeFileExternalChangeError(activeAbsPath, diskContent)
    }

    await writeBack(activeAbsPath, rt.content)
  }, [activeAbsPath, runtimes, writeBack])

  const reloadActive = useCallback(async () => {
    if (activeAbsPath == null) return
    loadingPathsRef.current.delete(activeAbsPath)
    await readFile(activeAbsPath)
  }, [activeAbsPath, readFile])

  const forceSaveActive = useCallback(async () => {
    if (activeAbsPath == null) return
    const rt = runtimes[activeAbsPath]
    if (rt == null) return
    await writeBack(activeAbsPath, rt.content)
  }, [activeAbsPath, runtimes, writeBack])

  const isDirty = useCallback(
    (absPath: string): boolean => {
      const rt = runtimes[absPath]
      return rt != null && rt.state === 'ready' && rt.content !== rt.savedContent
    },
    [runtimes],
  )

  const activeRuntime = activeAbsPath != null ? runtimes[activeAbsPath] : undefined

  return { runtimes, activeRuntime, editActive, saveActive, reloadActive, forceSaveActive, isDirty }
}
