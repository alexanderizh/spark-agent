/**
 * CheckpointGitService —— 基于 git 的代码还原点（替代不安全的内容快照方案）。
 *
 * 设计见 docs/superpowers/2026-06-30-checkpoint-redesign-content-snapshot.md（git 修订）。
 * 要点：
 *   - 仅 git 仓库可用（isGitRepo）；非 git 仓库前端隐藏该功能。
 *   - 快照用「临时 index + add -A + write-tree + commit-tree」生成提交对象，**天然尊重 .gitignore**
 *     （不会记录 node_modules / 构建产物 / 忽略文件），不触碰用户的 index / HEAD / 暂存区。
 *     提交对象存到 refs/spark/checkpoints/<会话>/<id>，按会话隔离，避免被 git gc 回收。
 *   - 按 tree SHA 去重：工作区相对上个 checkpoint 无变化则不新建（gating）。
 *   - 还原用 `git restore --source=<ref> --worktree`：**非破坏性**，只回退/重建快照内文件，
 *     不会删除快照之后新增的文件（杜绝「删库」）。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'

const log = createLogger('checkpoint-git')
const execFileAsync = promisify(execFile)
const MAX_BUFFER = 1 << 26 // 64MB

function sanitizeRefPart(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export interface CheckpointSnapshotResult {
  /** 是否真的新建了 checkpoint（工作区相对上个 checkpoint 有变化才建）。 */
  created: boolean
  fileCount: number
}

export interface CheckpointRestoreOutcome {
  restoredFiles: string[]
}

export class CheckpointGitService {
  /** sessionId → 上个 checkpoint 的 tree SHA，用于「仅变更时快照」的去重 gating。 */
  private readonly lastTree = new Map<string, string>()

  private async git(
    workspaceRoot: string,
    args: string[],
    indexFile?: string,
  ): Promise<string> {
    const env = indexFile != null ? { ...process.env, GIT_INDEX_FILE: indexFile } : process.env
    const { stdout } = await execFileAsync('git', ['-C', workspaceRoot, ...args], {
      env,
      maxBuffer: MAX_BUFFER,
    })
    return stdout
  }

  /** 工作区是否为 git 仓库（功能可用性判定）。 */
  async isGitRepo(workspaceRoot: string): Promise<boolean> {
    try {
      return (await this.git(workspaceRoot, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
    } catch {
      return false
    }
  }

  private refName(sessionId: string, checkpointId: string): string {
    return `refs/spark/checkpoints/${sanitizeRefPart(sessionId)}/${sanitizeRefPart(checkpointId)}`
  }

  /** 用临时 index 把当前工作区（尊重 .gitignore）写成一个 tree，返回 tree SHA。不触碰真 index。 */
  private async writeWorkTree(workspaceRoot: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spark-ckpt-idx-'))
    const indexFile = join(dir, 'index')
    try {
      await this.git(workspaceRoot, ['add', '-A'], indexFile)
      return (await this.git(workspaceRoot, ['write-tree'], indexFile)).trim()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /**
   * 快照当前工作区为 checkpoint。工作区相对上个 checkpoint 无变化（tree 相同）则跳过（created=false）。
   */
  async snapshot(
    workspaceRoot: string,
    sessionId: string,
    checkpointId: string,
    label: string,
  ): Promise<CheckpointSnapshotResult> {
    const tree = await this.writeWorkTree(workspaceRoot)
    if (this.lastTree.get(sessionId) === tree) return { created: false, fileCount: 0 }
    const commit = (await this.git(workspaceRoot, ['commit-tree', tree, '-m', label.slice(0, 200) || 'spark-checkpoint'])).trim()
    await this.git(workspaceRoot, ['update-ref', this.refName(sessionId, checkpointId), commit])
    this.lastTree.set(sessionId, tree)
    let fileCount = 0
    try {
      const out = (await this.git(workspaceRoot, ['ls-tree', '-r', '--name-only', commit])).trim()
      fileCount = out.length > 0 ? out.split('\n').length : 0
    } catch {
      // fileCount best-effort
    }
    log.info('checkpoint snapshot', { sessionId, checkpointId, fileCount })
    return { created: true, fileCount }
  }

  /** ref 是否存在。 */
  async hasCheckpoint(workspaceRoot: string, sessionId: string, checkpointId: string): Promise<boolean> {
    try {
      await this.git(workspaceRoot, ['rev-parse', '--verify', `${this.refName(sessionId, checkpointId)}^{commit}`])
      return true
    } catch {
      return false
    }
  }

  /**
   * 还原到某个 checkpoint：`git restore --source=<ref> --worktree`，非破坏性。
   * 只回退/重建快照内文件，不删除其后新增的文件。
   */
  async restore(workspaceRoot: string, sessionId: string, checkpointId: string): Promise<CheckpointRestoreOutcome> {
    const ref = this.refName(sessionId, checkpointId)
    await this.git(workspaceRoot, ['rev-parse', '--verify', `${ref}^{commit}`]) // 不存在则抛错
    let restoredFiles: string[] = []
    try {
      const out = (await this.git(workspaceRoot, ['diff', '--name-only', ref, '--'])).trim()
      restoredFiles = out.length > 0 ? out.split('\n') : []
    } catch {
      // 列表 best-effort
    }
    await this.git(workspaceRoot, ['restore', '--source', ref, '--worktree', '--', '.'])
    // 还原后工作区即为该 checkpoint 态，清掉 gating 基线避免下一轮误判。
    this.lastTree.delete(sessionId)
    log.info('checkpoint restore', { sessionId, checkpointId, files: restoredFiles.length })
    return { restoredFiles }
  }

  /** 每会话只保留 keepIds 内的 checkpoint ref，删除其余。 */
  async prune(workspaceRoot: string, sessionId: string, keepIds: string[]): Promise<void> {
    const prefix = `refs/spark/checkpoints/${sanitizeRefPart(sessionId)}/`
    let refs: string[]
    try {
      const out = (await this.git(workspaceRoot, ['for-each-ref', '--format=%(refname)', prefix])).trim()
      refs = out.length > 0 ? out.split('\n') : []
    } catch {
      return
    }
    const keep = new Set(keepIds.map((id) => prefix + sanitizeRefPart(id)))
    for (const r of refs) {
      if (keep.has(r)) continue
      try {
        await this.git(workspaceRoot, ['update-ref', '-d', r])
      } catch (err) {
        log.warn('checkpoint prune failed', { ref: r, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  /** 清掉某会话的 gating 基线（关闭开关时调用）。 */
  resetGatingBaseline(sessionId: string): void {
    this.lastTree.delete(sessionId)
  }
}
