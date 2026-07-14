import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { getWorkspaceGitFileDiff, getWorkspaceGitStatus } from './workspace-git-status.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd })
  return result.stdout.trim()
}

async function createUnpushedFeatureRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-local-branch-'))
  tempDirs.push(root)
  const remotePath = path.join(root, 'remote.git')
  const workspacePath = path.join(root, 'workspace')

  await git(root, ['init', '--bare', '--initial-branch=master', remotePath])
  await fs.mkdir(workspacePath)
  await git(workspacePath, ['init', '--initial-branch=master'])
  await git(workspacePath, ['config', 'user.name', 'Spark Test'])
  await git(workspacePath, ['config', 'user.email', 'spark@example.com'])
  await git(workspacePath, ['config', 'core.autocrlf', 'false'])
  await fs.writeFile(path.join(workspacePath, 'base.txt'), 'base\n')
  await git(workspacePath, ['add', 'base.txt'])
  await git(workspacePath, ['commit', '-m', 'base'])
  await git(workspacePath, ['remote', 'add', 'origin', remotePath])
  await git(workspacePath, ['push', '-u', 'origin', 'master'])
  await git(workspacePath, ['remote', 'set-head', 'origin', 'master'])

  await git(workspacePath, ['switch', '-c', 'feature/local-review'])
  await fs.writeFile(path.join(workspacePath, 'feature.txt'), 'local feature\n')
  await git(workspacePath, ['add', 'feature.txt'])
  await git(workspacePath, ['commit', '-m', 'add local feature'])
  return workspacePath
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('workspace Git status for an unpushed local branch', () => {
  it('compares committed changes against the remote default branch', async () => {
    const workspacePath = await createUnpushedFeatureRepository()

    const status = await getWorkspaceGitStatus(workspacePath)

    expect(status.currentBranch).toBe('feature/local-review')
    expect(status.remoteName).toBe('origin')
    expect(status.remoteBranch).toBe('master')
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(0)
    expect(status.changedFiles).toBe(0)
    expect(status.stagedFiles).toBe(0)
    expect(status.unstagedFiles).toBe(0)
    expect(status.additions).toBe(1)
    expect(status.deletions).toBe(0)
    expect(status.files).toEqual([
      expect.objectContaining({
        path: 'feature.txt',
        status: 'A',
        staged: false,
        unstaged: false,
        untracked: false,
        additions: 1,
        deletions: 0,
      }),
    ])

    const fileDiff = await getWorkspaceGitFileDiff(workspacePath, 'feature.txt', false)
    expect(fileDiff.isBinary).toBe(false)
    expect(fileDiff.diff).toContain('+local feature')
  })

  it('keeps pending counts separate while reviewing committed and working changes together', async () => {
    const workspacePath = await createUnpushedFeatureRepository()
    await fs.writeFile(path.join(workspacePath, 'base.txt'), 'base changed\n')
    await fs.writeFile(path.join(workspacePath, 'draft.txt'), 'draft\n')

    const status = await getWorkspaceGitStatus(workspacePath)

    expect(status.changedFiles).toBe(2)
    expect(status.stagedFiles).toBe(0)
    expect(status.unstagedFiles).toBe(2)
    expect(status.untrackedFiles).toBe(1)
    expect(status.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'feature.txt', staged: false, unstaged: false }),
        expect.objectContaining({ path: 'base.txt', staged: false, unstaged: true }),
        expect.objectContaining({ path: 'draft.txt', untracked: true, additions: 1 }),
      ]),
    )
  })
})
