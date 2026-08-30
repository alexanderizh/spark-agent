import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getWorkspaceBranches,
  getWorkspaceGitFileDiff,
  getWorkspaceGitLog,
  getWorkspaceGitStatus,
  pullWorkspaceBranch,
  pushWorkspaceBranch,
  syncWorkspaceBranch,
} from './workspace-git-status.js'

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
  it('keeps an unborn repository in the ready state', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-unborn-repo-'))
    tempDirs.push(workspacePath)
    await git(workspacePath, ['init', '--initial-branch=master'])
    await fs.writeFile(path.join(workspacePath, 'draft.txt'), 'draft\n')

    const status = await getWorkspaceGitStatus(workspacePath)

    expect(status.state.kind).toBe('ready')
    expect(status.isGitRepo).toBe(true)
    expect(status.currentBranch).toBe('master')
    expect(status.changedFiles).toBe(1)
    expect(status.files).toEqual([
      expect.objectContaining({ path: 'draft.txt', untracked: true, additions: 1 }),
    ])
  })

  it('reports a bare repository as ready without workspace changes', async () => {
    const barePath = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-bare-repo-'))
    tempDirs.push(barePath)
    await git(barePath, ['init', '--bare', '--initial-branch=master'])

    const status = await getWorkspaceGitStatus(barePath)

    expect(status.state).toMatchObject({ kind: 'ready', repositoryKind: 'bare' })
    expect(status.isGitRepo).toBe(true)
    expect(status.changedFiles).toBe(0)
    expect(status.files).toEqual([])
  })

  it('lists local and remote branches with activity metadata', async () => {
    const workspacePath = await createUnpushedFeatureRepository()

    const result = await getWorkspaceBranches(workspacePath)

    expect(result.currentBranch).toBe('feature/local-review')
    expect(result.branches).toEqual(expect.arrayContaining(['feature/local-review', 'master']))
    expect(result.branchDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'feature/local-review', kind: 'local' }),
        expect.objectContaining({ name: 'origin/master', kind: 'remote' }),
      ]),
    )
    expect(result.branchDetails.every((branch) => Number.isFinite(branch.updatedAt))).toBe(true)
    expect(result.branchDetails.some((branch) => branch.name === 'origin/HEAD')).toBe(false)
  })

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

  it('returns diff for untracked new file even when untracked flag is missing', async () => {
    // 复现变更卡片未透传 changeType 的场景：前端传 untracked=false，
    // 但文件实际未跟踪。修复前 `git diff HEAD` 对未跟踪文件返回空 → 永远显示"无改动"；
    // 修复后由 ls-files 兜底判断走 --no-index，整个文件以新增呈现。
    const workspacePath = await createUnpushedFeatureRepository()
    await fs.writeFile(path.join(workspacePath, 'brand-new.txt'), 'brand new content\n')

    const fileDiff = await getWorkspaceGitFileDiff(workspacePath, 'brand-new.txt', false)

    expect(fileDiff.isBinary).toBe(false)
    expect(fileDiff.diff.trim().length).toBeGreaterThan(0)
    expect(fileDiff.diff).toContain('+brand new content')
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

describe('workspace git tags and detached HEAD', () => {
  it('lists lightweight and annotated tags alongside branches', async () => {
    const workspacePath = await createUnpushedFeatureRepository()
    await git(workspacePath, ['tag', 'v1.0.0'])
    await git(workspacePath, ['tag', '-a', 'v2.0.0', '-m', 'release two'])

    const result = await getWorkspaceBranches(workspacePath)

    const tags = result.branchDetails.filter((item) => item.kind === 'tag')
    expect(tags.map((tag) => tag.name)).toEqual(expect.arrayContaining(['v1.0.0', 'v2.0.0']))
    expect(tags.every((tag) => Number.isFinite(tag.updatedAt))).toBe(true)
    // 分支列表不受标签影响
    expect(result.branches).toEqual(expect.arrayContaining(['feature/local-review', 'master']))
    expect(result.detachedHead).toBe(false)
    expect(result.currentBranch).toBe('feature/local-review')
  })

  it('reports detached HEAD with the exact tag name instead of the first local branch', async () => {
    const workspacePath = await createUnpushedFeatureRepository()
    await git(workspacePath, ['tag', 'v1.0.0'])
    await git(workspacePath, ['checkout', 'v1.0.0'])

    const result = await getWorkspaceBranches(workspacePath)

    expect(result.detachedHead).toBe(true)
    expect(result.currentBranch).toBe('v1.0.0')
    // 回归断言：旧实现会把 branchList[0] 误当当前分支
    expect(result.branches[0]).toBeDefined()
    expect(result.currentBranch).not.toBe(result.branches[0])
    expect(result.branches).toEqual(expect.arrayContaining(['feature/local-review', 'master']))
  })

  it('falls back to the short SHA when detached at a commit without any tag', async () => {
    const workspacePath = await createUnpushedFeatureRepository()
    const shortSha = await git(workspacePath, ['rev-parse', '--short', 'HEAD'])
    await git(workspacePath, ['checkout', '--detach'])
    expect(await git(workspacePath, ['branch', '--show-current'])).toBe('')

    const result = await getWorkspaceBranches(workspacePath)

    expect(result.detachedHead).toBe(true)
    expect(result.currentBranch).toBe(shortSha)
  })

  it('surfaces detachedHead on the git status response', async () => {
    const workspacePath = await createUnpushedFeatureRepository()
    await git(workspacePath, ['tag', 'v1.0.0'])
    await git(workspacePath, ['checkout', 'v1.0.0'])

    const status = await getWorkspaceGitStatus(workspacePath)

    expect(status.detachedHead).toBe(true)
    expect(status.currentBranch).toBe('v1.0.0')
  })
})

describe('workspace Git log', () => {
  it('returns local history when the current branch has no upstream', async () => {
    const workspacePath = await createUnpushedFeatureRepository()

    const result = await getWorkspaceGitLog(workspacePath)

    expect(result.commits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: 'add local feature', unpushed: false }),
      ]),
    )
  })
})

