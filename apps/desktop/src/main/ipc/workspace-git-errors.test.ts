import { GitCommandError } from '@spark/agent-runtime'
import type { WorkspaceGitState } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { describe, expect, it } from 'vitest'
import {
  asSparkGitError,
  assertWorkspaceGitReady,
  assertWorkspaceGitWorktree,
} from './workspace-git-errors.js'

const readyWorktree: WorkspaceGitState = {
  kind: 'ready',
  repositoryKind: 'worktree',
  runtimeSource: 'system',
  runtimeVersion: '2.45.4',
}

describe('workspace Git IPC guards', () => {
  it('preserves an existing SparkError at the IPC boundary', () => {
    const existing = new SparkError('GIT_OPERATION_FAILED', 'precise failure')
    expect(asSparkGitError(existing, 'fallback')).toBe(existing)
  })

  it('preserves a Git command error code while sanitizing its message', () => {
    const error = new GitCommandError('AUTH_REQUIRED', 'authentication failed', {
      exitCode: 128,
      stderr: 'fatal: could not read Username',
      stdout: '',
    })
    expect(asSparkGitError(error, 'fallback')).toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'Git 需要认证或交互式凭据，请在内置终端中完成认证后重试。',
    })
  })

  it('passes a ready worktree and rejects an explicit non-repository state', () => {
    expect(() => assertWorkspaceGitReady(readyWorktree)).not.toThrow()
    expect(() => assertWorkspaceGitReady({ kind: 'not_repository' })).toThrowError(
      expect.objectContaining({ code: 'GIT_OPERATION_FAILED', message: '当前项目不是 Git 仓库' }),
    )
  })

  it('preserves runtime failure details from repository probes', () => {
    expect(() =>
      assertWorkspaceGitReady({
        kind: 'runtime_unavailable',
        code: 'GIT_RUNTIME_UNAVAILABLE',
        message: 'runtime missing',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'GIT_RUNTIME_UNAVAILABLE', message: 'runtime missing' }),
    )
  })

  it('allows worktree writes but rejects writes against a bare repository', () => {
    expect(() => assertWorkspaceGitWorktree(readyWorktree)).not.toThrow()
    expect(() =>
      assertWorkspaceGitWorktree({
        kind: 'ready',
        repositoryKind: 'bare',
        runtimeSource: 'bundled',
        runtimeVersion: '2.45.4',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'GIT_OPERATION_FAILED',
        message: '裸仓库没有工作区，无法执行此操作',
      }),
    )
  })
})
