/**
 * 远程会话树的数据层。
 *
 * 懒加载：只有展开的项目才拉会话；项目层只用 /v1/projects 的 sessionCount /
 * runningSessionCount 渲染角标，所以首屏只发一个几百字节的请求。
 * 缓存：全部落在 remoteSessionStore（模块级），切视图回来命中 TTL 就不发请求。
 * 刷新：手动按钮 force 全刷；另有 30s 轮询，页面不可见时跳过，已展开项目按 TTL 去重。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MobileBridgeProjectSummary, MobileBridgeSessionSummary } from '@spark/protocol'
import { useRemoteCall } from './useRemoteBridge'
import {
  ALL_SESSIONS_TTL_MS,
  PROJECTS_TTL_MS,
  REFRESH_INTERVAL_MS,
  SESSIONS_TTL_MS,
  UNASSIGNED_PROJECT_ID,
  getRemoteSessionStore,
  isStale,
  subscribeRemoteSessionStore,
  updateRemoteSessionStore,
} from './remoteSessionStore'
import { readExpandedProjects, rememberExpandedProjects } from './remoteViewState'

const SESSION_PAGE_LIMIT = 60
const SEARCH_PAGE_LIMIT = 200

interface ProjectsBody {
  projects?: MobileBridgeProjectSummary[]
  unassignedRunningSessionCount?: number
}

interface SessionsBody {
  sessions?: MobileBridgeSessionSummary[]
  total?: number
}

export function useRemoteSessionTree(deviceId: string) {
  const call = useRemoteCall()
  // store 是可变单例：用 version 当快照驱动重渲染，渲染时直接读最新字段
  const version = useSyncExternalStore(
    subscribeRemoteSessionStore,
    () => getRemoteSessionStore(deviceId).version,
    () => 0,
  )
  const store = getRemoteSessionStore(deviceId)

  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [keyword, setKeywordState] = useState('')
  /** 轮询回调里要读最新关键词，避免用 effect 依赖反复重建定时器 */
  const keywordRef = useRef('')

  const setKeyword = useCallback((value: string) => {
    keywordRef.current = value
    setKeywordState(value)
  }, [])

  const toMessage = (cause: unknown): string =>
    cause instanceof Error ? cause.message : String(cause)

  const loadProjects = useCallback(
    async (force = false) => {
      const snapshot = getRemoteSessionStore(deviceId)
      if (
        !force &&
        snapshot.projectsLoaded &&
        !isStale(snapshot.projectsFetchedAt, PROJECTS_TTL_MS)
      )
        return
      const body = await call<ProjectsBody>(deviceId, 'GET', '/v1/projects?limit=100')
      updateRemoteSessionStore(deviceId, (next) => {
        next.projects = Array.isArray(body.projects) ? body.projects : []
        next.unassignedRunning = body.unassignedRunningSessionCount ?? 0
        next.projectsLoaded = true
        next.projectsFetchedAt = Date.now()
      })
    },
    [call, deviceId],
  )

  const loadSessions = useCallback(
    async (projectId: string, force = false) => {
      const snapshot = getRemoteSessionStore(deviceId)
      const cached = snapshot.sessions[projectId]
      if (!force && cached != null && !isStale(cached.fetchedAt, SESSIONS_TTL_MS)) return
      setPending((previous) =>
        previous[projectId] ? previous : { ...previous, [projectId]: true },
      )
      try {
        const body = await call<SessionsBody>(
          deviceId,
          'GET',
          `/v1/sessions?projectId=${encodeURIComponent(projectId)}&limit=${SESSION_PAGE_LIMIT}`,
        )
        updateRemoteSessionStore(deviceId, (next) => {
          next.sessions[projectId] = {
            rows: Array.isArray(body.sessions) ? body.sessions : [],
            total: body.total ?? 0,
            fetchedAt: Date.now(),
          }
        })
      } finally {
        setPending((previous) => {
          if (previous[projectId] == null) return previous
          const next = { ...previous }
          delete next[projectId]
          return next
        })
      }
    },
    [call, deviceId],
  )

  const loadAllSessions = useCallback(
    async (force = false) => {
      const snapshot = getRemoteSessionStore(deviceId)
      if (
        !force &&
        snapshot.allSessions != null &&
        !isStale(snapshot.allSessions.fetchedAt, ALL_SESSIONS_TTL_MS)
      )
        return
      const body = await call<SessionsBody>(
        deviceId,
        'GET',
        `/v1/sessions?limit=${SEARCH_PAGE_LIMIT}`,
      )
      updateRemoteSessionStore(deviceId, (next) => {
        next.allSessions = {
          rows: Array.isArray(body.sessions) ? body.sessions : [],
          total: body.total ?? 0,
          fetchedAt: Date.now(),
        }
      })
    },
    [call, deviceId],
  )

  /** 首次进入：项目列表按 TTL 决定要不要发请求，再把记住的展开项目补齐 */
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const initial = getRemoteSessionStore(deviceId)
        // 进程内缓存是空的（刚启动）→ 用上次的展开状态铺一遍，用户回来看到的树还是原样
        if (!initial.projectsLoaded && Object.keys(initial.expanded).length === 0) {
          const remembered = readExpandedProjects(deviceId)
          if (remembered.length > 0) {
            updateRemoteSessionStore(deviceId, (next) => {
              for (const projectId of remembered) next.expanded[projectId] = true
            })
          }
        }
        await loadProjects()
        const snapshot = getRemoteSessionStore(deviceId)
        // 没有项目但有会话（全新安装/只用未归属）时，兜底把未归属拉出来
        if (snapshot.projectsLoaded && snapshot.projects.length === 0) {
          await loadSessions(UNASSIGNED_PROJECT_ID)
        }
        for (const [projectId, open] of Object.entries(snapshot.expanded)) {
          if (open) await loadSessions(projectId)
        }
        if (!cancelled) setError(null)
      } catch (cause) {
        if (!cancelled) setError(toMessage(cause))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [deviceId, loadProjects, loadSessions])

  /** 搜索才需要全量会话：命中缓存就不发请求，输入过程中不会连打 */
  const searching = keyword.trim().length > 0
  useEffect(() => {
    if (!searching) return
    let cancelled = false
    loadAllSessions().catch((cause: unknown) => {
      if (!cancelled) setError(toMessage(cause))
    })
    return () => {
      cancelled = true
    }
  }, [loadAllSessions, searching])

  /** 轮询：项目列表每轮刷；展开的项目按 TTL 去重（25s < 30s，等于每轮都刷） */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      loadProjects(true).catch(() => {
        /* 轮询失败不打扰用户，下一次再试 */
      })
      const snapshot = getRemoteSessionStore(deviceId)
      for (const [projectId, open] of Object.entries(snapshot.expanded)) {
        if (open) {
          loadSessions(projectId).catch(() => {
            /* 同上 */
          })
        }
      }
      if (keywordRef.current.trim().length > 0) {
        loadAllSessions().catch(() => {
          /* 同上 */
        })
      }
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [deviceId, loadAllSessions, loadProjects, loadSessions])

  const toggleProject = useCallback(
    (projectId: string) => {
      const snapshot = getRemoteSessionStore(deviceId)
      const open = snapshot.expanded[projectId] !== true
      updateRemoteSessionStore(deviceId, (next) => {
        next.expanded[projectId] = open
      })
      rememberExpandedProjects(deviceId, getRemoteSessionStore(deviceId).expanded)
      if (open) {
        loadSessions(projectId).catch((cause: unknown) => setError(toMessage(cause)))
      }
    },
    [deviceId, loadSessions],
  )

  const expandProject = useCallback(
    (projectId: string) => {
      const snapshot = getRemoteSessionStore(deviceId)
      if (snapshot.expanded[projectId] === true) return
      updateRemoteSessionStore(deviceId, (next) => {
        next.expanded[projectId] = true
      })
      rememberExpandedProjects(deviceId, getRemoteSessionStore(deviceId).expanded)
      loadSessions(projectId).catch((cause: unknown) => setError(toMessage(cause)))
    },
    [deviceId, loadSessions],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadProjects(true)
      const snapshot = getRemoteSessionStore(deviceId)
      const expanded = Object.entries(snapshot.expanded)
        .filter(([, open]) => open)
        .map(([projectId]) => projectId)
      // 项目列表为空时把未归属也刷一遍（上面兜底过，这里保持一致）
      if (snapshot.projects.length === 0 && !expanded.includes(UNASSIGNED_PROJECT_ID)) {
        expanded.push(UNASSIGNED_PROJECT_ID)
      }
      await Promise.all(expanded.map((projectId) => loadSessions(projectId, true)))
      if (keywordRef.current.trim().length > 0) await loadAllSessions(true)
      setError(null)
    } catch (cause) {
      setError(toMessage(cause))
    } finally {
      setRefreshing(false)
    }
  }, [deviceId, loadAllSessions, loadProjects, loadSessions])

  return {
    /** version 变化即触发重渲染；store 字段始终是最新值 */
    version,
    store,
    keyword,
    setKeyword,
    searching,
    toggleProject,
    expandProject,
    refresh,
    refreshing,
    pending,
    error,
    dismissError: () => setError(null),
  }
}

/**
 * 选中会话的标题（聊天区标题栏用）。
 *
 * 直接读同一个模块级缓存，不额外发请求：会话行改名后标题栏同步更新，
 * 也不需要在 chat pane 里再挂一遍 useRemoteSessionTree（那样会多一份轮询）。
 */
export function useRemoteSessionTitle(deviceId: string, sessionId: string | null): string | null {
  useSyncExternalStore(
    subscribeRemoteSessionStore,
    () => getRemoteSessionStore(deviceId).version,
    () => 0,
  )
  if (sessionId == null) return null
  const store = getRemoteSessionStore(deviceId)
  for (const bucket of Object.values(store.sessions)) {
    const hit = bucket.rows.find((row) => row.id === sessionId)
    if (hit != null) return hit.title || '未命名会话'
  }
  const fallback = store.allSessions?.rows.find((row) => row.id === sessionId)
  return fallback != null ? fallback.title || '未命名会话' : null
}
