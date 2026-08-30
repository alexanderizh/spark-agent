import type {
  AccountSyncCategory,
  AccountSyncCategoryResult,
  AccountSyncItem,
} from '@spark/protocol'
import {
  AgentRepository,
  MemoryRepository,
  RulesRepository,
  SettingsRepository,
  TeamDefinitionRepository,
  WorkflowRepository,
  WorkspaceRepository,
  type SparkDatabase,
} from '@spark/storage'
import { MemoryStoreService } from '@spark/agent-runtime'
import {
  finalizeCollectedItems,
  hashSyncRuleFingerprint,
  type AccountSyncCollectResult,
} from './sync-policy.js'
import { compressPromptCoverToDataUrl } from './prompt-library-cover.js'
import {
  PROMPT_LIBRARY_SETTINGS_CATEGORY,
  PROMPT_LIBRARY_SETTINGS_KEY,
  type PersistedPromptLibraryItem,
  type PersistedPromptLibraryState,
} from '../CanvasPromptLibraryPersistence.js'

const APPEARANCE_FIELDS = [
  'theme',
  'emptyHeroTheme',
  'primary',
  'density',
  'font',
  'fontSize',
  'uiZoom',
  'codeLigature',
  'windowCorners',
  'backdropBlur',
  'autoCollapseTools',
  'inlineTokenCount',
  'syntaxHighlight',
  'timestampFormat',
] as const

export interface AccountSyncApplyResult {
  errorCodes: string[]
  appearance?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 主进程侧头像校验（与渲染端 normalizeAvatarConfig 对齐的同步安全子集）：
 * - builtin / dicebear 是纯配置字符串，直接保留；
 * - url 只接受 http(s)，不接受 file:// 或本机路径；
 * - upload 只接受 data:image/ 内嵌且体积受限（服务端单字段上限留余量）；
 * 其余（含缺失）一律返回 null，调用方剔除 avatar 字段，不阻断条目同步。
 */
function sanitizeAvatarConfig(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (kind === 'builtin' && typeof value.id === 'string' && value.id.trim().length > 0) {
    return { kind: 'builtin', id: value.id.trim() }
  }
  if (kind === 'dicebear' && typeof value.seed === 'string' && value.seed.trim().length > 0) {
    return {
      kind: 'dicebear',
      seed: value.seed.trim(),
      ...(typeof value.style === 'string' && value.style.trim().length > 0
        ? { style: value.style.trim() }
        : {}),
    }
  }
  if (kind === 'url' && typeof value.url === 'string' && /^https?:\/\//i.test(value.url)) {
    return { kind: 'url', url: value.url }
  }
  if (
    kind === 'upload' &&
    typeof value.dataUrl === 'string' &&
    /^data:image\//i.test(value.dataUrl) &&
    value.dataUrl.length <= 240 * 1024
  ) {
    return { kind: 'upload', dataUrl: value.dataUrl }
  }
  return null
}

/** 从 app_settings 读出提示词库条目，缺失字段取安全默认，最终字段类型由 sync-policy 把关。 */
function readPromptLibraryItems(value: unknown): PersistedPromptLibraryItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  const epoch = new Date(0).toISOString()
  return value.items.flatMap((rawItem) => {
    if (!isRecord(rawItem) || typeof rawItem.id !== 'string' || !rawItem.id.trim()) return []
    return [
      {
        id: rawItem.id,
        title: asString(rawItem.title, '-'),
        text: asString(rawItem.text),
        category: asString(rawItem.category),
        tags: asStringArray(rawItem.tags),
        coverUrl: asNullableString(rawItem.coverUrl),
        coverMimeType: asNullableString(rawItem.coverMimeType),
        usageCount: asNumber(rawItem.usageCount, 0),
        createdAt: asString(rawItem.createdAt, epoch),
        updatedAt: asString(rawItem.updatedAt, epoch),
      },
    ]
  })
}

function itemValue(item: AccountSyncItem): Record<string, unknown> | null {
  return item.deleted || !isRecord(item.value) ? null : item.value
}

