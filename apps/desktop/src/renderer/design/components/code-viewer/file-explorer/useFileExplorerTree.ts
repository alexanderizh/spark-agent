/**
 * 文件树核心 hook：扁平 Map + lazy load + watch 增量同步。
 *
 * 数据模型：扁平 Map<path, FileExplorerNode>（path = 相对 root 的 posix 路径，root 为 ''）。
 *
 * - 数据源：workspace:list-directory（root 与展开目录都只请求直接子项 maxDepth:0）
 * - 实时性：workspace:watch-start/stop + stream:workspace:file-change
 *   收到变更事件后，把受影响的父目录加入「待 reload」集合，防抖后批量重拉该层，
 *   保证 type / hasChildren 权威；delete 的子孙在 reload 前先本地级联删除以即时反馈。
 * - 展开态受控（expandedDirs 由 ChatView 持有，便于 per-session 快照存盘）；
 *   本 hook 的所有写入绝不触碰 expandedDirs —— 折叠时由 toggleDir 显式移除子孙展开态。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionId, WorkspaceFileChangePayload, WorkspaceTreeEntry } from '@spark/protocol'
import { useIpcStream } from '../../../hooks/useIpc'
import {
  ROOT_PATH,
  computeVisiblePaths,
  parentPath,
  toExplorerNode,
  type FileExplorerNode,
} from './fileExplorerTypes'

const RELOAD_DEBOUNCE_MS = 250

export interface UseFileExplorerTreeOptions {
  workspaceId: string | null
  sessionId?: SessionId | null
  enabled: boolean
  expandedDirs: Set<string>
  onExpandedChange: (next: Set<string>) => void
}

export interface UseFileExplorerTreeResult {
  nodes: Map<string, FileExplorerNode>
  visiblePaths: string[]
  loading: boolean
  error: string | null
  /** 展开/折叠目录（折叠时一并收起子孙展开态；首次展开触发 lazy load） */
  toggleDir: (path: string) => void
  /** 重新加载根（手动刷新） */
  refresh: () => void
}

function makeRootNode(): FileExplorerNode {
  return { path: ROOT_PATH, name: '', type: 'directory', depth: 0, hasChildren: true }
}

async function listDirectChildren(
  workspaceId: string,
  sessionId: SessionId | null,
  dirPath: string,
): Promise<WorkspaceTreeEntry[]> {
  const res = (await window.spark.invoke('workspace:list-directory', {
    workspaceId,
    ...(sessionId != null ? { sessionId } : {}),
    ...(dirPath === ROOT_PATH ? {} : { path: dirPath }),
    maxDepth: 0,
    includeIgnoredDirectories: true,
  })) as { entries: WorkspaceTreeEntry[] }
  return res.entries
}

/** 本地级联删除 target 及其所有子孙，返回新 Map（watch delete 即时反馈用） */
function deleteSubtree(
  prev: Map<string, FileExplorerNode>,
  target: string,
): Map<string, FileExplorerNode> {
  const next = new Map(prev)
  const prefix = target === ROOT_PATH ? '' : target + '/'
  for (const key of Array.from(next.keys())) {
    if (key === target) {
      next.delete(key)
    } else if (prefix !== '' && key.startsWith(prefix)) {
      next.delete(key)
    }
  }
  return next
}

