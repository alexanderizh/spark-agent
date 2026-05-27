import { randomUUID } from 'crypto'
import type { PermissionProfileRepository, PermissionProfileRow, PermissionRuleRow } from '@spark/storage'
import type { PermissionProfileItem, PermissionRuleItem, PermissionMode, PermissionApprovalRequest, PermissionApprovalDecision } from '@spark/protocol'

const BUILTIN_PROFILES = [
  { id: 'strict', name: 'strict', sandboxLevel: 0 },
  { id: 'project-standard', name: 'project-standard', sandboxLevel: 2 },
  { id: 'trusted', name: 'trusted', sandboxLevel: 3 },
]

const DEFAULT_RULES: Array<{ action: string; scope: string; mode: PermissionMode; sortOrder: number }> = [
  { action: 'file_read', scope: 'workspace', mode: 'allow', sortOrder: 0 },
  { action: 'file_write', scope: 'workspace', mode: 'allow', sortOrder: 1 },
  { action: 'file_read', scope: 'any', mode: 'ask', sortOrder: 2 },
  { action: 'command_exec', scope: 'session', mode: 'ask', sortOrder: 3 },
  { action: 'command_dangerous', scope: 'any', mode: 'ask-twice', sortOrder: 4 },
  { action: 'git_push', scope: 'any', mode: 'ask', sortOrder: 5 },
  { action: 'network_known', scope: 'whitelist', mode: 'allow', sortOrder: 6 },
  { action: 'network_unknown', scope: 'any', mode: 'ask', sortOrder: 7 },
  { action: 'mcp_tool', scope: 'server', mode: 'allow', sortOrder: 8 },
  { action: 'secret_read', scope: 'profile', mode: 'ask', sortOrder: 9 },
  { action: 'long_task', scope: 'session', mode: 'allow', sortOrder: 10 },
]

const ACTIVE_PROFILE_KEY = 'permission:active-profile'

// Maps built-in tool names to permission action keys
const TOOL_ACTION_MAP: Record<string, string> = {
  write_file: 'file_write',
  edit_file: 'file_write',
  apply_patch: 'file_write',
  read_file: 'file_read',
  list_directory: 'file_read',
  search_files: 'file_read',
  grep_files: 'file_read',
  run_command: 'command_exec',
}

// Risk level per action
const RISK_LEVEL_MAP: Record<string, 'low' | 'medium' | 'high'> = {
  file_read: 'low',
  file_write: 'medium',
  command_exec: 'high',
  command_dangerous: 'high',
  git_push: 'high',
  network_unknown: 'medium',
  mcp_tool: 'medium',
  secret_read: 'high',
}

export class PermissionService {
  constructor(private readonly repo: PermissionProfileRepository) {
    this.repo.ensureSchema()
    this.seedBuiltins()
  }

  private seedBuiltins(): void {
    if (this.repo.hasProfiles()) return
    for (const p of BUILTIN_PROFILES) {
      this.repo.createProfile({ ...p, isBuiltin: true })
      for (const r of DEFAULT_RULES) {
        this.repo.upsertRule({ id: randomUUID(), profileId: p.id, ...r })
      }
    }
  }

  listProfiles(): { profiles: PermissionProfileItem[]; activeProfileId: string } {
    const rows = this.repo.listProfiles()
    const profiles = rows.map((r) => this.toProfileItem(r))
    const activeProfileId = this.getActiveProfileId()
    return { profiles, activeProfileId }
  }

  createProfile(params: { name: string; sandboxLevel?: number }): PermissionProfileItem {
    const id = randomUUID()
    const row = this.repo.createProfile({ id, name: params.name, sandboxLevel: params.sandboxLevel ?? 2 })
    // seed default rules for new profile
    for (const r of DEFAULT_RULES) {
      this.repo.upsertRule({ id: randomUUID(), profileId: id, ...r })
    }
    return this.toProfileItem(row)
  }

  deleteProfile(id: string): boolean {
    const row = this.repo.getProfile(id)
    if (row?.is_builtin) throw new Error('Cannot delete builtin profile')
    return this.repo.deleteProfile(id)
  }

  updateSandbox(profileId: string, sandboxLevel: number): PermissionProfileItem {
    const row = this.repo.updateProfile(profileId, { sandboxLevel })
    if (!row) throw new Error(`Profile not found: ${profileId}`)
    return this.toProfileItem(row)
  }

  updateRule(profileId: string, action: string, mode: PermissionMode): PermissionRuleItem {
    const rules = this.repo.listRules(profileId)
    const existing = rules.find((r) => r.action === action)
    if (existing) {
      this.repo.updateRuleMode(existing.id, mode)
      return this.toRuleItem({ ...existing, mode })
    }
    const row = this.repo.upsertRule({ id: randomUUID(), profileId, action, scope: 'any', mode, sortOrder: 99 })
    return this.toRuleItem(row)
  }

  getActiveProfileId(): string {
    // Simple in-memory fallback; could persist to a config table later
    return PermissionService._activeProfileId ?? 'project-standard'
  }

  setActiveProfileId(id: string): void {
    PermissionService._activeProfileId = id
  }

  private static _activeProfileId: string | null = null

  // ─── Tool Approval Flow ───────────────────────────────────────────────────

  /**
   * 工具执行前的审批检查。
   * 如果当前 profile 对该工具的 action 设置为 'ask'，则通过 pushFn 推送审批请求，
   * 并等待用户响应（Promise 由 resolveApproval 解决）。
   * 返回 true 表示允许执行，false 表示拒绝。
   */
  async requestApproval(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    pushFn: (req: PermissionApprovalRequest) => void,
  ): Promise<boolean> {
    const action = TOOL_ACTION_MAP[toolName] ?? 'file_read'
    const profileId = this.getActiveProfileId()
    const rules = this.repo.listRules(profileId)
    const rule = rules.find((r) => r.action === action)
    const mode = (rule?.mode ?? 'allow') as PermissionMode

    if (mode === 'allow') return true
    if (mode === 'deny') return false

    // mode === 'ask' or 'ask-twice': push to renderer and wait
    const requestId = randomUUID()
    const riskLevel = RISK_LEVEL_MAP[action] ?? 'low'

    const result = await new Promise<PermissionApprovalDecision>((resolve) => {
      PermissionService._pendingApprovals.set(requestId, resolve)
      pushFn({ requestId, sessionId, toolName, toolInput, riskLevel })
    })

    if (result === 'allow-session') {
      // Temporarily allow for this session by upgrading the rule
      this.repo.updateRuleMode(rules.find((r) => r.action === action)?.id ?? '', 'allow')
    }

    return result !== 'deny'
  }

  resolveApproval(requestId: string, decision: PermissionApprovalDecision): boolean {
    const resolve = PermissionService._pendingApprovals.get(requestId)
    if (!resolve) return false
    PermissionService._pendingApprovals.delete(requestId)
    resolve(decision)
    return true
  }

  private static _pendingApprovals = new Map<string, (d: PermissionApprovalDecision) => void>()

  private toProfileItem(row: PermissionProfileRow): PermissionProfileItem {
    const rules = this.repo.listRules(row.id).map((r) => this.toRuleItem(r))
    return {
      id: row.id,
      name: row.name,
      sandboxLevel: row.sandbox_level,
      isBuiltin: row.is_builtin === 1,
      rules,
    }
  }

  private toRuleItem(row: PermissionRuleRow): PermissionRuleItem {
    return {
      id: row.id,
      profileId: row.profile_id,
      action: row.action,
      scope: row.scope,
      mode: row.mode as PermissionMode,
      sortOrder: row.sort_order,
    }
  }
}