/**
 * 把云端 avatar 合并进本机 metadata。repo 的 update 是整体替换 metadata_json，
 * 必须带上本机既有键（hook 等敏感项），否则会被云端投影覆盖。
 * 云端条目没有 avatar 时返回 undefined，调用方不传 metadata 字段、本机原样保留。
 */
function mergeAvatarMetadata(
  existing: { metadata?: Record<string, unknown> } | null | undefined,
  incomingValue: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  const incoming = isRecord(incomingValue) ? incomingValue : null
  const incomingMetadata = isRecord(incoming?.metadata) ? incoming.metadata : null
  if (incomingMetadata?.avatar === undefined) return undefined
  const merged: Record<string, unknown> = {
    ...(isRecord(existing?.metadata) ? existing.metadata : {}),
  }
  merged.avatar = incomingMetadata.avatar
  return merged
}

export class AccountSyncAdapters {
  private readonly settings: SettingsRepository
  private readonly rules: RulesRepository
  private readonly agents: AgentRepository
  private readonly teams: TeamDefinitionRepository
  private readonly workflows: WorkflowRepository
  private readonly memories: MemoryRepository

  constructor(private readonly db: SparkDatabase) {
    this.settings = new SettingsRepository(db)
    this.rules = new RulesRepository(db)
    this.agents = new AgentRepository(db)
    this.teams = new TeamDefinitionRepository(db)
    this.workflows = new WorkflowRepository(db)
    this.memories = new MemoryRepository(db)
  }

  async collect(category: AccountSyncCategory): Promise<AccountSyncCollectResult> {
    switch (category) {
      case 'customCommands':
        return this.collectCustomCommands()
      case 'prompts':
        return this.collectPrompts()
      case 'memory':
        return this.collectMemory()
      case 'assistants':
        return this.collectAssistants()
      case 'workflows':
        return this.collectWorkflows()
      case 'appearance':
        return this.collectAppearance()
      case 'promptLibrary':
        return this.collectPromptLibrary()
    }
  }

  async apply(
    result: AccountSyncCategoryResult,
    protectedIds: ReadonlySet<string>,
  ): Promise<AccountSyncApplyResult> {
    switch (result.category) {
      case 'customCommands':
        return this.applyCustomCommands(result.records, protectedIds)
      case 'prompts':
        return this.applyPrompts(result.records, protectedIds)
      case 'memory':
        return this.applyMemory(result.records, protectedIds)
      case 'assistants':
        return this.applyAssistants(result.records, protectedIds)
      case 'workflows':
        return this.applyWorkflows(result.records, protectedIds)
      case 'appearance':
        return this.applyAppearance(result.records, protectedIds)
      case 'promptLibrary':
        return this.applyPromptLibrary(result.records, protectedIds)
    }
  }

  private collectCustomCommands(): AccountSyncCollectResult {
    const commands = this.readCustomCommands()
    return finalizeCollectedItems(
      'customCommands',
      commands.map((command) => ({
        id: asString(command.id),
        updatedAt: asString(command.updatedAt, new Date(0).toISOString()),
        value: {
          id: asString(command.id),
          name: asString(command.name),
          description: asString(command.description),
          prompt: asString(command.prompt),
          script: asString(command.script),
          scriptLanguage: command.scriptLanguage === 'python' ? 'python' : 'javascript',
          enabled: command.enabled !== false,
          updatedAt: asString(command.updatedAt, new Date(0).toISOString()),
        },
      })),
    )
  }