describe('pushWorkspaceBranch', () => {
  it('publishes a new local branch to a same-named remote branch', async () => {
    const workspacePath = await createUnpushedFeatureRepository()

    await pushWorkspaceBranch(workspacePath)

    await expect(
      git(workspacePath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    ).resolves.toBe('origin/feature/local-review')
    await expect(
      git(workspacePath, ['ls-remote', '--heads', 'origin', 'feature/local-review']),
    ).resolves.toContain('refs/heads/feature/local-review')
    await expect(getWorkspaceGitStatus(workspacePath)).resolves.toMatchObject({
      remoteName: 'origin',
      remoteBranch: 'feature/local-review',
      ahead: 0,
      behind: 0,
    })
  })

  it('uses the configured push remote instead of assuming origin', async () => {
    const workspacePath = await createUnpushedFeatureRepository()
    const remotePath = path.join(path.dirname(workspacePath), 'remote.git')
    await git(workspacePath, ['remote', 'add', 'backup', remotePath])
    await git(workspacePath, ['config', 'remote.pushDefault', 'backup'])

    await pushWorkspaceBranch(workspacePath)

    await expect(
      git(workspacePath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    ).resolves.toBe('backup/feature/local-review')
    await expect(
      git(workspacePath, ['ls-remote', '--heads', 'backup', 'feature/local-review']),
    ).resolves.toContain('refs/heads/feature/local-review')
  })
})

describe('syncWorkspaceBranch', () => {
  it('pushes a new local branch directly instead of trying to pull first', async () => {
    const workspacePath = await createUnpushedFeatureRepository()

    await expect(syncWorkspaceBranch(workspacePath)).resolves.toBe('push')

    await expect(
      git(workspacePath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    ).resolves.toBe('origin/feature/local-review')
    await expect(
      git(workspacePath, ['ls-remote', '--heads', 'origin', 'feature/local-review']),
    ).resolves.toContain('refs/heads/feature/local-review')
  })

  it('keeps pull-then-push semantics for a branch that already tracks upstream', async () => {
    const workspacePath = await createUnpushedFeatureRepository()
    await git(workspacePath, ['switch', 'master'])
    await fs.writeFile(path.join(workspacePath, 'local-master.txt'), 'local master\n')
    await git(workspacePath, ['add', 'local-master.txt'])
    await git(workspacePath, ['commit', '-m', 'local master change'])

    await expect(syncWorkspaceBranch(workspacePath)).resolves.toBe('pull-push')
    await expect(
      git(workspacePath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    ).resolves.toBe('origin/master')
    await expect(
      git(workspacePath, ['ls-remote', '--heads', 'origin', 'master']),
    ).resolves.toContain('refs/heads/master')
    await expect(getWorkspaceGitStatus(workspacePath)).resolves.toMatchObject({
      remoteBranch: 'master',
      ahead: 0,
      behind: 0,
    })
  })
})

describe('pullWorkspaceBranch', () => {
  it('pulls remote updates into the local branch with default git pull semantics', async () => {
    const workspacePath = await createUnpushedFeatureRepository()
    // 回到带上游的 master 分支，再从 bare 远端克隆一个副本在远端追加提交
    await git(workspacePath, ['switch', 'master'])
    const root = path.dirname(workspacePath)
    const clonePath = path.join(root, 'peer-clone')
    await git(root, ['clone', path.join(root, 'remote.git'), clonePath])
    await git(clonePath, ['config', 'user.name', 'Spark Test'])
    await git(clonePath, ['config', 'user.email', 'spark@example.com'])
    await fs.writeFile(path.join(clonePath, 'remote-change.txt'), 'from remote\n')
    await git(clonePath, ['add', 'remote-change.txt'])
    await git(clonePath, ['commit', '-m', 'remote change'])
    await git(clonePath, ['push', 'origin', 'master'])

    // behind 基于 remote-tracking 引用：先 fetch（等价于用户刷新分支列表）才能看到落后
    await git(workspacePath, ['fetch', 'origin'])
    const before = await getWorkspaceGitStatus(workspacePath)
    expect(before.behind).toBe(1)

    await pullWorkspaceBranch(workspacePath)

    const after = await getWorkspaceGitStatus(workspacePath)
    expect(after.behind).toBe(0)
    await expect(fs.readFile(path.join(workspacePath, 'remote-change.txt'), 'utf8')).resolves.toBe(
      'from remote\n',
    )
  })

  it('rejects pulling when the current branch has no upstream', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-no-upstream-'))
    tempDirs.push(root)
    const workspacePath = path.join(root, 'workspace')
    await fs.mkdir(workspacePath)
    await git(workspacePath, ['init', '--initial-branch=master'])
    await git(workspacePath, ['config', 'user.name', 'Spark Test'])
    await git(workspacePath, ['config', 'user.email', 'spark@example.com'])
    await fs.writeFile(path.join(workspacePath, 'local.txt'), 'local\n')
    await git(workspacePath, ['add', 'local.txt'])
    await git(workspacePath, ['commit', '-m', 'local only'])

    await expect(pullWorkspaceBranch(workspacePath)).rejects.toThrow(
      '当前分支没有设置上游分支，无法拉取',
    )
  })
})
