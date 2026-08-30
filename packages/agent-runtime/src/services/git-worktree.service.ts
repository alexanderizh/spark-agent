import { realpath } from 'node:fs/promises'
import { getDefaultGitCommandService, type GitCommandService } from './git-command.service.js'

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
 * 所有方法以 repo 根目录为 cwd 执行 Git。统一执行器可注入以便测试。
 */
export class GitWorktreeService {
  constructor(private readonly commands: GitCommandService = getDefaultGitCommandService()) {}

  /** 解析 `git worktree list --porcelain` */
  async listWorktrees(repoRoot: string): Promise<RawWorktree[]> {
    const { stdout } = await this.commands.execute(['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
    })
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
        else if (line.startsWith('branch '))
          branch = line
            .slice('branch '.length)
            .trim()
            .replace(/^refs\/heads\//, '')
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
    const { stdout } = await this.commands.execute(
      ['branch', '--merged', baseBranch, '--format=%(refname:short)'],
      { cwd: repoRoot },
    )
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  }

  /** branch 是否已被 baseBranch 包含（已合并） */
  async isMerged(repoRoot: string, branch: string, baseBranch: string): Promise<boolean> {
    return (await this.listMergedBranches(repoRoot, baseBranch)).includes(branch)
  }

  /** 删除本地分支（-D 强制，因 worktree 已移除后分支通常未合并） */
  async deleteBranch(repoRoot: string, branch: string): Promise<void> {
    await this.commands.execute(['branch', '-D', branch], { cwd: repoRoot, operation: 'write' })
  }

  /** 本地分支是否已存在 */
  async branchExists(repoRoot: string, branch: string): Promise<boolean> {
    const result = await this.commands.execute(
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      { cwd: repoRoot, allowedExitCodes: [0, 1] },
    )
    return result.exitCode === 0
  }

  /** 推导 base 分支：优先 origin/HEAD，回退 main/master，再回退当前分支 */
  async detectBaseBranch(repoRoot: string): Promise<string> {
    const remoteHead = await this.commands.execute(
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: repoRoot, allowedExitCodes: [0, 1] },
    )
    if (remoteHead.exitCode === 0) {
      const ref = remoteHead.stdout.trim().replace(/^origin\//, '')
      if (ref !== '') return ref
    }
    for (const candidate of ['main', 'master']) {
      const result = await this.commands.execute(['rev-parse', '--verify', '--quiet', candidate], {
        cwd: repoRoot,
        allowedExitCodes: [0, 1],
      })
      if (result.exitCode === 0) return candidate
    }
    const { stdout } = await this.commands.execute(['branch', '--show-current'], { cwd: repoRoot })
    return stdout.trim() || 'main'
  }

  /** 从任意 worktree 路径推导主仓库根（绝对路径） */
  async resolveMainRepoRoot(anyPath: string): Promise<string> {
    const { stdout } = await this.commands.execute(
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
    await this.commands.execute(
      ['worktree', 'add', '-b', params.branch, params.targetPath, params.baseBranch],
      { cwd: repoRoot, operation: 'write' },
    )
  }

  async removeWorktree(
    repoRoot: string,
    targetPath: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const args = ['worktree', 'remove']
    if (opts.force === true) args.push('--force')
    args.push(targetPath)
    await this.commands.execute(args, { cwd: repoRoot, operation: 'write' })
  }
}
