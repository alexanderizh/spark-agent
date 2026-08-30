import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** 内置平台管理 Skill ID，所有 agent 创建时强制注入 */
export const PLATFORM_MANAGER_SKILL_ID = 'builtin:platform-manager'

export interface AgentRow {
  id: string
  name: string
  description: string
  built_in: number
  enabled: number
  is_default: number
  provider_profile_id: string | null
  model_id: string | null
  agent_adapter: string
  permission_mode: string
  reasoning_effort: string
  prompt: string
  rule_ids_json: string
  skill_ids_json: string
  disabled_skill_ids_json: string
  mcp_server_ids_json: string
  hook_config_json: string
  workflow_id: string | null
  metadata_json: string
  created_at: string
  updated_at: string
}

export interface AgentConfig {
  providerProfileId?: string | null
  modelId?: string | null
  agentAdapter: string
  permissionMode: string
  reasoningEffort: string
  prompt: string
  ruleIds: string[]
  skillIds: string[]
  disabledSkillIds: string[]
  mcpServerIds: string[]
  hookConfig: Record<string, unknown>
  workflowId?: string | null
  metadata: Record<string, unknown>
}

export interface AgentItem extends AgentConfig {
  id: string
  name: string
  description: string
  builtIn: boolean
  enabled: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateAgentParams extends Partial<AgentConfig> {
  id?: string
  name: string
  description?: string
  enabled?: boolean
  isDefault?: boolean
  builtIn?: boolean
}

export interface UpdateAgentParams extends Partial<CreateAgentParams> {}

export class AgentRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'agents')
  }

  list(filters: { includeDisabled?: boolean } = {}): AgentItem[] {
    const where = filters.includeDisabled === true ? '' : 'WHERE enabled = 1'
    const rows = this.raw
      .prepare(`SELECT * FROM agents ${where} ORDER BY built_in DESC, updated_at DESC`)
      .all() as AgentRow[]
    return rows.map((row) => this.toItem(row))
  }

  get(id: string): AgentItem | null {
    const row = this.findById<AgentRow>(id)
    return row == null ? null : this.toItem(row)
  }

  getRow(id: string): AgentRow | null {
    return this.findById<AgentRow>(id)
  }

  create(params: CreateAgentParams): AgentItem {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    const metadata = withDefaultAvatar(params.metadata, params.name)
    const isDefault = params.isDefault === true ? 1 : 0
    if (isDefault) this.clearDefaultFlag()
    const skillIds = mergeUniqueStrings(params.skillIds, PLATFORM_MANAGER_SKILL_ID)
    this.raw
      .prepare(
        `INSERT INTO agents (
          id, name, description, built_in, enabled, is_default, provider_profile_id, model_id,
          agent_adapter, permission_mode, reasoning_effort, prompt, rule_ids_json,
          skill_ids_json, disabled_skill_ids_json, mcp_server_ids_json, hook_config_json,
          workflow_id, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.name,
        params.description ?? '',
        params.builtIn === true ? 1 : 0,
        params.enabled === false ? 0 : 1,
        isDefault,
        params.providerProfileId ?? null,
        params.modelId ?? null,
        params.agentAdapter ?? 'claude-sdk',
        params.permissionMode ?? 'claude-ask',
        params.reasoningEffort ?? 'max',
        params.prompt ?? '',
        this.toJson(params.ruleIds ?? []),
        this.toJson(skillIds),
        this.toJson(params.disabledSkillIds ?? []),
        this.toJson(params.mcpServerIds ?? []),
        this.toJson(params.hookConfig ?? {}),
        params.workflowId ?? null,
        this.toJson(metadata),
        now,
        now,
      )
    return this.get(id)!
  }

  update(id: string, fields: UpdateAgentParams): AgentItem | null {
    const existing = this.getRow(id)
    if (existing == null) return null

    const sets: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown) => {
      sets.push(`${column} = ?`)
      values.push(value)
    }

    if (fields.name !== undefined) add('name', fields.name)
    if (fields.description !== undefined) add('description', fields.description)
    if (fields.builtIn !== undefined) add('built_in', fields.builtIn ? 1 : 0)
    if (fields.enabled !== undefined) add('enabled', fields.enabled ? 1 : 0)
    if (fields.isDefault !== undefined) {
      if (fields.isDefault) this.clearDefaultFlag()
      add('is_default', fields.isDefault ? 1 : 0)
    }
    if (fields.providerProfileId !== undefined) add('provider_profile_id', fields.providerProfileId)
    if (fields.modelId !== undefined) add('model_id', fields.modelId)
    if (fields.agentAdapter !== undefined) add('agent_adapter', fields.agentAdapter)
    if (fields.permissionMode !== undefined) add('permission_mode', fields.permissionMode)
    if (fields.reasoningEffort !== undefined) add('reasoning_effort', fields.reasoningEffort)
    if (fields.prompt !== undefined) add('prompt', fields.prompt)
    if (fields.ruleIds !== undefined) add('rule_ids_json', this.toJson(fields.ruleIds))
    if (fields.skillIds !== undefined) {
      const merged = mergeUniqueStrings(fields.skillIds, PLATFORM_MANAGER_SKILL_ID)
      add('skill_ids_json', this.toJson(merged))
    }
    if (fields.disabledSkillIds !== undefined) {
      add('disabled_skill_ids_json', this.toJson(fields.disabledSkillIds))
    }
    if (fields.mcpServerIds !== undefined)
      add('mcp_server_ids_json', this.toJson(fields.mcpServerIds))
    if (fields.hookConfig !== undefined) add('hook_config_json', this.toJson(fields.hookConfig))
    if (fields.workflowId !== undefined) add('workflow_id', fields.workflowId)
    if (fields.metadata !== undefined) add('metadata_json', this.toJson(fields.metadata))

    if (sets.length === 0) return this.get(id)
    sets.push('updated_at = ?')
    values.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  clearDefaultFlag(): void {
    this.raw.prepare('UPDATE agents SET is_default = 0 WHERE is_default = 1').run()
  }

  getDefault(): AgentItem | null {
    const row = this.raw.prepare('SELECT * FROM agents WHERE is_default = 1 LIMIT 1').get() as
      | AgentRow
      | undefined
    return row ? this.toItem(row) : null
  }

  delete(id: string): boolean {
    const row = this.getRow(id)
    if (row == null || row.built_in === 1) return false
    return this.deleteById(id)
  }

  private toItem(row: AgentRow): AgentItem {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      builtIn: row.built_in === 1,
      enabled: row.enabled === 1,
      isDefault: row.is_default === 1,
      providerProfileId: row.provider_profile_id,
      modelId: row.model_id,
      agentAdapter: row.agent_adapter,
      permissionMode: row.permission_mode,
      reasoningEffort: normalizeReasoningEffort(row.reasoning_effort),
      prompt: row.prompt,
      ruleIds: this.fromJson<string[]>(row.rule_ids_json, []),
      skillIds: this.fromJson<string[]>(row.skill_ids_json, []),
      disabledSkillIds: this.fromJson<string[]>(row.disabled_skill_ids_json, []),
      mcpServerIds: this.fromJson<string[]>(row.mcp_server_ids_json, []),
      hookConfig: this.fromJson<Record<string, unknown>>(row.hook_config_json, {}),
      workflowId: row.workflow_id,
      metadata: this.fromJson<Record<string, unknown>>(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

function normalizeReasoningEffort(value: string): string {
  return value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
    ? value
    : 'max'
}

function mergeUniqueStrings(existing: string[] | undefined, required: string): string[] {
  const list = Array.isArray(existing)
    ? existing.filter((s) => typeof s === 'string' && s.length > 0)
    : []
  if (list.includes(required)) return list
  return [...list, required]
}

function withDefaultAvatar(
  metadata: Record<string, unknown> | undefined,
  _name: string,
): Record<string, unknown> {
  const next = { ...(metadata ?? {}) }
  if (next.avatar == null) {
    next.avatar = {
      kind: 'builtin',
      id: 'agent-default',
    }
  }
  return next
}
