/**
 * useGitPanelActions —— Git 面板全部写操作的统一入口。
 *
 * 每个动作：invoke 对应 IPC → 响应携带最新 status → 经 onStatusApplied
 * 回写 ChatView 的共享 git 快照（与提交弹窗同源）；同一时间只允许一个
 * 动作在跑（busy 互斥），错误经 toast 提示且不吞掉 git 的原始报错。
 */

import { useCallback, useRef, useState } from 'react'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { useToast } from '../../Toast'

export type GitPanelActionName =
  | 'stage'
  | 'unstage'
  | 'commit'
  | 'stash'
  | 'stashPop'
  | 'stashDrop'
  | 'discard'
  | 'push'
  | 'pull'
  | 'sync'

type StatusResp = { status: WorkspaceGitStatusResponse }

function extractIpcErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.length > 0) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return fallback
}

export function useGitPanelActions({
  workspaceId,
  onStatusApplied,
}: {
  workspaceId: string | null
  onStatusApplied: (status: WorkspaceGitStatusResponse | null) => void
}): {
  busy: GitPanelActionName | null
  stage: (paths?: string[]) => Promise<boolean>
  unstage: (paths?: string[]) => Promise<boolean>
  commitStaged: (message: string) => Promise<boolean>
  stash: (message?: string, includeUntracked?: boolean) => Promise<boolean>
  stashPop: (selector: string) => Promise<boolean>
  stashDrop: (selector: string) => Promise<boolean>
  discard: (paths: string[]) => Promise<boolean>
  push: () => Promise<boolean>
  pull: () => Promise<boolean>
  sync: () => Promise<boolean>
} {
  const { toast } = useToast()
  const [busy, setBusy] = useState<GitPanelActionName | null>(null)
  const busyRef = useRef<GitPanelActionName | null>(null)

  const run = useCallback(
    async (
      name: GitPanelActionName,
      invoke: (id: string) => Promise<StatusResp>,
      successText: (res: StatusResp) => string,
    ): Promise<boolean> => {
      if (workspaceId == null || busyRef.current != null) return false
      const id = workspaceId
      busyRef.current = name
      setBusy(name)
      try {
        const res = await invoke(id)
        onStatusApplied(res.status)
        toast.success(successText(res))
        return true
      } catch (err) {
        toast.error(extractIpcErrorMessage(err, '操作失败'))
        return false
      } finally {
        busyRef.current = null
        setBusy(null)
      }
    },
    [onStatusApplied, toast, workspaceId],
  )

  // paths / selector / message 是调用参数（undefined = 全部），捕获在回调闭包内，无需进依赖数组
  const stage = useCallback(
    (paths?: string[]) =>
      run(
        'stage',
        (id) =>
          window.spark.invoke('workspace:git-stage', {
            workspaceId: id,
            ...(paths != null ? { paths } : {}),
          }),
        () =>
          paths == null || paths.length === 0 ? '已暂存全部更改' : `已暂存 ${paths.length} 个文件`,
      ),
    [run],
  )

  const unstage = useCallback(
    (paths?: string[]) =>
      run(
        'unstage',
        (id) =>
          window.spark.invoke('workspace:git-unstage', {
            workspaceId: id,
            ...(paths != null ? { paths } : {}),
          }),
        () =>
          paths == null || paths.length === 0
            ? '已取消全部暂存'
            : `已取消暂存 ${paths.length} 个文件`,
      ),
    [run],
  )

  const commitStaged = useCallback(
    (message: string) =>
      run(
        'commit',
        (id) =>
          window.spark.invoke('workspace:git-commit', {
            workspaceId: id,
            message,
            includeUnstaged: false,
          }),
        (res) => {
          const commitResp = res as StatusResp & { commitSha?: string | null }
          return commitResp.commitSha != null ? `已提交 ${commitResp.commitSha}` : '已提交'
        },
      ),
    [run],
  )

  const stash = useCallback(
    (message?: string, includeUntracked?: boolean) =>
      run(
        'stash',
        (id) =>
          window.spark.invoke('workspace:git-stash-push', {
            workspaceId: id,
            ...(message != null ? { message } : {}),
            includeUntracked: includeUntracked === true,
          }),
        () => '已贮藏当前更改',
      ),
    [run],
  )

  const stashPop = useCallback(
    (selector: string) =>
      run(
        'stashPop',
        (id) => window.spark.invoke('workspace:git-stash-pop', { workspaceId: id, selector }),
        () => `已恢复 ${selector}`,
      ),
    [run],
  )

  const stashDrop = useCallback(
    (selector: string) =>
      run(
        'stashDrop',
        (id) => window.spark.invoke('workspace:git-stash-drop', { workspaceId: id, selector }),
        () => `已丢弃 ${selector}`,
      ),
    [run],
  )

  const discard = useCallback(
    (paths: string[]) =>
      run(
        'discard',
        (id) => window.spark.invoke('workspace:git-discard', { workspaceId: id, paths }),
        () => `已丢弃 ${paths.length} 个文件的更改`,
      ),
    [run],
  )

  const push = useCallback(
    () =>
      run(
        'push',
        (id) => window.spark.invoke('workspace:git-push', { workspaceId: id }),
        () => '已推送',
      ),
    [run],
  )

  const pull = useCallback(
    () =>
      run(
        'pull',
        (id) => window.spark.invoke('workspace:git-pull', { workspaceId: id }),
        () => '已拉取',
      ),
    [run],
  )

  const sync = useCallback(async (): Promise<boolean> => {
    if (workspaceId == null || busyRef.current != null) return false
    const id = workspaceId
    busyRef.current = 'sync'
    setBusy('sync')
    try {
      // 主进程根据当前分支是否已有 upstream 决定：新分支直接首次推送，其余先拉后推。
      const res = await window.spark.invoke('workspace:git-sync', { workspaceId: id })
      onStatusApplied(res.status)
      toast.success(res.mode === 'push' ? '已推送新分支' : '已同步（拉取 + 推送）')
      return true
    } catch (err) {
      toast.error(extractIpcErrorMessage(err, '同步失败'))
      return false
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }, [onStatusApplied, toast, workspaceId])

  return {
    busy,
    stage,
    unstage,
    commitStaged,
    stash,
    stashPop,
    stashDrop,
    discard,
    push,
    pull,
    sync,
  }
}