  private collectPrompts(): AccountSyncCollectResult {
    const candidates: Array<{
      id: string
      updatedAt: string
      value: Record<string, unknown>
    }> = []
    for (const rule of this.rules.list()) {
      if (rule.scope === 'system') {
        candidates.push({
          id: `system-rule:${hashSyncRuleFingerprint({
            name: rule.name,
            content: rule.content,
            priority: rule.priority,
          })}`,
          updatedAt: rule.updated_at,
          value: {
            id: rule.id,
            scope: 'system',
            scopeRef: null,
            kind: 'rule-enabled',
            enabled: rule.enabled === 1,
            fingerprint: hashSyncRuleFingerprint({
              name: rule.name,
              content: rule.content,
              priority: rule.priority,
            }),
            updatedAt: rule.updated_at,
          },
        })
      } else {
        candidates.push({
          id: `rule:${rule.id}`,
          updatedAt: rule.updated_at,
          value: {
            id: rule.id,
            scope: rule.scope,
            scopeRef: rule.scope_ref,
            kind: 'rule',
            name: rule.name,
            content: rule.content,
            priority: rule.priority,
            enabled: rule.enabled === 1,
            updatedAt: rule.updated_at,
          },
        })
      }
    }

    for (const row of this.getSettingRows('runtime.prompts')) {
      if (row.key.startsWith('agent:')) continue
      const value = this.parseSettingValue(row.value)
      if (!isRecord(value)) continue
      const [scope = '', ...refParts] = row.key.split(':')
      if (!['system', 'project', 'session'].includes(scope)) continue
      candidates.push({
        id: `runtime-prompt:${row.key}`,
        updatedAt: row.updated_at,
        value: {
          id: row.key,
          scope,
          scopeRef: refParts.length > 0 ? refParts.join(':') : null,
          kind: 'runtime',
          content: asString(value.content),
          enabled: value.enabled !== false,
          updatedAt: row.updated_at,
        },
      })
    }
    return finalizeCollectedItems('prompts', candidates)
  }

  private async collectMemory(): Promise<AccountSyncCollectResult> {
    const rows = [
      ...this.memories.listByScope('user', null, {
        includeArchived: true,
        includeInvalid: true,
        limit: 2_000,
      }),
      ...this.memories.listByScope('project', null, {
        includeArchived: true,
        includeInvalid: true,
        matchAnyScopeRef: true,
        limit: 2_000,
      }),
      ...this.memories.listByScope('agent', null, {
        includeArchived: true,
        includeInvalid: true,
        matchAnyScopeRef: true,
        limit: 2_000,
      }),
    ].slice(0, 2_000)
    const candidates: Array<{
      id: string
      updatedAt: number
      value: Record<string, unknown>
    }> = []
    const skippedItems: AccountSyncCollectResult['skippedItems'] = []
    const seenIds = new Set<string>()
    const store = new MemoryStoreService()
    for (const row of rows) {
      seenIds.add(row.id)
      try {
        const body = await store.readFile(row.file_path)
        candidates.push({
          id: row.id,
          updatedAt: row.updated_at,
          value: {
            id: row.id,
            scope: row.scope,
            scopeRef: row.scope_ref,
            type: row.type,
            name: row.name,
            description: row.description,
            body,
            confidence: row.confidence,
            isArchived: row.archived === 1 || row.invalid_at != null,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
          },
        })
      } catch {
        skippedItems.push({ id: row.id, reasonCode: 'LOCAL_MEMORY_BODY_UNREADABLE' })
      }
    }
    const safe = finalizeCollectedItems('memory', candidates)
    return {
      records: safe.records,
      skippedItems: [...skippedItems, ...safe.skippedItems],
      seenIds,
    }
  }

  private collectAssistants(): AccountSyncCollectResult {
    const agentCandidates = this.agents.list({ includeDisabled: true }).flatMap((agent) => {
      const value: Record<string, unknown> = {
        id: agent.id,
        kind: 'agent',
        name: agent.name,
        description: agent.description,
        enabled: agent.enabled,
        isDefault: agent.isDefault,
        prompt: agent.prompt,
        permissionMode: agent.permissionMode,
        skillIds: agent.skillIds,
        ruleIds: agent.ruleIds,
        workflowIds: agent.workflowId != null ? [agent.workflowId] : [],
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      }
      const avatar = sanitizeAvatarConfig(agent.metadata?.avatar)
      if (avatar != null) value.metadata = { avatar }
      return [{ id: `agent:${agent.id}`, updatedAt: agent.updatedAt, value }]
    })
    const teamCandidates = this.teams.list({ includeDisabled: true }).flatMap((team) => {
      const value: Record<string, unknown> = {
        id: team.id,
        kind: 'team',
        name: team.name,
        description: team.description,
        enabled: team.enabled,
        prompt: team.prompt,
        leaderId: team.hostAgentId,
        memberIds: team.memberAgentIds,
        coordinationMode: {
          maxDepth: team.maxDepth,
          allowNesting: team.allowNesting,
          enablePeerMessaging: team.enablePeerMessaging,
        },
        discussionRounds: team.maxDiscussionRounds,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      }
      const avatar = sanitizeAvatarConfig(team.metadata?.avatar)
      if (avatar != null) value.metadata = { avatar }
      return [{ id: `team:${team.id}`, updatedAt: team.updatedAt, value }]
    })
    return finalizeCollectedItems('assistants', [...agentCandidates, ...teamCandidates])
  }

