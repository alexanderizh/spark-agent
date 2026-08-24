import { isGitCommandError } from '@spark/agent-runtime'
import type { WorkspaceGitState } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { getGitExecErrorMessage } from './workspace-git-status.js'

export function asSparkGitError(error: unknown, fallback: string): SparkError {
  if (error instanceof SparkError) return error
  const code = isGitCommandError(error) ? error.code : 'GIT_OPERATION_FAILED'
  return new SparkError(code, getGitExecErrorMessage(error, fallback))
}

export function assertWorkspaceGitReady(
  state: WorkspaceGitState,
): asserts state is Extract<WorkspaceGitState, { kind: 'ready' }> {
  if (state.kind === 'ready') return
  if (state.kind === 'runtime_unavailable' || state.kind === 'failed') {
    throw new SparkError(state.code, state.message)
  }
  throw new SparkError('GIT_OPERATION_FAILED', '当前项目不是 Git 仓库')
}

export function assertWorkspaceGitWorktree(state: WorkspaceGitState): asserts state is Extract<
  WorkspaceGitState,
  { kind: 'ready' }
> & {
  repositoryKind: 'worktree'
} {
  assertWorkspaceGitReady(state)
  if (state.repositoryKind !== 'worktree') {
    throw new SparkError('GIT_OPERATION_FAILED', '裸仓库没有工作区，无法执行此操作')
  }
}
