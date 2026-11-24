/**
 * 远程项目信息面板的数据层（git 快照 + 产物聚合）。
 *
 * 与会话树（useRemoteSessionTree）不同：面板数据是「单项目快照」，生命周期跟随
 * (deviceId, projectId)，切换项目即重拉，不做跨项目缓存——左侧栏的项目列表已经
 * 承担了「多项目并存」的记忆职责，面板只对当前打开的项目负责。
 * 刷新：手动按钮 force；另有 30s 轮询（页面不可见跳过），与旧版目标端（无端点 404）
 * 兼容——unsupported 置位后面板渲染「对方版本较旧」占位，不再继续轮询。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MobileBridgeProjectArtifactsResponse,
  MobileBridgeProjectGitDiffResponse,
  MobileBridgeProjectGitResponse,
} from '@spark/protocol'
import { useRemoteCall } from './useRemoteBridge'

const POLL_INTERVAL_MS = 30_000

export interface RemoteProjectPanelSnapshot {
  git: MobileBridgeProjectGitResponse | null
  artifacts: MobileBridgeProjectArtifactsResponse | null
  /** 本轮快照完成时间（「x 分钟前更新」提示用） */
  fetchedAt: number | null
}

const IDLE_SNAPSHOT: RemoteProjectPanelSnapshot = {
  git: null,
  artifacts: null,
  fetchedAt: null,
}

