import { describe, expect, it } from 'vitest'
import type { BranchState } from './ChatComposerTypes'
import { mergeWorkspaceBranchSnapshot } from './useWorkspaceBranchState'

const trusted: BranchState = {
  gitState: {
    kind: 'ready',
    repositoryKind: 'worktree',
    runtimeSource: 'system',
    runtimeVersion: '2.45.4',
  },
  currentBranch: 'feature/one',
  branches: ['feature/one'],
}

const unavailable: BranchState = {
  gitState: {
    kind: 'runtime_unavailable',
    code: 'GIT_RUNTIME_UNAVAILABLE',
    message: 'Git runtime unavailable',
  },
  currentBranch: null,
  branches: [],
}

describe('mergeWorkspaceBranchSnapshot', () => {
  it('preserves a trusted branch for a transient error in the same workspace', () => {
    const result = mergeWorkspaceBranchSnapshot(
      { workspaceId: 'workspace-1', state: trusted },
      'workspace-1',
      unavailable,
    )
    expect(result.state.currentBranch).toBe('feature/one')
    expect(result.state.gitState?.kind).toBe('runtime_unavailable')
  })

  it('does not carry a trusted branch into another workspace', () => {
    const result = mergeWorkspaceBranchSnapshot(
      { workspaceId: 'workspace-1', state: trusted },
      'workspace-2',
      unavailable,
    )
    expect(result.state.currentBranch).toBeNull()
    expect(result.state.gitState?.kind).toBe('runtime_unavailable')
  })

  it('clears the trusted branch for an explicit non-repository result', () => {
    const result = mergeWorkspaceBranchSnapshot(
      { workspaceId: 'workspace-1', state: trusted },
      'workspace-1',
      {
        gitState: { kind: 'not_repository' },
        currentBranch: null,
        branches: [],
      },
    )
    expect(result.state).toEqual({
      gitState: { kind: 'not_repository' },
      currentBranch: null,
      branches: [],
    })
  })
})
