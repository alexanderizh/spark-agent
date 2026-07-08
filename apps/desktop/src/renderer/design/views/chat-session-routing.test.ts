import { describe, expect, it } from 'vitest'

import {
  canReuseComposerSession,
  canShowComposerWorktreeToggle,
  resolveComposerGitWorkspace,
  resolveDisplayedGitBranch,
} from './chat-session-routing'

describe('chat session routing', () => {
  const workspace1 = {
    id: 'workspace-1',
    name: 'byte-builder-front',
    rootPath: '/tmp/byte-builder-front',
    projectKind: 'node',
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    worktreeMeta: null,
  }

  const workspace2 = {
    id: 'workspace-2',
    name: 'Spark-Agent',
    rootPath: '/tmp/spark-agent',
    projectKind: 'node',
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    worktreeMeta: null,
  }

  it('uses the selected project workspace for git branch state in the empty hero', () => {
    expect(
      resolveComposerGitWorkspace({
        showEmptyHero: true,
        activeWorkspace: workspace2,
        activeSessionWorkspace: workspace1,
      })?.id,
    ).toBe('workspace-2')
  })

  it('falls back to the active session workspace outside the empty hero', () => {
    expect(
      resolveComposerGitWorkspace({
        showEmptyHero: false,
        activeWorkspace: workspace2,
        activeSessionWorkspace: workspace1,
      })?.id,
    ).toBe('workspace-1')
  })

  it('does not reuse an empty session after the user switches to another project', () => {
    expect(
      canReuseComposerSession({
        sessionId: 'session-old',
        sessionWorkspaceId: 'workspace-1',
        activeWorkspaceId: 'workspace-2',
        preferSelectedWorkspace: true,
      }),
    ).toBe(false)
  })

  it('keeps reusing the current session when the selected project still matches', () => {
    expect(
      canReuseComposerSession({
        sessionId: 'session-new',
        sessionWorkspaceId: 'workspace-2',
        activeWorkspaceId: 'workspace-2',
        preferSelectedWorkspace: true,
      }),
    ).toBe(true)
  })

  it('prefers branch state for branch labels when git status lags behind', () => {
    expect(
      resolveDisplayedGitBranch({
        branchStateCurrentBranch: 'codex/worktree-fix',
        statusCurrentBranch: 'develop',
      }),
    ).toBe('codex/worktree-fix')
  })

  it('falls back to git status branch when branch state is empty', () => {
    expect(
      resolveDisplayedGitBranch({
        branchStateCurrentBranch: null,
        statusCurrentBranch: 'develop',
      }),
    ).toBe('develop')
  })

  it('keeps the worktree toggle visible for a brand-new session', () => {
    expect(
      canShowComposerWorktreeToggle({
        sessionId: 'session-new',
        sessionMessageCount: 0,
        sessionStatus: 'idle',
        loadedMessageCount: 0,
      }),
    ).toBe(true)
  })

  it('hides the worktree toggle once the conversation is running', () => {
    expect(
      canShowComposerWorktreeToggle({
        sessionId: 'session-running',
        sessionMessageCount: 0,
        sessionStatus: 'running',
        loadedMessageCount: 0,
      }),
    ).toBe(false)
  })

  it('hides the worktree toggle when messages are already loaded', () => {
    expect(
      canShowComposerWorktreeToggle({
        sessionId: 'session-started',
        sessionMessageCount: 0,
        sessionStatus: 'idle',
        loadedMessageCount: 2,
      }),
    ).toBe(false)
  })
})
