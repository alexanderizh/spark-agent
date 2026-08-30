/**
 * 会话引擎级 worktree 状态（路径②③）。
 *
 * 三条 worktree 路径中，应用自建 worktree（Composer 开关 / WorktreePanel，路径①）会
 * 为会话换绑 worktree workspace，分支信息来自 workspace.worktreeMeta。而 agent 在
 * 会话内自行进入/创建的 worktree —— Claude 的 EnterWorktree 工具（路径②）、agent 手动
 * `git worktree add`（路径③，Codex 常见）—— 不改变会话 workspace，应用默认完全无感知。
 *
 * 本模块为路径②③补齐感知：状态由 agent 通过 spark_session.set_worktree_state 工具
 * 主动上报（主路径），或运行时事件检测推断（兜底）。持久化到 sessions.metadata_json
 * 的 runtimeWorktree 键，与 debugMode / team 同策略，不新增列。
 */
import { realpath } from 'node:fs/promises'
import { SessionRepository, type SparkDatabase } from '@spark/storage'
import { GitWorktreeService, type RawWorktree } from './git-worktree.service.js'

/** 与 protocol SessionRuntimeWorktree 同构的持久化结构 */
export interface SessionRuntimeWorktreeState {
  path: string
  branch: string
  updatedAt: string
}

/** spark_session.set_worktree_state 工具入参 */
export interface SessionWorktreeStateInput {
  action: 'enter' | 'exit'
  /** action=enter 时必填：worktree 目录绝对路径 */
  path?: string
  /** 可选：分支名。缺省时由 git 解析；detached HEAD 时回落为空串 */
  branch?: string
}

export interface SessionWorktreeStateApplyResult {
  ok: boolean
  /** ok=true 时的最新状态；exit 后为 null */
  worktree: SessionRuntimeWorktreeState | null
  /** ok=false 时的原因（面向 agent 的可读文本） */
  error?: string
  /** 状态是否发生变化（未变化时不触发通知） */
  changed: boolean
}

/** 对未知对象做 runtimeWorktree 形状校验；非法返回 null */
function coerceRuntimeWorktree(wt: unknown): SessionRuntimeWorktreeState | null {
  if (wt == null || typeof wt !== 'object') return null
  const w = wt as Partial<SessionRuntimeWorktreeState>
  if (typeof w.path !== 'string' || w.path === '') return null
  return {
    path: w.path,
    branch: typeof w.branch === 'string' ? w.branch : '',
    updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : '',
  }
}

/** 从 metadata_json 字符串解析 runtimeWorktree；非法/缺失返回 null */
export function readSessionRuntimeWorktree(
  metadataJson: string | null | undefined,
): SessionRuntimeWorktreeState | null {
  if (metadataJson == null || metadataJson === '') return null
  try {
    return coerceRuntimeWorktree(
      (JSON.parse(metadataJson) as { runtimeWorktree?: unknown }).runtimeWorktree,
    )
  } catch {
    return null
  }
}

/**
 * 会话 worktree 状态读写 + git 校验。
 * GitWorktreeService 可注入以便测试。
 */
export class SessionWorktreeStateService {
  private readonly git: GitWorktreeService

  constructor(
    private readonly db: SparkDatabase,
    git: GitWorktreeService = new GitWorktreeService(),
  ) {
    this.git = git
  }

  /** 读取会话当前 runtimeWorktree 状态 */
  get(sessionId: string): SessionRuntimeWorktreeState | null {
    const metadata = new SessionRepository(this.db).getMetadata(sessionId)
    return coerceRuntimeWorktree(metadata.runtimeWorktree)
  }

  /**
   * 应用状态变更（enter/exit），并做 git 真实性校验：
   *  - enter：路径需存在且是当前仓库的 linked worktree（`git worktree list` 能找到），
   *    分支以 git 解析结果为准（agent 提供的 branch 仅作 detached 时的补充展示）。
   *  - exit：清空状态；本来就没有状态时是 no-op。
   */
  async apply(
    sessionId: string,
    input: SessionWorktreeStateInput,
  ): Promise<SessionWorktreeStateApplyResult> {
    const sessionRepo = new SessionRepository(this.db)
    const current = this.get(sessionId)

    if (input.action === 'exit') {
      if (current == null) {
        return { ok: true, worktree: null, changed: false }
      }
      sessionRepo.patchMetadata(sessionId, { runtimeWorktree: null })
      return { ok: true, worktree: null, changed: true }
    }

    // action === 'enter'
    const rawPath = typeof input.path === 'string' ? input.path.trim() : ''
    if (rawPath === '') {
      return { ok: false, worktree: current, changed: false, error: 'path is required' }
    }

    let normalizedPath: string
    try {
      normalizedPath = await realpath(rawPath)
    } catch {
      return {
        ok: false,
        worktree: current,
        changed: false,
        error: `path does not exist: ${rawPath}`,
      }
    }

    let branch: string
    try {
      // 从 worktree 路径反推主仓库根，再校验该路径确为 linked worktree 并取其分支
      const mainRoot = await this.git.resolveMainRepoRoot(normalizedPath)
      const worktrees = await this.git.listWorktrees(mainRoot)
      const entry = await findWorktreeByPath(worktrees, normalizedPath)
      if (entry == null || entry.isMain) {
        return {
          ok: false,
          worktree: current,
          changed: false,
          error: `not a git worktree (or the main checkout itself): ${normalizedPath}`,
        }
      }
      branch = entry.branch ?? (typeof input.branch === 'string' ? input.branch.trim() : '')
    } catch (err) {
      return {
        ok: false,
        worktree: current,
        changed: false,
        error: `git validation failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    if (current != null && samePath(current.path, normalizedPath) && current.branch === branch) {
      return { ok: true, worktree: current, changed: false }
    }

    const next: SessionRuntimeWorktreeState = {
      path: normalizedPath,
      branch,
      updatedAt: new Date().toISOString(),
    }
    sessionRepo.patchMetadata(sessionId, { runtimeWorktree: next })
    return { ok: true, worktree: next, changed: true }
  }
}

/** 路径比较（Windows 大小写不敏感 + 分隔符归一） */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
  return norm(a) === norm(b)
}

/**
 * 在 worktree 列表中按路径定位条目；先做字符串归一比较，失败后两侧 realpath 兜底
 * （porcelain 输出与 agent 提供的路径可能一真一软链，macOS /tmp、Windows 盘符大小写）。
 */
async function findWorktreeByPath(
  worktrees: RawWorktree[],
  targetPath: string,
): Promise<RawWorktree | null> {
  for (const wt of worktrees) {
    if (samePath(wt.path, targetPath)) return wt
  }
  try {
    const targetReal = await realpath(targetPath)
    for (const wt of worktrees) {
      try {
        if (samePath(await realpath(wt.path), targetReal)) return wt
      } catch {
        // 单个 worktree 路径失效（已删除）时跳过
      }
    }
  } catch {
    // target realpath 失败按未命中处理
  }
  return null
}
