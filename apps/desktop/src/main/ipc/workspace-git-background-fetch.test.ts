import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { getWorkspaceGitStatus } from './workspace-git-status.js'
import {
  fetchWorkspaceRemotes,
  scheduleWorkspaceBackgroundFetch,
} from './workspace-git-background-fetch.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd })
  return result.stdout.trim()
}

/**
 * 建一个 bare 远端 + 已建立 upstream 跟踪的主工作区。
 * behind 计数依赖本地远端跟踪引用（origin/master），只有 fetch 才会推进。
 */
async function createTrackedWorkspace(): Promise<{ workspacePath: string; remotePath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-background-fetch-'))
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
  return { workspacePath, remotePath }
}

/** 从另一个克隆向远端推一个新提交，制造「云上未同步」场景 */
async function pushRemoteCommit(root: string, remotePath: string): Promise<void> {
  const secondPath = path.join(root, 'second')
  await git(root, ['clone', remotePath, secondPath])
  await git(secondPath, ['config', 'user.name', 'Spark Test'])
  await git(secondPath, ['config', 'user.email', 'spark@example.com'])
  await fs.writeFile(path.join(secondPath, 'remote-change.txt'), 'from remote\n')
  await git(secondPath, ['add', 'remote-change.txt'])
  await git(secondPath, ['commit', '-m', 'advance remote'])
  await git(secondPath, ['push', 'origin', 'master'])
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('workspace background fetch', () => {
  it('reflects remote commits in behind after an explicit fetch', async () => {
    const { workspacePath, remotePath } = await createTrackedWorkspace()
    const root = path.dirname(remotePath)
    await pushRemoteCommit(root, remotePath)

    const before = await getWorkspaceGitStatus(workspacePath)
    expect(before.behind).toBe(0)

    expect(await fetchWorkspaceRemotes(workspacePath)).toBe(true)

    const after = await getWorkspaceGitStatus(workspacePath)
    expect(after.behind).toBe(1)
  })

  it('updates behind asynchronously via the scheduled background fetch', async () => {
    const { workspacePath, remotePath } = await createTrackedWorkspace()
    const root = path.dirname(remotePath)
    await pushRemoteCommit(root, remotePath)

    scheduleWorkspaceBackgroundFetch(workspacePath)

    // fire-and-forget：轮询等待下一次 status 轮询窗口内带出新计数
    const deadline = Date.now() + 10_000
    let behind = 0
    while (Date.now() < deadline) {
      behind = (await getWorkspaceGitStatus(workspacePath)).behind
      if (behind > 0) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    expect(behind).toBe(1)
  })

  it('is a no-op for repositories without a remote', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-no-remote-'))
    tempDirs.push(workspacePath)
    await git(workspacePath, ['init', '--initial-branch=master'])

    expect(await fetchWorkspaceRemotes(workspacePath)).toBe(false)
  })
})
