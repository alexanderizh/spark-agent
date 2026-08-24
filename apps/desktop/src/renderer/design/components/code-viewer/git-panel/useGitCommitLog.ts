/**
 * useGitCommitLog —— 拉取「提交板块」的提交历史（workspace:git-log）。
 *
 * refreshKey 变化（GitPanel 传入 status 指纹 + 手动刷新 tick）时重新拉取；
 * 与 useGitDiff 同款 cancelled 守卫与「主进程未加载接口」友好提示。
 */

import { useEffect, useState } from 'react'
import type { WorkspaceGitCommitEntry } from '@spark/protocol'

export interface GitCommitLogState {
  loading: boolean
  commits: WorkspaceGitCommitEntry[]
  error: string | null
}

export function useGitCommitLog(workspaceId: string | null, refreshKey: string): GitCommitLogState {
  const [state, setState] = useState<GitCommitLogState>({
    loading: false,
    commits: [],
    error: null,
  })

  useEffect(() => {
    if (workspaceId == null) {
      setState({ loading: false, commits: [], error: null })
      return
    }
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    window.spark
      .invoke('workspace:git-log', { workspaceId, limit: 100 })
      .then((res: { commits: WorkspaceGitCommitEntry[] }) => {
        if (cancelled) return
        setState({ loading: false, commits: res.commits ?? [], error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载提交记录失败'
        if (message.includes('No handler registered')) {
          setState({
            loading: false,
            commits: [],
            error: '主进程尚未加载提交记录接口，请重启应用后重试。',
          })
          return
        }
        setState({ loading: false, commits: [], error: message })
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, refreshKey])

  return state
}