export function useRemoteProjectPanel(deviceId: string, projectId: string | null) {
  const call = useRemoteCall()
  const [snapshot, setSnapshot] = useState<RemoteProjectPanelSnapshot>(IDLE_SNAPSHOT)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 目标端没有 git 端点（旧版桌面端 404）：面板降级占位，轮询同步停掉 */
  const [unsupported, setUnsupported] = useState(false)
  /** 产物端点独立错误态（2026-11-25）：失败不再被吞掉伪装成「0 产物」 */
  const [artifactsError, setArtifactsError] = useState<string | null>(null)
  /** 目标端没有产物端点（旧版桌面端 404）：产物区降级占位 */
  const [artifactsUnsupported, setArtifactsUnsupported] = useState(false)
  /** 请求序号：切换项目后晚到的旧响应直接丢弃，防止内容串项目 */
  const requestSeqRef = useRef(0)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'poll') => {
      if (projectId == null) return
      const seq = ++requestSeqRef.current
      if (mode === 'initial') setLoading(true)
      if (mode === 'refresh') setRefreshing(true)
      try {
        // 产物端点较旧版本也不存在：settle 后按 404 分类，git 的 404 才代表「版本过旧」
        const [gitResult, artifactsResult] = await Promise.allSettled([
          call<MobileBridgeProjectGitResponse>(
            deviceId,
            'GET',
            `/v1/projects/${encodeURIComponent(projectId)}/git`,
          ),
          call<MobileBridgeProjectArtifactsResponse>(
            deviceId,
            'GET',
            `/v1/projects/${encodeURIComponent(projectId)}/artifacts`,
          ),
        ])
        if (seq !== requestSeqRef.current) return
        // 快照刷新意味着远端状态可能已变：该项目的 diff 缓存一律作废，
        // 已展开的行仍显示手上的文本，重新展开会拿到新鲜 diff。
        clearProjectDiffCache(deviceId, projectId)
        const gitStatus = gitResult.status === 'fulfilled' ? null : gitResult.reason
        if (
          gitStatus != null &&
          typeof gitStatus === 'object' &&
          'status' in gitStatus &&
          (gitStatus as { status?: number }).status === 404
        ) {
          setUnsupported(true)
          setSnapshot(IDLE_SNAPSHOT)
          setError(null)
          setArtifactsError(null)
          setArtifactsUnsupported(false)
          return
        }
        const next: RemoteProjectPanelSnapshot = {
          git: gitResult.status === 'fulfilled' ? gitResult.value : null,
          artifacts: artifactsResult.status === 'fulfilled' ? artifactsResult.value : null,
          fetchedAt: Date.now(),
        }
        setSnapshot(next)
        setUnsupported(false)
        setError(
          gitResult.status === 'rejected'
            ? gitResult.reason instanceof Error
              ? gitResult.reason.message
              : String(gitResult.reason)
            : null,
        )
        // 产物失败分类：404 = 目标端版本旧（无端点）；其余 = 真实错误，如实展示
        if (artifactsResult.status === 'fulfilled') {
          setArtifactsError(null)
          setArtifactsUnsupported(false)
        } else {
          const reason = artifactsResult.reason
          const status =
            reason != null && typeof reason === 'object' && 'status' in reason
              ? (reason as { status?: number }).status
              : undefined
          setArtifactsUnsupported(status === 404)
          setArtifactsError(
            status === 404
              ? null
              : reason instanceof Error
                ? reason.message
                : String(reason ?? '产物读取失败'),
          )
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [call, deviceId, projectId],
  )

  // 切设备 / 切项目：清空旧快照立即重拉（旧响应由 requestSeq 丢弃）
  useEffect(() => {
    setSnapshot(IDLE_SNAPSHOT)
    setUnsupported(false)
    setError(null)
    setArtifactsError(null)
    setArtifactsUnsupported(false)
    if (projectId == null) return
    void load('initial')
  }, [deviceId, load, projectId])

  // 轮询：仅面板有数据可刷（非 unsupported）时进行；页面不可见跳过
  useEffect(() => {
    if (projectId == null || unsupported) return
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load('poll')
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [load, projectId, unsupported])

  const refresh = useCallback(() => {
    if (unsupported) return
    void load('refresh')
  }, [load, unsupported])

  /** 点击变更文件按需拉 diff；进程内缓存 + 失败移除可重试（与 remoteFileCache 同模式） */
  const loadDiff = useCallback(
    (filePath: string, untracked: boolean): Promise<MobileBridgeProjectGitDiffResponse> => {
      if (projectId == null) return Promise.reject(new Error('未选择项目'))
      return fetchProjectGitDiff(deviceId, projectId, filePath, untracked, call)
    },
    [call, deviceId, projectId],
  )

  return {
    snapshot,
    loading,
    refreshing,
    error,
    unsupported,
    artifactsError,
    artifactsUnsupported,
    refresh,
    loadDiff,
  }
}

// ─── 单文件 diff（点击变更文件按需拉取；失败可重试） ────────────────────────────

const diffCache = new Map<string, Promise<MobileBridgeProjectGitDiffResponse>>()

/** 缓存容量上限（已 resolve 的 promise 会一直持有 diff 文本，不设上限会慢慢堆积） */
const DIFF_CACHE_MAX_ENTRIES = 80

/** 该项目/设备的 diff 缓存整体作废（快照刷新后文件可能已变） */
function clearProjectDiffCache(deviceId: string, projectId: string): void {
  const prefix = `${deviceId}\u0000${projectId}\u0000`
  for (const key of diffCache.keys()) {
    if (key.startsWith(prefix)) diffCache.delete(key)
  }
}

function diffCacheKey(
  deviceId: string,
  projectId: string,
  filePath: string,
  untracked: boolean,
): string {
  return `${deviceId}\u0000${projectId}\u0000${untracked ? '1' : '0'}\u0000${filePath}`
}

/** 失败的 diff 从缓存移除，下次点击重试（与 remoteFileCache 同一模式） */
function fetchProjectGitDiff(
  deviceId: string,
  projectId: string,
  filePath: string,
  untracked: boolean,
  call: ReturnType<typeof useRemoteCall>,
): Promise<MobileBridgeProjectGitDiffResponse> {
  const key = diffCacheKey(deviceId, projectId, filePath, untracked)
  const cached = diffCache.get(key)
  if (cached != null) return cached
  const task = call<MobileBridgeProjectGitDiffResponse>(
    deviceId,
    'GET',
    `/v1/projects/${encodeURIComponent(projectId)}/git/diff?path=${encodeURIComponent(filePath)}${untracked ? '&untracked=1' : ''}`,
  )
  diffCache.set(key, task)
  // FIFO 淘汰：Map 保持插入序，最老的 key 最不可能再次被点击
  if (diffCache.size > DIFF_CACHE_MAX_ENTRIES) {
    const oldest = diffCache.keys().next().value
    if (oldest != null) diffCache.delete(oldest)
  }
  task.catch(() => {
    diffCache.delete(key)
  })
  return task
}
