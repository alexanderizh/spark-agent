/**
 * useGitDiff —— 切到「本次改动」视图时，按需调 workspace:git-file-diff 实时取 diff。
 *
 * 设计：只在 enabled（用户切到 diff 视图）时发起请求，避免对每个打开的文件都预取。
 * 用相对 workspace 的路径（OpenCodeFile.displayPath）+ workspaceId；新增文件传 untracked=true。
 *
 * 之所以不沿用变更记录卡片里的 FileChangeSummaryItem.diff 字段：那条 diff 是「该轮 agent 改动」
 * 的快照，而 renderBlocks 是模块级独立函数、调用处十余个，透传 diff 会大面积波及 onFilePreview
 * 链路。实时 git diff 零波及，且更贴近「文件当前状态」，MVP 优先此方案。
 */

import { useEffect, useState } from 'react'

export interface GitDiffState {
  loading: boolean
  diff?: string | undefined
  error?: string | undefined
  isBinary?: boolean | undefined
}

type GitDiffResp = { diff?: string; isBinary?: boolean }

export function useGitDiff(
  workspaceId: string | null | undefined,
  relativePath: string | null | undefined,
  untracked: boolean,
  enabled: boolean,
): GitDiffState {
  const [state, setState] = useState<GitDiffState>({ loading: false })

  useEffect(() => {
    if (!enabled || workspaceId == null || relativePath == null || relativePath.length === 0) {
      setState({ loading: false })
      return
    }
    let cancelled = false
    setState({ loading: true, diff: undefined, error: undefined })
    window.spark
      .invoke('workspace:git-file-diff', { workspaceId, path: relativePath, untracked })
      .then((r: GitDiffResp) => {
        if (cancelled) return
        setState({ loading: false, diff: r.diff ?? '', isBinary: r.isBinary })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message = e instanceof Error ? e.message : '加载 diff 失败'
        if (message.includes('No handler registered')) {
          setState({ loading: false, error: '主进程尚未加载 diff 接口，请重启应用后重试。' })
          return
        }
        setState({ loading: false, error: message })
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, relativePath, untracked, enabled])

  return state
}
