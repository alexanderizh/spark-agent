import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 单个 worktree 的原始信息（来自 git worktree list --porcelain） */
export interface RawWorktree {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  isDetached: boolean
  isLocked: boolean
}

export interface AddWorktreeParams {
  branch: string
  targetPath: string
  baseBranch: string
}

/**
 * Git worktree 命令封装。
 * 所有方法以 repo 根目录为 cwd 执行 git。execFile 可注入以便测试。
 */
export class GitWorktreeService {
  constructor(private readonly exec: typeof execFileAsync = execFileAsync) {}

  /** 解析 `git worktree list --porcelain` */
  async listWorktrees(repoRoot: string): Promise<RawWorktree[]> {
    const { stdout } = await this.exec('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot })
    const blocks = stdout.split(/\r?\n\r?\n/).filter((b) => b.trim() !== '')
    const result: RawWorktree[] = []
    for (const [index, block] of blocks.entries()) {
      const lines = block.split(/\r?\n/)
      let wtPath = ''
      let head = ''
      let branch: string | null = null
      let isDetached = false
      let isLocked = false
      for (const line of lines) {
        if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length).trim()
        else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim().slice(0, 7)
        else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
        else if (line.trim() === 'detached') isDetached = true
        else if (line.startsWith('locked')) isLocked = true
      }
      if (wtPath === '') continue
      result.push({ path: wtPath, branch, head, isMain: index === 0, isDetached, isLocked })
    }
    return result
  }

  /** 列出所有已合并进 baseBranch 的本地分支（一次性查询，避免逐分支 spawn） */
  async listMergedBranches(repoRoot: string, baseBranch: string): Promise<string[]> {
    try {
      const { stdout } = await this.exec('git', ['branch', '--merged', baseBranch, '--format=%(refname:short)'], { cwd: repoRoot })
      return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  /** branch 是否已被 baseBranch 包含（已合并） */
  async isMerged(repoRoot: string, branch: string, baseBranch: string): Promise<boolean> {
    return (await this.listMergedBranches(repoRoot, baseBranch)).includes(branch)
  }

  /** 删除本地分支（-D 强制，因 worktree 已移除后分支通常未合并） */
  async deleteBranch(repoRoot: string, branch: string): Promise<void> {
    await this.exec('git', ['branch', '-D', branch], { cwd: repoRoot })
  }

  /** 本地分支是否已存在 */
  async branchExists(repoRoot: string, branch: string): Promise<boolean> {
    try {
      await this.exec('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoRoot })
      return true
    } catch {
      return false
    }
  }

  /** 推导 base 分支：优先 origin/HEAD，回退 main/master，再回退当前分支 */
  async detectBaseBranch(repoRoot: string): Promise<string> {
    try {
      const { stdout } = await this.exec('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repoRoot })
      const ref = stdout.trim().replace(/^origin\//, '')
      if (ref !== '') return ref
    } catch { /* no remote HEAD */ }
    for (const candidate of ['main', 'master']) {
      try {
        await this.exec('git', ['rev-parse', '--verify', candidate], { cwd: repoRoot })
        return candidate
      } catch { /* not present */ }
    }
    const { stdout } = await this.exec('git', ['branch', '--show-current'], { cwd: repoRoot })
    return stdout.trim() || 'main'
  }

  /** 从任意 worktree 路径推导主仓库根（绝对路径） */
  async resolveMainRepoRoot(anyPath: string): Promise<string> {
    const { stdout } = await this.exec(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: anyPath },
    )
    const gitCommonDir = stdout.trim()
    // 去掉尾部 /.git 得到主工作树根
    const mainRoot = gitCommonDir.replace(/[/\\]\.git[/\\]?$/, '')
    // macOS 上 /tmp 是 /private/tmp 软链，归一化以保证可比较
    try {
      return await realpath(mainRoot)
    } catch {
      return mainRoot
    }
  }

  async addWorktree(repoRoot: string, params: AddWorktreeParams): Promise<void> {
    await this.exec(
      'git',
      ['worktree', 'add', '-b', params.branch, params.targetPath, params.baseBranch],
      { cwd: repoRoot },
    )
  }

  async removeWorktree(repoRoot: string, targetPath: string, opts: { force?: boolean } = {}): Promise<void> {
    const args = ['worktree', 'remove']
    if (opts.force === true) args.push('--force')
    args.push(targetPath)
    await this.exec('git', args, { cwd: repoRoot })
  }
}