export function useFileExplorerTree({
  workspaceId,
  sessionId = null,
  enabled,
  expandedDirs,
  onExpandedChange,
}: UseFileExplorerTreeOptions): UseFileExplorerTreeResult {
  const [nodes, setNodes] = useState<Map<string, FileExplorerNode>>(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // workspaceId ref：watch 回调可能在切换后到达，需校验所属 workspace
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  const expandedDirsRef = useRef(expandedDirs)
  expandedDirsRef.current = expandedDirs
  const rootLoadGenerationRef = useRef(0)
  // 待 reload 的目录集合 + 防抖定时器
  const pendingReloadRef = useRef<Set<string>>(new Set())
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadRoot = useCallback(async () => {
    const wid = workspaceIdRef.current
    if (wid == null) return
    const generation = rootLoadGenerationRef.current + 1
    rootLoadGenerationRef.current = generation
    setLoading(true)
    setError(null)
    try {
      const next = new Map<string, FileExplorerNode>()
      next.set(ROOT_PATH, makeRootNode())
      for (const entry of await listDirectChildren(wid, sessionId, ROOT_PATH)) {
        const node = toExplorerNode(entry)
        next.set(node.path, node)
      }
      // 会话会持久化展开态；按层级恢复其直接子项，避免单层根请求后出现“展开但为空”。
      const restoredDirs = Array.from(expandedDirsRef.current).sort(
        (left, right) => left.split('/').length - right.split('/').length,
      )
      for (const dirPath of restoredDirs) {
        if (next.get(dirPath)?.type !== 'directory') continue
        try {
          for (const entry of await listDirectChildren(wid, sessionId, dirPath)) {
            const node = toExplorerNode(entry)
            next.set(node.path, node)
          }
        } catch {
          // 展开态可能引用已删除/移动的目录；保留其余可恢复节点。
        }
      }
      if (rootLoadGenerationRef.current !== generation || workspaceIdRef.current !== wid) return
      setNodes(next)
    } catch (err) {
      if (rootLoadGenerationRef.current !== generation || workspaceIdRef.current !== wid) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (rootLoadGenerationRef.current === generation && workspaceIdRef.current === wid) {
        setLoading(false)
      }
    }
  }, [sessionId])

  /**
   * 重拉某目录的直接子项（maxDepth:0）。
   * 清掉该目录下所有已加载子孙（避免孤立陈旧节点），再套入权威一级子项；
   * 更深的孙层会在用户展开时由 toggleDir 重新 lazy load。
   */
  const reloadDir = useCallback(
    async (dirPath: string) => {
      const wid = workspaceIdRef.current
      if (wid == null) return
      try {
        const entries = await listDirectChildren(wid, sessionId, dirPath)
        if (workspaceIdRef.current !== wid) return
        setNodes((prev) => {
          const next = new Map(prev)
          const prefix = dirPath === ROOT_PATH ? '' : dirPath + '/'
          for (const key of Array.from(next.keys())) {
            if (prefix === '') {
              if (key !== ROOT_PATH) next.delete(key)
            } else if (key.startsWith(prefix)) {
              next.delete(key)
            }
          }
          for (const entry of entries) {
            const node = toExplorerNode(entry)
            next.set(node.path, node)
          }
          // 修正 dir 的 hasChildren
          const dirNode = next.get(dirPath)
          if (dirNode != null && dirNode.type === 'directory') {
            let hasChild = false
            for (const key of next.keys()) {
              if (key !== dirPath && parentPath(key) === dirPath) {
                hasChild = true
                break
              }
            }
            next.set(dirPath, { ...dirNode, hasChildren: hasChild })
          }
          return next
        })
      } catch {
        /* 单目录 reload 失败不致命，下次 refresh 兜底 */
      }
    },
    [sessionId],
  )

  const flushPendingReloads = useCallback(() => {
    reloadTimerRef.current = null
    const dirs = Array.from(pendingReloadRef.current)
    pendingReloadRef.current.clear()
    for (const dir of dirs) {
      void reloadDir(dir)
    }
  }, [reloadDir])

  const scheduleReload = useCallback(
    (dirPath: string) => {
      pendingReloadRef.current.add(dirPath)
      if (reloadTimerRef.current != null) clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = setTimeout(flushPendingReloads, RELOAD_DEBOUNCE_MS)
    },
    [flushPendingReloads],
  )

  // enabled / workspaceId 变化：加载 root + 启停 watch
  useEffect(() => {
    if (!enabled || workspaceId == null) {
      rootLoadGenerationRef.current += 1
      setLoading(false)
      setNodes(new Map())
      return
    }
    void loadRoot()
    void window.spark
      .invoke('workspace:watch-start', {
        workspaceId,
        ...(sessionId != null ? { sessionId } : {}),
      })
      .catch(() => {
        /* watch 启动失败不阻断浏览，仅失去实时性 */
      })
    return () => {
      rootLoadGenerationRef.current += 1
      if (reloadTimerRef.current != null) clearTimeout(reloadTimerRef.current)
      pendingReloadRef.current.clear()
      void window.spark
        .invoke('workspace:watch-stop', {
          workspaceId,
          ...(sessionId != null ? { sessionId } : {}),
        })
        .catch(() => {
          /* 忽略 */
        })
    }
  }, [enabled, workspaceId, sessionId, loadRoot])

  // 监听文件变更：delete 本地级联删 + reload 父；create/modify/rename reload 父
  useIpcStream('stream:workspace:file-change', (payload: WorkspaceFileChangePayload) => {
    if (workspaceIdRef.current !== payload.workspaceId) return
    const posixPath = payload.path.replace(/\\/g, '/')
    if (payload.changeType === 'delete' || payload.changeType === 'rename') {
      const target =
        payload.changeType === 'rename'
          ? (payload.oldPath?.replace(/\\/g, '/') ?? posixPath)
          : posixPath
      setNodes((prev) => deleteSubtree(prev, target))
      scheduleReload(parentPath(target))
    }
    if (
      payload.changeType === 'create' ||
      payload.changeType === 'rename' ||
      payload.changeType === 'modify'
    ) {
      scheduleReload(parentPath(posixPath))
    }
  })

  const toggleDir = useCallback(
    (dirPath: string) => {
      const next = new Set(expandedDirs)
      if (expandedDirs.has(dirPath)) {
        // 折叠：移除自身及所有子孙展开态
        const prefix = dirPath === ROOT_PATH ? '' : dirPath + '/'
        for (const key of Array.from(next)) {
          if (key === dirPath || (prefix !== '' && key.startsWith(prefix))) next.delete(key)
        }
      } else {
        next.add(dirPath)
        // 首次展开（尚无已加载子项）触发 lazy load
        let hasLoaded = false
        for (const key of nodes.keys()) {
          if (key !== dirPath && parentPath(key) === dirPath) {
            hasLoaded = true
            break
          }
        }
        if (!hasLoaded) void reloadDir(dirPath)
      }
      onExpandedChange(next)
    },
    [expandedDirs, nodes, onExpandedChange, reloadDir],
  )

  const refresh = useCallback(() => {
    void loadRoot()
  }, [loadRoot])

  const visiblePaths = useMemo(
    () => computeVisiblePaths(nodes, expandedDirs),
    [nodes, expandedDirs],
  )

  return { nodes, visiblePaths, loading, error, toggleDir, refresh }
}
