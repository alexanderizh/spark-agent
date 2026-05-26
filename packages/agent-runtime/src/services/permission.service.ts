import { randomUUID } from 'crypto'
import type { PermissionProfileRepository, PermissionProfileRow, PermissionRuleRow } from '@spark/storage'
import type { PermissionProfileItem, PermissionRuleItem, PermissionMode } from '@spark/protocol'

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
