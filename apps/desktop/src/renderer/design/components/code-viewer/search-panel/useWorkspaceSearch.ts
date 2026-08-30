/**
 * useWorkspaceSearch — 搜索面板的数据层。
 *
 * 性能与竞态设计：
 *   - 文件搜索防抖 200ms；内容搜索防抖 400ms（Enter 立即触发）。
 *   - 内容搜索：新搜索先 cancel 旧 requestId；流事件按 requestId 过滤，
 *     旧请求的迟到批次直接丢弃。
 *   - 结果分批到达时增量 concat；总量由主进程上限兜底（默认 2000）。
 *   - workspaceId 变化时清空结果并取消在途搜索。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  WorkspaceSearchContentMatch,
  WorkspaceSearchContentStats,
  WorkspaceSearchFileHit,
} from '@spark/protocol'

export type SearchMode = 'files' | 'content'

export interface WorkspaceSearchState {
  /** 文件搜索结果（files 模式） */
  fileHits: WorkspaceSearchFileHit[]
  /** 内容搜索结果（content 模式，按到达顺序累积；分组在渲染层做） */
  contentMatches: WorkspaceSearchContentMatch[]
  loading: boolean
  error: string | null
  truncated: boolean
  cancelled: boolean
  stats: WorkspaceSearchContentStats | null
  totalFiles: number
  fromCache: boolean
}

const FILES_DEBOUNCE_MS = 200
const CONTENT_DEBOUNCE_MS = 400
/** 内容搜索最小查询长度（过短查询全仓库扫，极易白屏无意义结果） */
const CONTENT_MIN_QUERY = 2

export interface WorkspaceSearchParams {
  workspaceId: string | null
  mode: SearchMode
  query: string
  caseSensitive: boolean
  /** 依赖变化时触发重新搜索（如显式点击刷新索引） */
  refreshToken: number
}

