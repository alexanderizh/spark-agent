/**
 * CheckpointGitService —— 基于 git 的工作区快照（替代不安全的内容快照方案）。
 *
 * 设计见 docs/superpowers/2026-06-30-checkpoint-redesign-content-snapshot.md（git 修订），
 * Phase 0 语义/安全修复见
 * docs/spark-work开发相关/plans/2026-09-10-长程任务断点继续与执行连续性重构方案.md §12。
 * 要点：
 *   - 仅 git 仓库可用（isGitRepo）；非 git 仓库前端隐藏该功能。
 *   - 快照用「临时 index + add -A + write-tree + commit-tree」生成提交对象，**天然尊重 .gitignore**
 *     （不会记录 node_modules / 构建产物 / 忽略文件），不触碰用户的 index / HEAD / 暂存区。
 *     提交对象存到 refs/spark/checkpoints/<会话>/<id>，按会话隔离，避免被 git gc 回收。
 *   - 按 tree SHA 去重：工作区相对上个 checkpoint 无变化则不新建（gating，按 会话+工作区 隔离）。
 *   - 还原用 `git restore --source=<ref> --worktree`：**非破坏性**，只回退/重建快照内文件，
 *     不会删除快照之后新增的文件（杜绝「删库」）。
 *   - 还原前可 previewRestore 做 dry-run 分组预览；还原后校验快照内文件已与 ref tree 一致。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'
import { getDefaultGitCommandService, type GitCommandService } from './git-command.service.js'

const log = createLogger('checkpoint-git')
const MAX_BUFFER = 1 << 26 // 64MB

function sanitizeRefPart(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export interface CheckpointSnapshotResult {
  /** 是否真的新建了 checkpoint（工作区相对上个 checkpoint 有变化才建）。 */
  created: boolean
  fileCount: number
  /** 本次快照的完整受控文件清单（相对工作区根，尊重 .gitignore）。 */
  filePaths: string[]
  /** 本次快照的 tree SHA（审计与还原后校验基线）。 */
  treeSha: string
  /** 本次快照的 commit SHA（即 Spark ref 指向的对象）。 */
  commitSha: string
}

export interface CheckpointRestoreOutcome {
  /** 还原前计算的将受影响文件（回退 + 重建）。 */
  restoredFiles: string[]
  /** 还原后校验：快照内文件是否已全部与 ref tree 一致。 */
  verified: boolean
}

/** 还原 dry-run 分组预览（Phase 0 §12.2：还原前提供预览）。 */
export interface CheckpointRestorePreview {
  /** 内容与快照不同、将被覆盖回快照内容的文件。 */
  modifiedFiles: string[]
  /** 快照中存在但当前已缺失、将被重建的文件。 */
  recreatedFiles: string[]
  /** 与快照一致、不会被触碰的文件。 */
  unchangedFiles: string[]
  /** 快照之后新增、不受还原影响的文件（非破坏性语义的证据）。 */
  newFilesKept: string[]
}

export class CheckpointGitService {
  /** `sessionId\u0000workspaceRoot` → 上个 checkpoint 的 tree SHA，用于「仅变更时快照」的去重 gating。 */
  private readonly lastTree = new Map<string, string>()

  constructor(private readonly commands: GitCommandService = getDefaultGitCommandService()) {}

  private async git(workspaceRoot: string, args: string[], indexFile?: string): Promise<string> {
    const { stdout } = await this.commands.execute(args, {
      cwd: workspaceRoot,
      operation: isCheckpointWriteCommand(args) ? 'write' : 'read',
      ...(indexFile != null ? { env: { GIT_INDEX_FILE: indexFile } } : {}),
      maxBufferBytes: MAX_BUFFER,
    })
    return stdout
  }

  /** 工作区是否为 git 仓库（功能可用性判定）。 */
  async isGitRepo(workspaceRoot: string): Promise<boolean> {
    const state = await this.commands.probeRepository(workspaceRoot)
    return state.kind === 'ready' && state.repositoryKind === 'worktree'
  }

