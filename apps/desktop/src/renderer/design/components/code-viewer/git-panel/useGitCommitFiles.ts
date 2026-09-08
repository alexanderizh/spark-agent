/**
 * useGitCommitFiles —— 按需加载一条提交涉及的文件列表。
 *
 * 只有用户展开提交时才请求，避免一次性为最近 100 条提交查询全部文件。
 */

import { useEffect, useState } from 'react'
import type { WorkspaceGitCommitFile } from '@spark/protocol'

export interface GitCommitFilesState {
  loading: boolean
  files: WorkspaceGitCommitFile[]
  error: string | null
}

const EMPTY_STATE: GitCommitFilesState = { loading: false, files: [], error: null }

export function useGitCommitFiles(
  workspaceId: string | null,
  commitHash: string | null,
): GitCommitFilesState {
  const [state, setState] = useState<GitCommitFilesState>(EMPTY_STATE)

  useEffect(() => {
    if (workspaceId == null || commitHash == null) {
      setState(EMPTY_STATE)
      return
    }
    let cancelled = false
    setState({ loading: true, files: [], error: null })
    window.spark
      .invoke('workspace:git-commit-files', { workspaceId, hash: commitHash })
      .then((response: { files: WorkspaceGitCommitFile[] }) => {
        if (cancelled) return
        setState({ loading: false, files: response.files ?? [], error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const rawMessage = error instanceof Error ? error.message : '加载提交文件失败'
        const message = rawMessage.includes('No handler registered')
          ? '主进程尚未加载提交文件接口，请重启应用后重试。'
          : rawMessage
        setState({ loading: false, files: [], error: message })
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, commitHash])

  return state
}
