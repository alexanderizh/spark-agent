import type { SkillItem } from '@spark/protocol'
import type { SettingsRepository, SkillRepository } from '@spark/storage'
import { SkillLoader, type SkillInfo } from '../skills/skill-loader.js'

export type RuntimeLayerScope = 'system' | 'agent' | 'project' | 'session'

export interface RuntimeScopeRefs {
  workspaceId?: string
  sessionId?: string
  agentId?: string
}

export interface RuntimeCompositionOverrides {
  agentSkillIds?: string[]
  agentDisabledSkillIds?: string[]
}

export interface PromptLayerValue {
  enabled: boolean
  content: string
}

export interface RuntimeSkillConfig {
  skills: SkillItem[]
  systemSkillIds: string[]
  agentSkillIds: string[]
  projectSkillIds: string[]
  sessionSkillIds: string[]
  agentDisabledSkillIds: string[]
  projectDisabledSkillIds: string[]
  sessionDisabledSkillIds: string[]
  effectiveSkillIds: string[]
}

export interface RuntimePromptConfig {
  system: PromptLayerValue
  agent: PromptLayerValue
  project: PromptLayerValue
  session: PromptLayerValue
  effectivePrompt: string
}

export interface RuntimeCompositionResult {
  skillConfig: RuntimeSkillConfig
  promptConfig: RuntimePromptConfig
  systemPrompt?: string
  skillSystemPrompt?: string
}

const DEFAULT_AGENT_ID = 'code-agent'
const SKILLS_CATEGORY = 'runtime.skills'
const DISABLED_SKILLS_CATEGORY = 'runtime.skills.disabled'
const PROMPTS_CATEGORY = 'runtime.prompts'
const MAX_SKILL_DESCRIPTION_CHARS = 220

export class RuntimeCompositionService {
  private readonly loader: SkillLoader

  constructor(
    private readonly skillRepo: SkillRepository,
    private readonly settingsRepo: SettingsRepository,
  ) {
    this.loader = new SkillLoader(skillRepo)
  }

  getSkillConfig(
    refs: RuntimeScopeRefs = {},
    overrides: RuntimeCompositionOverrides = {},
  ): RuntimeSkillConfig {
    const allInfos = this.loader.listAll()
    const enabledInfos = this.loader.listEnabled()
    const enabledIds = new Set(enabledInfos.map((info) => info.definition?.id ?? info.dbRecord?.id).filter(isString))

    const agentSkillIds = uniqueStrings([
      ...this.getLayerSkillIds('agent', refs.agentId ?? DEFAULT_AGENT_ID),
      ...(overrides.agentSkillIds ?? []),
    ])
    const projectSkillIds = refs.workspaceId != null ? this.getLayerSkillIds('project', refs.workspaceId) : []
    const sessionSkillIds = refs.sessionId != null ? this.getLayerSkillIds('session', refs.sessionId) : []
    const agentDisabledSkillIds = uniqueStrings([
      ...this.getDisabledSkillIds('agent', refs.agentId ?? DEFAULT_AGENT_ID),
      ...(overrides.agentDisabledSkillIds ?? []),
    ])
    const projectDisabledSkillIds = refs.workspaceId != null ? this.getDisabledSkillIds('project', refs.workspaceId) : []
    const sessionDisabledSkillIds = refs.sessionId != null ? this.getDisabledSkillIds('session', refs.sessionId) : []
    const disabledIds = new Set([...agentDisabledSkillIds, ...projectDisabledSkillIds, ...sessionDisabledSkillIds])

    // The agent's configured skills define the base set.
    // If the agent has no skillIds configured (e.g. default code-agent), fall back to all
    // system-enabled skills for backward compatibility. Project and session layers are
    // always additive on top.
    const hasAgentSkillConfig = agentSkillIds.length > 0
    const base = hasAgentSkillConfig ? agentSkillIds : Array.from(enabledIds)
    const ordered = uniqueStrings([
      ...base,
      ...projectSkillIds,
      ...sessionSkillIds,
    ]).filter((id) => enabledIds.has(id) && !disabledIds.has(id))

    return {
      skills: allInfos.map((info) => this.toSkillItem(info)).filter((item): item is SkillItem => item != null),
      systemSkillIds: Array.from(enabledIds),
      agentSkillIds,
      projectSkillIds,
      sessionSkillIds,
      agentDisabledSkillIds,
      projectDisabledSkillIds,
      sessionDisabledSkillIds,
      effectiveSkillIds: ordered,
    }
  }

  updateSkillConfig(
    scope: Exclude<RuntimeLayerScope, 'system'>,
    scopeRef: string,
    skillIds: string[],
    disabledSkillIds?: string[],
  ): RuntimeSkillConfig {
    this.settingsRepo.set(SKILLS_CATEGORY, layerKey(scope, scopeRef), uniqueStrings(skillIds))
    if (disabledSkillIds !== undefined) {
      this.settingsRepo.set(DISABLED_SKILLS_CATEGORY, layerKey(scope, scopeRef), uniqueStrings(disabledSkillIds))
    }
    const refs: RuntimeScopeRefs = {}
    if (scope === 'agent') refs.agentId = scopeRef
    if (scope === 'project') refs.workspaceId = scopeRef
    if (scope === 'session') refs.sessionId = scopeRef
    return this.getSkillConfig(refs)
  }

