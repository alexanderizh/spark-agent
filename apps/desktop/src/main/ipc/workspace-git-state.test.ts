import { beforeEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'

const gitCommands = vi.hoisted(() => ({
  probeRepository: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('../services/GitRuntimeService.js', () => ({
  getGitCommandService: () => gitCommands,
}))

import {
  getGitExecErrorMessage,
  getWorkspaceBranches,
  getWorkspaceGitStatus,
  tryGitStdout,
} from './workspace-git-status.js'

describe('workspace Git availability states', () => {
  beforeEach(() => {
    gitCommands.probeRepository.mockReset()
    gitCommands.execute.mockReset()
  })

  it('maps only an explicit non-repository probe to isGitRepo=false', async () => {
    gitCommands.probeRepository.mockResolvedValue({ kind: 'not_repository' })
    await expect(getWorkspaceGitStatus('/workspace')).resolves.toMatchObject({
      state: { kind: 'not_repository' },
      isGitRepo: false,
    })
    expect(gitCommands.execute).not.toHaveBeenCalled()
  })

  it('keeps runtime failures distinct from non-repositories', async () => {
    gitCommands.probeRepository.mockResolvedValue({
      kind: 'runtime_unavailable',
      code: 'GIT_RUNTIME_UNAVAILABLE',
      message: 'Git runtime unavailable',
    })
    await expect(getWorkspaceGitStatus('/workspace')).resolves.toMatchObject({
      state: { kind: 'runtime_unavailable', code: 'GIT_RUNTIME_UNAVAILABLE' },
      isGitRepo: null,
    })
  })

  it('returns the same availability state for branch queries', async () => {
    gitCommands.probeRepository.mockResolvedValue({
      kind: 'failed',
      code: 'GIT_OPERATION_FAILED',
      message: 'dubious ownership',
    })
    await expect(getWorkspaceBranches('/workspace')).resolves.toEqual({
      state: {
        kind: 'failed',
        code: 'GIT_OPERATION_FAILED',
        message: 'dubious ownership',
      },
      currentBranch: null,
      branches: [],
      branchDetails: [],
    })
  })

  it('allows only successful exit codes unless a command opts into another code', async () => {
    gitCommands.execute.mockResolvedValue({
      stdout: '',
      stderr: 'fatal',
      exitCode: 128,
    })
    await expect(tryGitStdout('/workspace', ['remote'])).resolves.toBeNull()
    expect(gitCommands.execute).toHaveBeenCalledWith(['remote'], {
      cwd: '/workspace',
      allowedExitCodes: [0],
    })
  })

  it('redacts credentials from generic error messages before showing them', () => {
    const message = getGitExecErrorMessage(
      new Error(
        `failed in ${homedir()}/repo while fetching https://user:secret@example.com/repo.git?token=abc123`,
      ),
      'Git failed',
    )
    expect(message).not.toContain(homedir())
    expect(message).not.toContain('user:secret')
    expect(message).not.toContain('abc123')
    expect(message).toContain('https://***@example.com')
  })
})
