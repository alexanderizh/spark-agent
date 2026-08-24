import { useCallback, useState } from 'react'
import type { BranchState } from './ChatComposerTypes'

export interface WorkspaceBranchSnapshot {
  workspaceId: string | null
  state: BranchState
}

const EMPTY_BRANCH_STATE: BranchState = { currentBranch: null, branches: [] }

export function mergeWorkspaceBranchSnapshot(
  previous: WorkspaceBranchSnapshot,
  workspaceId: string | null,
  next: BranchState,
): WorkspaceBranchSnapshot {
  const previousState = previous.workspaceId === workspaceId ? previous.state : EMPTY_BRANCH_STATE
  const gitState = next.gitState
  if (gitState?.kind === 'runtime_unavailable' || gitState?.kind === 'failed') {
    return {
      workspaceId,
      state: { ...previousState, gitState },
    }
  }
  return { workspaceId, state: next }
}

export function useWorkspaceBranchState(workspaceId: string | null): {
  branchState: BranchState
  applyBranchState: (next: BranchState) => void
} {
  const [snapshot, setSnapshot] = useState<WorkspaceBranchSnapshot>({
    workspaceId: null,
    state: EMPTY_BRANCH_STATE,
  })
  const branchState = snapshot.workspaceId === workspaceId ? snapshot.state : EMPTY_BRANCH_STATE
  const applyBranchState = useCallback(
    (next: BranchState) => {
      setSnapshot((previous) => mergeWorkspaceBranchSnapshot(previous, workspaceId, next))
    },
    [workspaceId],
  )
  return { branchState, applyBranchState }
}