  private refName(sessionId: string, checkpointId: string): string {
    return `refs/spark/checkpoints/${sanitizeRefPart(sessionId)}/${sanitizeRefPart(checkpointId)}`
  }

  private gatingKey(sessionId: string, workspaceRoot: string): string {
    return `${sessionId}\x00${workspaceRoot}`
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
   * 返回完整文件清单与 tree/commit SHA，供事件审计、时间线展示与还原后校验使用。
   */
  async snapshot(
    workspaceRoot: string,
    sessionId: string,
    checkpointId: string,
    label: string,
  ): Promise<CheckpointSnapshotResult> {
    const tree = await this.writeWorkTree(workspaceRoot)
    const gatingKey = this.gatingKey(sessionId, workspaceRoot)
    if (this.lastTree.get(gatingKey) === tree) {
      return { created: false, fileCount: 0, filePaths: [], treeSha: tree, commitSha: '' }
    }
    const commit = (
      await this.git(workspaceRoot, [
        'commit-tree',
        tree,
        '-m',
        label.slice(0, 200) || 'spark-checkpoint',
      ])
    ).trim()
    await this.git(workspaceRoot, ['update-ref', this.refName(sessionId, checkpointId), commit])
    this.lastTree.set(gatingKey, tree)
    const filePaths = await this.listSnapshotFiles(workspaceRoot, sessionId, checkpointId)
    log.info('checkpoint snapshot', {
      sessionId,
      checkpointId,
      fileCount: filePaths.length,
      treeSha: tree,
    })
    return {
      created: true,
      fileCount: filePaths.length,
      filePaths,
      treeSha: tree,
      commitSha: commit,
    }
  }

  /** 列出快照 ref 内的完整受控文件清单（相对工作区根）。 */
  async listSnapshotFiles(
    workspaceRoot: string,
    sessionId: string,
    checkpointId: string,
  ): Promise<string[]> {
    try {
      const out = (
        await this.git(workspaceRoot, [
          'ls-tree',
          '-r',
          '--name-only',
          this.refName(sessionId, checkpointId),
        ])
      ).trim()
      return out.length > 0 ? out.split('\n') : []
    } catch {
      return [] // ref 不存在或 git 异常时按空清单处理
    }
  }

  /** ref 是否存在。 */
  async hasCheckpoint(
    workspaceRoot: string,
    sessionId: string,
    checkpointId: string,
  ): Promise<boolean> {
    try {
      await this.git(workspaceRoot, [
        'rev-parse',
        '--verify',
        `${this.refName(sessionId, checkpointId)}^{commit}`,
      ])
      return true
    } catch {
      return false
    }
  }

  /** 当前工作区与快照 ref 的差异文件（含新增/删除/修改）。git 异常时返回空（best-effort）。 */
  private async diffAgainstRef(
    workspaceRoot: string,
    sessionId: string,
    checkpointId: string,
  ): Promise<string[]> {
    const ref = this.refName(sessionId, checkpointId)
    try {
      const out = (await this.git(workspaceRoot, ['diff', '--name-only', ref, '--'])).trim()
      return out.length > 0 ? out.split('\n') : []
    } catch {
      return []
    }
  }

  /**
   * 还原 dry-run 预览：把「应用该快照会发生什么」按四组展示，不产生任何写动作。
   * 快照后新增文件归入 newFilesKept，明确还原不会删除它们。
   *
   * 分组基于「快照 tree vs 当前工作区 tree」的 tree-to-tree 对比：临时 index 的
   * `add -A` 会纳入未跟踪文件（尊重 .gitignore），因此快照后新建的未跟踪文件也能
   * 被 `git diff <commit>` 覆盖不到的这里正确识别。
   */
  async previewRestore(
    workspaceRoot: string,
    sessionId: string,
    checkpointId: string,
  ): Promise<CheckpointRestorePreview> {
    const ref = this.refName(sessionId, checkpointId)
    await this.git(workspaceRoot, ['rev-parse', '--verify', `${ref}^{commit}`]) // 不存在则抛错
    const snapTree = (await this.git(workspaceRoot, ['rev-parse', `${ref}^{tree}`])).trim()
    const workTree = await this.writeWorkTree(workspaceRoot)
    let changed: string[]
    try {
      const out = (
        await this.git(workspaceRoot, ['diff-tree', '--name-only', '-r', snapTree, workTree])
      ).trim()
      changed = out.length > 0 ? out.split('\n') : []
    } catch {
      changed = []
    }
    const snapshotFiles = await this.listSnapshotFiles(workspaceRoot, sessionId, checkpointId)
    const snapshotSet = new Set(snapshotFiles)
    const changedSet = new Set(changed)

    const modifiedFiles: string[] = []
    const recreatedFiles: string[] = []
    const newFilesKept: string[] = []
    for (const file of changed) {
      if (!snapshotSet.has(file)) {
        newFilesKept.push(file) // 快照中没有 → 快照后新增，还原不动它
      } else if (existsSync(join(workspaceRoot, file))) {
        modifiedFiles.push(file)
      } else {
        recreatedFiles.push(file)
      }
    }
    const unchangedFiles = snapshotFiles.filter((file) => !changedSet.has(file))
    return { modifiedFiles, recreatedFiles, unchangedFiles, newFilesKept }
  }

  /**
   * 还原到某个 checkpoint：`git restore --source=<ref> --worktree`，非破坏性。
   * 只回退/重建快照内文件，不删除其后新增的文件。
   * 还原后校验：快照内文件应已全部与 ref 一致，verified=false 时调用方应提示用户。
   */
  async restore(
    workspaceRoot: string,
    sessionId: string,
    checkpointId: string,
  ): Promise<CheckpointRestoreOutcome> {
    const ref = this.refName(sessionId, checkpointId)
    await this.git(workspaceRoot, ['rev-parse', '--verify', `${ref}^{commit}`]) // 不存在则抛错
    const snapshotSet = new Set(
      await this.listSnapshotFiles(workspaceRoot, sessionId, checkpointId),
    )
    const diffBefore = await this.diffAgainstRef(workspaceRoot, sessionId, checkpointId)
    const restoredFiles = diffBefore.filter((file) => snapshotSet.has(file))
    await this.git(workspaceRoot, ['restore', '--source', ref, '--worktree', '--', '.'])
    // 还原后校验：快照内文件不应再与 ref 有差异（快照外新增文件不影响判定）。
    const diffAfter = await this.diffAgainstRef(workspaceRoot, sessionId, checkpointId).catch(
      () => null,
    )
    const verified = diffAfter != null ? diffAfter.every((file) => !snapshotSet.has(file)) : false
    // 还原后工作区即为该 checkpoint 态，清掉 gating 基线避免下一轮误判。
    this.lastTree.delete(this.gatingKey(sessionId, workspaceRoot))
    log.info('checkpoint restore', {
      sessionId,
      checkpointId,
      files: restoredFiles.length,
      verified,
    })
    return { restoredFiles, verified }
  }

  /** 每会话只保留 keepIds 内的 checkpoint ref，删除其余。 */
  async prune(workspaceRoot: string, sessionId: string, keepIds: string[]): Promise<void> {
    const prefix = `refs/spark/checkpoints/${sanitizeRefPart(sessionId)}/`
    let refs: string[]
    try {
      const out = (
        await this.git(workspaceRoot, ['for-each-ref', '--format=%(refname)', prefix])
      ).trim()
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
        log.warn('checkpoint prune failed', {
          ref: r,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  /** 清掉某会话的 gating 基线（关闭开关时调用；多工作区会话全部清除）。 */
  resetGatingBaseline(sessionId: string): void {
    for (const key of this.lastTree.keys()) {
      if (key.startsWith(`${sessionId}\x00`)) this.lastTree.delete(key)
    }
  }
}

function isCheckpointWriteCommand(args: readonly string[]): boolean {
  return ['add', 'write-tree', 'commit-tree', 'update-ref', 'restore'].includes(args[0] ?? '')
}