export function useWorkspaceSearch({
  workspaceId,
  mode,
  query,
  caseSensitive,
  refreshToken,
}: WorkspaceSearchParams): WorkspaceSearchState & {
  /** 跳过防抖立即执行一次内容搜索（Enter） */
  runContentNow: () => void
} {
  const [state, setState] = useState<WorkspaceSearchState>({
    fileHits: [],
    contentMatches: [],
    loading: false,
    error: null,
    truncated: false,
    cancelled: false,
    stats: null,
    totalFiles: 0,
    fromCache: true,
  })

  const activeRequestIdRef = useRef<string | null>(null)
  const runTokenRef = useRef(0)
  const contentDebounceTimerRef = useRef<number | null>(null)
  /** 已消费过的 refreshToken：新一轮（值变大）才带 refresh=true 强制重建索引 */
  const appliedRefreshRef = useRef(0)

  const cancelActive = useCallback(async (): Promise<void> => {
    const requestId = activeRequestIdRef.current
    if (requestId != null) {
      activeRequestIdRef.current = null
      try {
        await window.spark.invoke('workspace-search:cancel', { requestId })
      } catch {
        /* 主进程侧搜索已结束等场景：忽略 */
      }
    }
  }, [])

  // 流事件订阅：只认当前 requestId 的批次与终态
  useEffect(() => {
    const unsubscribe = window.spark.on('stream:workspace-search:content', (payload) => {
      if (payload.requestId !== activeRequestIdRef.current) return
      if (payload.done) {
        activeRequestIdRef.current = null
        setState((prev) => ({
          ...prev,
          loading: false,
          truncated: payload.truncated,
          cancelled: payload.cancelled,
          stats: payload.stats ?? prev.stats,
          error: payload.error ?? null,
        }))
        return
      }
      if (payload.batch.length === 0) return
      setState((prev) => ({
        ...prev,
        contentMatches: prev.contentMatches.concat(payload.batch),
      }))
    })
    return unsubscribe
  }, [])

  // workspace 切换：清结果 + 取消在途
  useEffect(() => {
    void cancelActive()
    runTokenRef.current += 1
    setState({
      fileHits: [],
      contentMatches: [],
      loading: false,
      error: null,
      truncated: false,
      cancelled: false,
      stats: null,
      totalFiles: 0,
      fromCache: true,
    })
  }, [workspaceId, cancelActive])

  // 面板关闭 / 组件卸载时停止主进程扫描，避免隐藏后继续消耗 IO。
  useEffect(
    () => () => {
      runTokenRef.current += 1
      void cancelActive()
    },
    [cancelActive],
  )

  const runContentSearch = useCallback(
    async (q: string): Promise<void> => {
      if (workspaceId == null) return
      const runToken = ++runTokenRef.current
      await cancelActive()
      const requestId = window.crypto.randomUUID()
      activeRequestIdRef.current = requestId
      setState((prev) => ({
        ...prev,
        contentMatches: [],
        loading: true,
        error: null,
        truncated: false,
        cancelled: false,
        stats: null,
      }))
      try {
        const res = await window.spark.invoke('workspace-search:content', {
          workspaceId,
          requestId,
          query: q,
          caseSensitive,
        })
        if (runTokenRef.current !== runToken) return
        if (res.requestId !== requestId) throw new Error('搜索请求标识不一致')
      } catch (err) {
        if (runTokenRef.current !== runToken) return
        if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },
    [workspaceId, caseSensitive, cancelActive],
  )

  const runContentNow = useCallback((): void => {
    const q = query.trim()
    if (workspaceId == null || q.length < CONTENT_MIN_QUERY) return
    if (contentDebounceTimerRef.current != null) {
      window.clearTimeout(contentDebounceTimerRef.current)
      contentDebounceTimerRef.current = null
    }
    void runContentSearch(q)
  }, [query, workspaceId, runContentSearch])

  // 防抖搜索调度（模式内自动触发）
  useEffect(() => {
    const q = query.trim()
    if (workspaceId == null || q === '') {
      // 清空查询：清结果（并取消在途内容搜索）
      void cancelActive()
      runTokenRef.current += 1
      setState((prev) => ({
        ...prev,
        fileHits: [],
        contentMatches: [],
        loading: false,
        error: null,
        truncated: false,
        cancelled: false,
        stats: null,
      }))
      return
    }

    if (mode === 'files') {
      void cancelActive()
      runTokenRef.current += 1
      const wantsRefresh = refreshToken > appliedRefreshRef.current
      appliedRefreshRef.current = refreshToken
      const timer = window.setTimeout(async () => {
        const runToken = ++runTokenRef.current
        setState((prev) => ({ ...prev, loading: true, error: null }))
        try {
          const res = await window.spark.invoke('workspace-search:files', {
            workspaceId,
            query: q,
            limit: 200,
            ...(wantsRefresh ? { refresh: true } : {}),
          })
          if (runTokenRef.current !== runToken) return
          setState((prev) => ({
            ...prev,
            fileHits: res.hits,
            totalFiles: res.totalFiles,
            fromCache: res.fromCache,
            truncated: res.truncated,
            loading: false,
          }))
        } catch (err) {
          if (runTokenRef.current !== runToken) return
          setState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          }))
        }
      }, FILES_DEBOUNCE_MS)
      return () => window.clearTimeout(timer)
    }

    // content 模式：长度不足不自动跑（Enter 也不跑），提示由 UI 层展示
    if (q.length < CONTENT_MIN_QUERY) {
      void cancelActive()
      runTokenRef.current += 1
      setState((prev) => ({ ...prev, contentMatches: [], loading: false, truncated: false }))
      return
    }
    // 防抖等待期间立即停止旧扫描；新请求使用独立 requestId，不会被迟到 cancel 误伤。
    void cancelActive()
    runTokenRef.current += 1
    const timer = window.setTimeout(() => {
      if (contentDebounceTimerRef.current === timer) contentDebounceTimerRef.current = null
      void runContentSearch(q)
    }, CONTENT_DEBOUNCE_MS)
    contentDebounceTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (contentDebounceTimerRef.current === timer) contentDebounceTimerRef.current = null
    }
  }, [workspaceId, mode, query, caseSensitive, refreshToken, runContentSearch, cancelActive])

  return { ...state, runContentNow }
}
