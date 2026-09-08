/**
 * useGitFileHistory —— 按需加载单个文件的 Git 提交历史。
 *
 * 只有用户点击提交下的文件时才请求；请求变化时用 cancelled 守卫避免旧结果覆盖新文件。
 */

import { useEffect, useState } from 'react'
import type { WorkspaceGitFileHistoryEntry } from '@spark/protocol'

export interface GitFileHistoryState {
  loading: boolean
  commits: WorkspaceGitFileHistoryEntry[]
  error: string | null
}

const EMPTY_STATE: GitFileHistoryState = { loading: false, commits: [], error: null }

export function useGitFileHistory(
  workspaceId: string | null,
  filePath: string | null,
): GitFileHistoryState {
  const [state, setState] = useState<GitFileHistoryState>(EMPTY_STATE)

  useEffect(() => {
    if (workspaceId == null || filePath == null) {
      setState(EMPTY_STATE)
      return
    }
    let cancelled = false
    setState({ loading: true, commits: [], error: null })
    window.spark
      .invoke('workspace:git-file-history', { workspaceId, path: filePath, limit: 100 })
      .then((response: { commits: WorkspaceGitFileHistoryEntry[] }) => {
        if (cancelled) return
        setState({ loading: false, commits: response.commits ?? [], error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const rawMessage = error instanceof Error ? error.message : '加载文件变更历史失败'
        const message = rawMessage.includes('No handler registered')
          ? '主进程尚未加载文件历史接口，请重启应用后重试。'
          : rawMessage
        setState({ loading: false, commits: [], error: message })
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, filePath])

  return state
}