  getPromptConfig(refs: RuntimeScopeRefs = {}): RuntimePromptConfig {
    const system = this.getPromptLayer('system')
    const agent = this.getPromptLayer('agent', refs.agentId ?? DEFAULT_AGENT_ID)
    const project = refs.workspaceId != null ? this.getPromptLayer('project', refs.workspaceId) : emptyPromptLayer()
    const session = refs.sessionId != null ? this.getPromptLayer('session', refs.sessionId) : emptyPromptLayer()

    const sections: string[] = []
    addPromptSection(sections, 'System Prompt', system)
    addPromptSection(sections, 'Agent Prompt', agent)
    addPromptSection(sections, 'Project Prompt', project)
    addPromptSection(sections, 'Session Prompt', session)

    return {
      system,
      agent,
      project,
      session,
      effectivePrompt: sections.join('\n\n'),
    }
  }

  updatePromptConfig(scope: RuntimeLayerScope, scopeRef: string | undefined, value: PromptLayerValue): RuntimePromptConfig {
    const key = scope === 'system' ? 'system' : layerKey(scope, scopeRef ?? '')
    this.settingsRepo.set(PROMPTS_CATEGORY, key, normalizePromptLayer(value))
    const refs: RuntimeScopeRefs = {}
    if (scope === 'agent' && scopeRef != null) refs.agentId = scopeRef
    if (scope === 'project' && scopeRef != null) refs.workspaceId = scopeRef
    if (scope === 'session' && scopeRef != null) refs.sessionId = scopeRef
    return this.getPromptConfig(refs)
  }

  composeRuntimeContext(
    refs: RuntimeScopeRefs = {},
    explicitSkillPrompt?: string,
    overrides: RuntimeCompositionOverrides = {},
  ): RuntimeCompositionResult {
    const skillConfig = this.getSkillConfig(refs, overrides)
    const promptConfig = this.getPromptConfig(refs)
    const availableSkillsPrompt = this.buildAvailableSkillsPrompt(skillConfig.effectiveSkillIds)
    const skillSections = [explicitSkillPrompt, availableSkillsPrompt].filter((section): section is string => Boolean(section?.trim()))

    const result: RuntimeCompositionResult = {
      skillConfig,
      promptConfig,
    }

    if (promptConfig.effectivePrompt.trim()) {
      result.systemPrompt = promptConfig.effectivePrompt
    }
    if (skillSections.length > 0) {
      result.skillSystemPrompt = skillSections.join('\n\n')
    }
    return result
  }

  private getLayerSkillIds(scope: Exclude<RuntimeLayerScope, 'system'>, scopeRef: string): string[] {
    return normalizeSkillIds(this.settingsRepo.get(SKILLS_CATEGORY, layerKey(scope, scopeRef)))
  }

  private getDisabledSkillIds(scope: Exclude<RuntimeLayerScope, 'system'>, scopeRef: string): string[] {
    return normalizeSkillIds(this.settingsRepo.get(DISABLED_SKILLS_CATEGORY, layerKey(scope, scopeRef)))
  }

  private getPromptLayer(scope: RuntimeLayerScope, scopeRef?: string): PromptLayerValue {
    const key = scope === 'system' ? 'system' : layerKey(scope, scopeRef ?? '')
    return normalizePromptLayer(this.settingsRepo.get(PROMPTS_CATEGORY, key))
  }

  private buildAvailableSkillsPrompt(skillIds: string[]): string {
    const sections: string[] = []
    for (const skillId of skillIds) {
      const info = this.loader.getSkill(skillId)
      if (!info?.definition) continue
      const def = info.definition
      sections.push(`- ${def.id} — ${def.name}: ${truncateInline(def.description, MAX_SKILL_DESCRIPTION_CHARS)}`)
    }

    if (sections.length === 0) return ''
    return [
      '[Available Skills Catalog]',
      'Metadata only. Each entry contains only skill id, name, and description; full instructions are not loaded here.',
      'Decide from this catalog whether a skill is useful. You can choose to load the skills that are helpful for your task execution in the future, and write down in the conversation what skills you have used.',
      sections.join('\n'),
    ].join('\n\n')
  }

  private toSkillItem(info: SkillInfo): SkillItem | null {
    if (info.dbRecord != null) return info.dbRecord
    const def = info.definition
    if (def == null) return null
    const now = new Date(0).toISOString()
    return {
      id: def.id,
      scope: 'system',
      name: def.name,
      version: def.version,
      rootPath: `builtin://${def.id.slice('builtin:'.length)}`,
      manifestJson: JSON.stringify({
        desc: def.description,
        source: '内置',
        author: def.author,
        category: def.category,
        tags: def.tags,
        systemPrompt: def.systemPrompt,
        requiredTools: def.requiredTools,
        parameters: def.parameters,
      }),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }
  }
}

function layerKey(scope: Exclude<RuntimeLayerScope, 'system'>, scopeRef: string): string {
  return `${scope}:${scopeRef}`
}

function normalizeSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueStrings(value.filter(isString))
}

function normalizePromptLayer(value: unknown): PromptLayerValue {
  if (value == null || typeof value !== 'object') return emptyPromptLayer()
  const record = value as Record<string, unknown>
  return {
    enabled: record['enabled'] !== false,
    content: typeof record['content'] === 'string' ? record['content'] : '',
  }
}

function emptyPromptLayer(): PromptLayerValue {
  return { enabled: false, content: '' }
}

function addPromptSection(sections: string[], title: string, layer: PromptLayerValue): void {
  const content = layer.content.trim()
  if (!layer.enabled || !content) return
  sections.push(`[${title}]\n${content}`)
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function truncateInline(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}
