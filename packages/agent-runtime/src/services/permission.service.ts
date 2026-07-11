import { randomUUID } from 'crypto'
import type {
  PermissionDecisionRow,
  PermissionProfileRepository,
  PermissionProfileRow,
  PermissionRuleRow,
} from '@spark/storage'
import type {
  PermissionProfileItem,
  PermissionRuleItem,
  PermissionMode,
  PermissionApprovalRequest,
  PermissionApprovalDecision,
  PermissionDecisionScope,
} from '@spark/protocol'

const BUILTIN_PROFILES = [
  { id: 'strict', name: 'strict', sandboxLevel: 0 },
  { id: 'project-standard', name: 'project-standard', sandboxLevel: 2 },
  { id: 'trusted', name: 'trusted', sandboxLevel: 3 },
]

const DEFAULT_RULES: Array<{
  action: string
  scope: string
  mode: PermissionMode
  sortOrder: number
}> = [
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
  // Claude Agent SDK built-ins
  Read: 'file_read',
  LS: 'file_read',
  Glob: 'file_read',
  Grep: 'file_read',
  Write: 'file_write',
  Edit: 'file_write',
  MultiEdit: 'file_write',
  NotebookEdit: 'file_write',
  Bash: 'command_exec',
  WebFetch: 'network_unknown',
  WebSearch: 'network_known',
  Task: 'mcp_tool',
  Agent: 'mcp_tool',
  // 文件读
  read_file: 'file_read',
  list_directory: 'file_read',
  search_files: 'file_read',
  grep_files: 'file_read',
  grep: 'file_read',
  // 文件写
  write_file: 'file_write',
  edit_file: 'file_write',
  multi_edit: 'file_write',
  apply_patch: 'file_write',
  // 命令执行
  run_command: 'command_exec',
  bash: 'command_exec',
  // Git
  git: 'command_exec',
  git_push: 'git_push',
  // 网络
  web_fetch: 'network_unknown',
  web_search: 'network_known',
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes; agent will treat 'deny' on timeout

interface RequestApprovalOptions {
  /** The caller already decided this tool call must ask the user. */
  forcePrompt?: boolean
  projectId?: string
  workspaceIds?: string[]
  sdkRequestId?: string
  onDecision?: (decision: PermissionApprovalDecision) => void
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

function resolveToolAction(toolName: string, toolInput: Record<string, unknown>): string {
  if (isMcpToolName(toolName)) return 'mcp_tool'
  const mapped = TOOL_ACTION_MAP[toolName] ?? TOOL_ACTION_MAP[toolName.toLowerCase()]
  if (mapped === 'command_exec' && isDangerousCommand(toolInput)) return 'command_dangerous'
  return mapped ?? 'command_exec'
}

function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__') || toolName.startsWith('mcp:')
}

function isDangerousCommand(toolInput: Record<string, unknown>): boolean {
  const command =
    typeof toolInput.command === 'string'
      ? toolInput.command
      : typeof toolInput.cmd === 'string'
        ? toolInput.cmd
        : ''
  const normalized = command.trim().toLowerCase()
  if (normalized.length === 0) return false

  return [
    /\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/,
    /\bgit\s+clean\b.*\s-[^\s]*[fx]/,
    /\bgit\s+reset\s+--hard\b/,
    /\bsudo\b/,
    /\bchmod\s+-r\b/,
    /\bchown\s+-r\b/,
    /\bdd\s+if=/,
    /\bmkfs(?:\.\w+)?\b/,
    /:\s*\(\)\s*\{\s*:\|:&\s*\};\s*:/,
  ].some((pattern) => pattern.test(normalized))
}

function isDenyDecision(decision: PermissionApprovalDecision): boolean {
  return (
    decision === 'deny' ||
    decision === 'deny-session' ||
    decision === 'deny-project' ||
    decision === 'deny-global'
  )
}

function selectGrantDecision(
  first: PermissionApprovalDecision,
  second: PermissionApprovalDecision,
): PermissionApprovalDecision {
  const priority: PermissionApprovalDecision[] = [
    'allow-global',
    'allow-project',
    'allow-session',
    'allow-once',
  ]
  for (const candidate of priority) {
    if (first === candidate || second === candidate) return candidate
  }
  return second
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
    const row = this.repo.createProfile({
      id,
      name: params.name,
      sandboxLevel: params.sandboxLevel ?? 2,
    })
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
    const row = this.repo.upsertRule({
      id: randomUUID(),
      profileId,
      action,
      scope: 'any',
      mode,
      sortOrder: 99,
    })
    return this.toRuleItem(row)
  }

  getActiveProfileId(): string {
    return this.repo.getSetting(ACTIVE_PROFILE_KEY) ?? 'project-standard'
  }

  setActiveProfileId(id: string): void {
    if (this.repo.getProfile(id) == null) throw new Error(`Profile not found: ${id}`)
    this.repo.setSetting(ACTIVE_PROFILE_KEY, id)
  }

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
    options: RequestApprovalOptions = {},
  ): Promise<boolean> {
    // 1) 查 session-scoped 临时决策（用户上一次选「会话允许 / 会话拒绝」）
    const action = resolveToolAction(toolName, toolInput)
    if (this.isSessionDenied(sessionId, action) && options.forcePrompt !== true) return false
    if (this.isSessionAllowed(sessionId, action)) return true

    // 2) 查 profile 规则
    const profileId = this.getActiveProfileId()
    const rules = this.repo.listRules(profileId)
    const rule = rules.find((r) => r.action === action)
    const mode = (rule?.mode ?? 'ask') as PermissionMode // 未知 action 默认 ask（更安全）

    if (mode === 'deny' && options.forcePrompt !== true) return false

    const remembered = this.findRememberedDecision(options.projectId, action, toolName)
    if (remembered?.decision === 'deny' && options.forcePrompt !== true) return false
    if (remembered?.decision === 'allow') return true

    if (mode === 'allow' && options.forcePrompt !== true) return true

    // 3) mode === 'ask' or 'ask-twice': push to renderer and wait
    const result = await this.promptForApproval({
      sessionId,
      toolName,
      action,
      toolInput,
      pushFn,
      options,
    })
    let grantDecision = result

    if (isDenyDecision(result)) {
      options.onDecision?.(result)
      return this.applyDenyDecision(result, sessionId, options, action, toolName)
    }

    if (mode === 'ask-twice') {
      const second = await this.promptForApproval({
        sessionId,
        toolName,
        action,
        toolInput,
        pushFn,
        options,
      })
      if (isDenyDecision(second)) {
        options.onDecision?.(second)
        return this.applyDenyDecision(second, sessionId, options, action, toolName)
      }
      grantDecision = selectGrantDecision(result, second)
    }

    options.onDecision?.(grantDecision)

    if (grantDecision === 'allow-session') {
      // 只在内存中给该 session 临时放行，不再写穿数据库
      this.allowForSession(sessionId, action)
    }

    if (grantDecision === 'allow-project' || grantDecision === 'allow-global') {
      this.rememberDecision(
        grantDecision === 'allow-project' ? 'project' : 'global',
        options,
        action,
        toolName,
        'allow',
      )
      return true
    }

    return true
  }

  private applyDenyDecision(
    result: PermissionApprovalDecision,
    sessionId: string,
    options: RequestApprovalOptions,
    action: string,
    toolName: string,
  ): false {
    if (result === 'deny-session') {
      this.denyForSession(sessionId, action)
      return false
    }
    if (result === 'deny-project' || result === 'deny-global') {
      this.rememberDecision(
        result === 'deny-project' ? 'project' : 'global',
        options,
        action,
        toolName,
        'deny',
      )
    }
    return false
  }

  private async promptForApproval(params: {
    sessionId: string
    toolName: string
    action: string
    toolInput: Record<string, unknown>
    pushFn: (req: PermissionApprovalRequest) => void
    options: RequestApprovalOptions
  }): Promise<PermissionApprovalDecision> {
    const requestId = randomUUID()
    const riskLevel = RISK_LEVEL_MAP[params.action] ?? 'low'
    const persistentScopes = this.getPersistentScopes(params.options.projectId)

    return await new Promise<PermissionApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (this._pendingApprovals.delete(requestId)) {
          this._approvalSessions.delete(requestId)
          resolve('deny') // timeout 视为拒绝，避免 agent 永久挂起
        }
      }, APPROVAL_TIMEOUT_MS)

      this._pendingApprovals.set(requestId, (decision) => {
        clearTimeout(timer)
        this._approvalSessions.delete(requestId)
        resolve(decision)
      })
      this._approvalSessions.set(requestId, params.sessionId)
      params.pushFn({
        requestId,
        ...(params.options.sdkRequestId != null
          ? { sdkRequestId: params.options.sdkRequestId }
          : {}),
        sessionId: params.sessionId,
        toolName: params.toolName,
        action: params.action,
        toolInput: params.toolInput,
        riskLevel,
        ...(params.options.projectId != null ? { projectId: params.options.projectId } : {}),
        ...(params.options.workspaceIds != null
          ? { workspaceIds: params.options.workspaceIds }
          : {}),
        persistentScopes,
      })
    })
  }

  resolveApproval(requestId: string, decision: PermissionApprovalDecision): boolean {
    const resolve = this._pendingApprovals.get(requestId)
    if (!resolve) return false
    this._pendingApprovals.delete(requestId)
    this._approvalSessions.delete(requestId)
    resolve(decision)
    return true
  }

  /**
   * 当 session 被取消时调用，拒绝该 session 下所有挂起的 approval（agent 端会收到 deny 然后清理）。
   * SessionService.cancelTurn 应该调用此方法。
   */
  cancelPendingApprovals(sessionId: string): number {
    let cancelled = 0
    for (const [requestId, resolve] of this._pendingApprovals.entries()) {
      if (this._approvalSessions.get(requestId) !== sessionId) continue
      this._pendingApprovals.delete(requestId)
      this._approvalSessions.delete(requestId)
      resolve('deny')
      cancelled += 1
    }
    // 同时清除该 session 的临时决策
    this.clearSessionDecisions(sessionId)
    return cancelled
  }

  private isSessionAllowed(sessionId: string, action: string): boolean {
    return this._sessionAllowances.get(sessionId)?.has(action) === true
  }

  private isSessionDenied(sessionId: string, action: string): boolean {
    return this._sessionDenials.get(sessionId)?.has(action) === true
  }

  private allowForSession(sessionId: string, action: string): void {
    const set = this._sessionAllowances.get(sessionId) ?? new Set<string>()
    set.add(action)
    this._sessionAllowances.set(sessionId, set)
    this._sessionDenials.get(sessionId)?.delete(action)
  }

  private denyForSession(sessionId: string, action: string): void {
    const set = this._sessionDenials.get(sessionId) ?? new Set<string>()
    set.add(action)
    this._sessionDenials.set(sessionId, set)
    this._sessionAllowances.get(sessionId)?.delete(action)
  }

  private clearSessionDecisions(sessionId: string): void {
    this._sessionAllowances.delete(sessionId)
    this._sessionDenials.delete(sessionId)
  }

  // 实例级状态：service 通常是单例（main process 全局一个），但实例化可隔离测试与多进程场景。
  private getPersistentScopes(projectId?: string): PermissionDecisionScope[] {
    return projectId != null ? ['project', 'global'] : ['global']
  }

  private findRememberedDecision(
    projectId: string | undefined,
    action: string,
    toolName: string,
  ): PermissionDecisionRow | null {
    return this.repo.findDecision({
      ...(projectId != null ? { projectId } : {}),
      action,
      toolName,
    })
  }

  private rememberDecision(
    scope: PermissionDecisionScope,
    options: RequestApprovalOptions,
    action: string,
    toolName: string,
    decision: 'allow' | 'deny',
  ): void {
    if (scope === 'project' && options.projectId == null) return
    this.repo.upsertDecision({
      id: randomUUID(),
      scope,
      ...(scope === 'project' ? { projectId: options.projectId } : {}),
      ...(scope === 'project' && options.workspaceIds != null
        ? { workspaceIds: options.workspaceIds }
        : {}),
      action,
      toolName,
      decision,
    })
  }

  private _pendingApprovals = new Map<string, (d: PermissionApprovalDecision) => void>()
  private _approvalSessions = new Map<string, string>() // requestId → sessionId（用于 cancel）
  private _sessionAllowances = new Map<string, Set<string>>() // sessionId → 已临时允许的 actions
  private _sessionDenials = new Map<string, Set<string>>() // sessionId → 已临时拒绝的 actions

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