  private collectWorkflows(): AccountSyncCollectResult {
    return finalizeCollectedItems(
      'workflows',
      this.workflows.list({ includeArchived: true }).map((workflow) => ({
        id: workflow.id,
        updatedAt: workflow.updatedAt,
        value: {
          id: workflow.id,
          scope: workflow.scope,
          name: workflow.name,
          version: workflow.version,
          description: workflow.description,
          status: workflow.status,
          tags: workflow.tags,
          enabled: workflow.enabled,
          graph: workflow.graph,
          createdAt: workflow.createdAt,
          updatedAt: workflow.updatedAt,
        },
      })),
    )
  }

  private collectAppearance(): AccountSyncCollectResult {
    const raw = this.settings.get('appearance', 'data')
    const current = isRecord(raw) ? raw : {}
    const value: Record<string, unknown> = { id: 'appearance' }
    for (const field of APPEARANCE_FIELDS) {
      if (current[field] !== undefined) value[field] = current[field]
    }
    const updatedAt =
      asString(current.updatedAt) ||
      this.getSettingUpdatedAt('appearance', 'data') ||
      new Date(0).toISOString()
    value.updatedAt = updatedAt
    return finalizeCollectedItems('appearance', [{ id: 'appearance', updatedAt, value }])
  }

  /**
   * 收集提示词库条目。封面图片按用户确认的策略「压缩后同步」：
   * 本地文件/超大 dataUrl 用 sharp 压缩为 ≤512px、≤240KB 的 dataUrl 内嵌快照，
   * 远程 http(s) URL 原样保留；读不到或压缩失败的条目封面置空，文字仍正常同步。
   */
  private async collectPromptLibrary(): Promise<AccountSyncCollectResult> {
    const raw = this.settings.get(PROMPT_LIBRARY_SETTINGS_CATEGORY, PROMPT_LIBRARY_SETTINGS_KEY)
    const items = readPromptLibraryItems(raw)
    const candidates: Array<{
      id: string
      updatedAt: string
      value: Record<string, unknown>
    }> = []
    for (const item of items) {
      let coverUrl: string | null = item.coverUrl
      let coverMimeType: string | null = item.coverMimeType
      if (item.coverUrl != null) {
        const compressed = await compressPromptCoverToDataUrl(item.coverUrl, item.coverMimeType)
        if (compressed != null) {
          coverUrl = compressed.dataUrl
          coverMimeType = compressed.mimeType
        } else {
          coverUrl = null
          coverMimeType = null
        }
      }
      candidates.push({
        id: `promptLibrary:${item.id}`,
        updatedAt: item.updatedAt,
        value: {
          id: item.id,
          title: item.title,
          text: item.text,
          category: item.category,
          tags: item.tags,
          coverUrl,
          coverMimeType,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
      })
    }
    return finalizeCollectedItems('promptLibrary', candidates)
  }

  private async applyCustomCommands(
    records: AccountSyncItem[],
    protectedIds: ReadonlySet<string>,
  ): Promise<AccountSyncApplyResult> {
    // Keep locally protected entries (for example commands containing a local path or secret)
    // in the persisted list. Rebuilding from the safe upload projection would silently delete them.
    const current = this.readCustomCommands()
    const byId = new Map(current.map((item) => [asString(item.id), item]))
    for (const item of records) {
      if (protectedIds.has(item.id)) continue
      if (item.deleted) byId.delete(item.id)
      else if (isRecord(item.value)) byId.set(item.id, item.value)
    }
    this.settings.set('custom-commands', 'items', JSON.stringify(Array.from(byId.values())))
    return { errorCodes: [] }
  }

  private async applyPrompts(
    records: AccountSyncItem[],
    protectedIds: ReadonlySet<string>,
  ): Promise<AccountSyncApplyResult> {
    const errorCodes: string[] = []
    for (const item of records) {
      if (protectedIds.has(item.id)) continue
      const value = itemValue(item)
      if (item.id.startsWith('system-rule:')) {
        if (value == null) continue
        const fingerprint = asString(value.fingerprint)
        const target = this.rules.list({ scope: 'system' }).find(
          (rule) =>
            hashSyncRuleFingerprint({
              name: rule.name,
              content: rule.content,
              priority: rule.priority,
            }) === fingerprint,
        )
        if (target == null) {
          errorCodes.push('SYNC_SYSTEM_RULE_NOT_FOUND')
          continue
        }
        this.rules.update(target.id, { enabled: value.enabled !== false })
        this.setTableUpdatedAt('rules', target.id, item.updatedAt)
        continue
      }

      if (item.id.startsWith('runtime-prompt:')) {
        const key = item.id.slice('runtime-prompt:'.length)
        if (item.deleted) {
          this.settings.delete('runtime.prompts', key)
        } else if (value != null) {
          this.settings.set('runtime.prompts', key, {
            enabled: value.enabled !== false,
            content: asString(value.content),
          })
          this.setSettingUpdatedAt('runtime.prompts', key, item.updatedAt)
        }
        continue
      }

      const id = asString(value?.id, item.id.replace(/^rule:/, ''))
      const existing = this.rules.getById(id)
      if (item.deleted) {
        if (existing != null && existing.scope !== 'system') this.rules.delete(id)
      } else if (value != null) {
        if (existing != null) {
          if (existing.scope !== 'system') {
            this.rules.update(id, {
              name: asString(value.name),
              content: asString(value.content),
              priority: asNumber(value.priority, 0),
              enabled: value.enabled !== false,
            })
          }
        } else {
          this.rules.create({
            id,
            scope: asString(value.scope, 'user'),
            scopeRef: typeof value.scopeRef === 'string' ? value.scopeRef : null,
            name: asString(value.name, '同步提示词'),
            content: asString(value.content),
            priority: asNumber(value.priority, 0),
            enabled: value.enabled !== false,
          })
        }
        this.setTableUpdatedAt('rules', id, item.updatedAt)
      }
    }
    return { errorCodes: Array.from(new Set(errorCodes)) }
  }

  private async applyMemory(
    records: AccountSyncItem[],
    protectedIds: ReadonlySet<string>,
  ): Promise<AccountSyncApplyResult> {
    const errorCodes: string[] = []
    for (const item of records) {
      if (protectedIds.has(item.id)) continue
      const existing = this.memories.getById(item.id)
      if (item.deleted) {
        if (existing != null) {
          try {
            await new MemoryStoreService().deleteFile(existing.file_path)
            this.memories.delete(item.id)
          } catch {
            errorCodes.push('SYNC_MEMORY_DELETE_FAILED')
          }
        }
        continue
      }
      const value = itemValue(item)
      if (value == null) continue
      const scope: 'user' | 'project' | 'agent' =
        value.scope === 'project' || value.scope === 'agent' ? value.scope : 'user'
      const scopeRef = typeof value.scopeRef === 'string' ? value.scopeRef : null
      const workspaceRoot =
        scope === 'project' && scopeRef != null
          ? new WorkspaceRepository(this.db).get(scopeRef)?.root_path
          : undefined
      if (scope === 'project' && workspaceRoot == null) {
        errorCodes.push('SYNC_MEMORY_SCOPE_UNAVAILABLE')
        continue
      }
      const store = new MemoryStoreService(undefined, workspaceRoot)
      const createdAt = Date.parse(asString(value.createdAt, item.updatedAt))
      const updatedAt = Date.parse(item.updatedAt)
      const memoryType: 'user' | 'feedback' | 'project' | 'reference' =
        value.type === 'feedback' || value.type === 'project' || value.type === 'reference'
          ? value.type
          : 'user'
      const meta = {
        id: item.id,
        scope,
        scopeRef,
        type: memoryType,
        name: asString(value.name, '同步记忆'),
        description: asString(value.description),
        confidence: asNumber(value.confidence, 0.8),
        createdAt: Number.isFinite(createdAt) ? createdAt : updatedAt,
        updatedAt,
        hitCount: 0,
        lastHitAt: null,
        sourceSessionId: null,
        links: [] as string[],
        archived: value.isArchived === true,
      }
      try {
        const filePath = await store.writeFile({ meta, body: asString(value.body) })
        if (existing == null) {
          this.memories.insert(
            {
              id: item.id,
              scope,
              scope_ref: scopeRef,
              type: meta.type,
              name: meta.name,
              description: meta.description,
              file_path: filePath,
              confidence: meta.confidence,
              hit_count: 0,
              last_hit_at: null,
              source_session_id: null,
              archived: meta.archived ? 1 : 0,
            },
            asString(value.body),
          )
        } else {
          this.memories.update(
            item.id,
            {
              scope,
              scope_ref: scopeRef,
              type: meta.type,
              name: meta.name,
              description: meta.description,
              file_path: filePath,
              confidence: meta.confidence,
              archived: meta.archived ? 1 : 0,
            },
            asString(value.body),
          )
        }
        this.db.raw
          .prepare('UPDATE memory_entry SET created_at = ?, updated_at = ? WHERE id = ?')
          .run(meta.createdAt, meta.updatedAt, item.id)
      } catch {
        errorCodes.push('SYNC_MEMORY_APPLY_FAILED')
      }
    }
    return { errorCodes: Array.from(new Set(errorCodes)) }
  }

  private async applyAssistants(
    records: AccountSyncItem[],
    protectedIds: ReadonlySet<string>,
  ): Promise<AccountSyncApplyResult> {
    const errorCodes: string[] = []
    const agentItems = records.filter((item) => item.id.startsWith('agent:'))
    const teamItems = records.filter((item) => item.id.startsWith('team:'))

    for (const item of agentItems) {
      if (protectedIds.has(item.id)) continue
      const id = item.id.slice('agent:'.length)
      const existing = this.agents.get(id)
      if (item.deleted) {
        if (existing != null && !existing.builtIn) this.agents.delete(id)
        continue
      }
      const value = itemValue(item)
      if (value == null) continue
      const workflowId = asStringArray(value.workflowIds)[0]
      const safeWorkflowId =
        workflowId != null && this.workflows.get(workflowId) != null ? workflowId : null
      if (workflowId != null && safeWorkflowId == null) {
        errorCodes.push('SYNC_WORKFLOW_DEPENDENCY_MISSING')
      }
      const fields = {
        name: asString(value.name, '同步助手'),
        description: asString(value.description),
        enabled: value.enabled !== false,
        isDefault: value.isDefault === true,
        prompt: asString(value.prompt),
        permissionMode: asString(value.permissionMode, 'claude-ask'),
        skillIds: asStringArray(value.skillIds),
        ruleIds: asStringArray(value.ruleIds),
        workflowId: safeWorkflowId,
      }
      const agentMetadata = mergeAvatarMetadata(existing, value)
      if (existing == null) {
        this.agents.create({
          id,
          ...fields,
          ...(agentMetadata != null ? { metadata: agentMetadata } : {}),
        })
      } else if (agentMetadata != null) {
        this.agents.update(id, { ...fields, metadata: agentMetadata })
      } else {
        this.agents.update(id, fields)
      }
      this.setTableUpdatedAt('agents', id, item.updatedAt)
    }

    for (const item of teamItems) {
      if (protectedIds.has(item.id)) continue
      const id = item.id.slice('team:'.length)
      const existing = this.teams.get(id)
      if (item.deleted) {
        if (existing != null && !existing.builtIn) this.teams.delete(id)
        continue
      }
      const value = itemValue(item)
      if (value == null) continue
      const leaderId = asString(value.leaderId)
      const memberIds = asStringArray(value.memberIds)
      if (this.agents.get(leaderId) == null) {
        errorCodes.push('SYNC_TEAM_LEADER_MISSING')
        continue
      }
      const existingMemberIds = memberIds.filter((memberId) => this.agents.get(memberId) != null)
      if (existingMemberIds.length !== memberIds.length) {
        errorCodes.push('SYNC_TEAM_MEMBER_MISSING')
      }
      const coordination = isRecord(value.coordinationMode) ? value.coordinationMode : {}
      const fields = {
        name: asString(value.name, '同步团队'),
        description: asString(value.description),
        enabled: value.enabled !== false,
        hostAgentId: leaderId,
        memberAgentIds: existingMemberIds.filter((memberId) => memberId !== leaderId),
        maxDepth: Math.max(1, Math.min(3, asNumber(coordination.maxDepth, 1))),
        allowNesting: asBoolean(coordination.allowNesting),
        prompt: asString(value.prompt),
        maxDiscussionRounds: Math.max(1, Math.min(20, asNumber(value.discussionRounds, 6))),
        enablePeerMessaging: asBoolean(coordination.enablePeerMessaging),
      }
      const teamMetadata = mergeAvatarMetadata(existing, value)
      if (existing == null) {
        this.teams.create({
          id,
          ...fields,
          ...(teamMetadata != null ? { metadata: teamMetadata } : {}),
        })
      } else if (teamMetadata != null) {
        this.teams.update(id, { ...fields, metadata: teamMetadata })
      } else {
        this.teams.update(id, fields)
      }
      this.setTableUpdatedAt('agent_teams', id, item.updatedAt)
    }
    return { errorCodes: Array.from(new Set(errorCodes)) }
  }

  private async applyWorkflows(
    records: AccountSyncItem[],
    protectedIds: ReadonlySet<string>,
  ): Promise<AccountSyncApplyResult> {
    for (const item of records) {
      if (protectedIds.has(item.id)) continue
      const existing = this.workflows.get(item.id)
      if (item.deleted) {
        if (existing != null) this.workflows.delete(item.id)
        continue
      }
      const value = itemValue(item)
      if (value == null) continue
      const status: 'draft' | 'active' | 'archived' =
        value.status === 'active' || value.status === 'archived' ? value.status : 'draft'
      const fields = {
        scope: asString(value.scope, 'user'),
        name: asString(value.name, '同步工作流'),
        version: asString(value.version, '1.0.0'),
        description: asString(value.description),
        status,
        tags: asStringArray(value.tags),
        enabled: value.enabled !== false,
        graph: isRecord(value.graph) ? value.graph : {},
      }
      if (existing == null) this.workflows.create({ id: item.id, ...fields })
      else this.workflows.update(item.id, fields)
      this.setTableUpdatedAt('workflows', item.id, item.updatedAt)
    }
    return { errorCodes: [] }
  }

  private async applyAppearance(
    records: AccountSyncItem[],
    protectedIds: ReadonlySet<string>,
  ): Promise<AccountSyncApplyResult> {
    const item = records.find((record) => record.id === 'appearance')
    if (item == null || item.deleted || protectedIds.has(item.id)) return { errorCodes: [] }
    const value = itemValue(item)
    if (value == null) return { errorCodes: [] }
    const current = this.settings.get('appearance', 'data')
    const merged: Record<string, unknown> = isRecord(current) ? { ...current } : {}
    for (const field of APPEARANCE_FIELDS) {
      if (value[field] !== undefined) merged[field] = value[field]
    }
    merged.updatedAt = item.updatedAt
    this.settings.set('appearance', 'data', merged)
    this.setSettingUpdatedAt('appearance', 'data', item.updatedAt)
    return { errorCodes: [], appearance: merged }
  }

  /**
   * 应用云端提示词库。按 id 合并：本机使用次数（usageCount）与本地受保护条目保留，
   * 云端条目按时间戳决胜结果覆盖；云端带来的分类并回本地分类列表，避免条目不可见。
   */
  private async applyPromptLibrary(
    records: AccountSyncItem[],
    protectedIds: ReadonlySet<string>,
  ): Promise<AccountSyncApplyResult> {
    const raw = this.settings.get(PROMPT_LIBRARY_SETTINGS_CATEGORY, PROMPT_LIBRARY_SETTINGS_KEY)
    const state: PersistedPromptLibraryState = isRecord(raw)
      ? {
          version: 1,
          categories: Array.isArray(raw.categories)
            ? raw.categories.filter((item): item is string => typeof item === 'string')
            : [],
          items: readPromptLibraryItems(raw),
          legacyMigrated: raw.legacyMigrated === true,
        }
      : { version: 1, categories: [], items: [], legacyMigrated: false }
    const itemsById = new Map(state.items.map((item) => [item.id, item]))
    const incomingCategories = new Set(state.categories)
    for (const item of records) {
      if (protectedIds.has(item.id)) continue
      const id = item.id.slice('promptLibrary:'.length)
      if (item.deleted) {
        itemsById.delete(id)
        continue
      }
      const value = itemValue(item)
      if (value == null) continue
      const existing = itemsById.get(id)
      const next = {
        id,
        title: asString(value.title, '-'),
        text: asString(value.text),
        category: asString(value.category),
        tags: asStringArray(value.tags),
        coverUrl: asNullableString(value.coverUrl),
        coverMimeType: asNullableString(value.coverMimeType),
        usageCount: existing?.usageCount ?? 0,
        createdAt: asString(value.createdAt, existing?.createdAt ?? new Date().toISOString()),
        updatedAt: asString(value.updatedAt, new Date().toISOString()),
      }
      itemsById.set(id, next)
      if (next.category) incomingCategories.add(next.category)
    }
    this.settings.set(PROMPT_LIBRARY_SETTINGS_CATEGORY, PROMPT_LIBRARY_SETTINGS_KEY, {
      version: 1,
      categories: Array.from(incomingCategories),
      items: Array.from(itemsById.values()),
      legacyMigrated: state.legacyMigrated,
    })
    this.setSettingUpdatedAt(
      PROMPT_LIBRARY_SETTINGS_CATEGORY,
      PROMPT_LIBRARY_SETTINGS_KEY,
      new Date().toISOString(),
    )
    return { errorCodes: [] }
  }

  private getSettingRows(category: string): Array<{
    key: string
    value: string
    updated_at: string
  }> {
    return this.db.raw
      .prepare('SELECT key, value, updated_at FROM app_settings WHERE category = ?')
      .all(category) as Array<{ key: string; value: string; updated_at: string }>
  }

  private getSettingUpdatedAt(category: string, key: string): string | null {
    const row = this.db.raw
      .prepare('SELECT updated_at FROM app_settings WHERE category = ? AND key = ?')
      .get(category, key) as { updated_at: string } | undefined
    return row?.updated_at ?? null
  }

  private parseSettingValue(value: string): unknown {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return null
    }
  }

  private readCustomCommands(): Record<string, unknown>[] {
    const raw = this.settings.get('custom-commands', 'items')
    let parsed: unknown = raw
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        parsed = []
      }
    }
    return Array.isArray(parsed) ? parsed.filter(isRecord) : []
  }

  private setSettingUpdatedAt(category: string, key: string, updatedAt: string): void {
    this.db.raw
      .prepare('UPDATE app_settings SET updated_at = ? WHERE category = ? AND key = ?')
      .run(updatedAt, category, key)
  }

  private setTableUpdatedAt(table: string, id: string, updatedAt: string): void {
    const allowed = new Set(['rules', 'agents', 'agent_teams', 'workflows'])
    if (!allowed.has(table)) throw new Error('Unsupported sync timestamp table')
    this.db.raw.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(updatedAt, id)
  }
}
