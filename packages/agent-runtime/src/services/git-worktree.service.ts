import { execFile } from 'node:child_process'
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
}
