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

export interface EnvVarItem {
  key: string
  value: string
  description?: string
}

export interface EnvVarLayerValue {
  enabled: boolean
  vars: EnvVarItem[]
}

export interface RuntimeEnvConfig {
  project: EnvVarLayerValue
  session: EnvVarLayerValue
  /** 合并后生效的环境变量（会话级覆盖项目级），真实值，用于注入子进程环境。 */
  effectiveEnv: Record<string, string>
  /** 脱敏后的环境变量清单（键名/描述/掩码值），作为系统提示词段注入；无变量时为空串。 */
  envSystemPrompt: string
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
  /** 合并后生效的自定义环境变量（真实值），由调用方注入子进程环境。 */
  customEnv?: Record<string, string>
  /** 脱敏后的环境变量清单（含键名/描述/掩码值），作为系统提示词段注入。 */
  envSystemPrompt?: string
}

const DEFAULT_AGENT_ID = 'platform-manager-agent'
const SKILLS_CATEGORY = 'runtime.skills'
const DISABLED_SKILLS_CATEGORY = 'runtime.skills.disabled'
const PROMPTS_CATEGORY = 'runtime.prompts'
const ENV_CATEGORY = 'runtime.env'
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

    // 内置技能（builtin:*）对所有 agent 默认可用，无需显式绑定：把已启用的内置 id
    // 始终并入 base。仍会经下方 enabledIds/disabledIds 过滤，故用户显式禁用仍生效。
    const builtinIds = Array.from(enabledIds).filter((id) => id.startsWith('builtin:'))

    // The agent's configured skills define the base set.
    // If the agent has no skillIds configured, fall back to all
    // system-enabled skills for backward compatibility. Project and session layers are
    // always additive on top. Built-in skills are always included on top.
    const hasAgentSkillConfig = agentSkillIds.length > 0
    const base = hasAgentSkillConfig
      ? uniqueStrings([...builtinIds, ...agentSkillIds])
      : Array.from(enabledIds)
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

  getEnvConfig(refs: RuntimeScopeRefs = {}): RuntimeEnvConfig {
    const project = refs.workspaceId != null ? this.getEnvLayer('project', refs.workspaceId) : emptyEnvLayer()
    const session = refs.sessionId != null ? this.getEnvLayer('session', refs.sessionId) : emptyEnvLayer()

    // 会话级覆盖项目级：先铺项目层，再用会话层同名键覆盖。
    const merged = new Map<string, EnvVarItem>()
    for (const layer of [project, session]) {
      if (!layer.enabled) continue
      for (const item of layer.vars) {
        const key = item.key.trim()
        if (key.length === 0) continue
        merged.set(key, item)
      }
    }
    const effectiveEnv: Record<string, string> = {}
    for (const [key, item] of merged) effectiveEnv[key] = item.value

    return {
      project,
      session,
      effectiveEnv,
      envSystemPrompt: buildEnvSystemPrompt(Array.from(merged.values())),
    }
  }

  updateEnvConfig(
    scope: Extract<RuntimeLayerScope, 'project' | 'session'>,
    scopeRef: string,
    value: EnvVarLayerValue,
  ): RuntimeEnvConfig {
    this.settingsRepo.set(ENV_CATEGORY, layerKey(scope, scopeRef), normalizeEnvLayer(value))
    const refs: RuntimeScopeRefs = {}
    if (scope === 'project') refs.workspaceId = scopeRef
    if (scope === 'session') refs.sessionId = scopeRef
    return this.getEnvConfig(refs)
  }

  composeRuntimeContext(
    refs: RuntimeScopeRefs = {},
    explicitSkillPrompt?: string,
    overrides: RuntimeCompositionOverrides = {},
  ): RuntimeCompositionResult {
    const skillConfig = this.getSkillConfig(refs, overrides)
    const promptConfig = this.getPromptConfig(refs)
    const envConfig = this.getEnvConfig(refs)
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
    if (Object.keys(envConfig.effectiveEnv).length > 0) {
      result.customEnv = envConfig.effectiveEnv
      if (envConfig.envSystemPrompt.trim()) result.envSystemPrompt = envConfig.envSystemPrompt
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

  private getEnvLayer(scope: Exclude<RuntimeLayerScope, 'system'>, scopeRef: string): EnvVarLayerValue {
    return normalizeEnvLayer(this.settingsRepo.get(ENV_CATEGORY, layerKey(scope, scopeRef)))
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
      'Metadata only. Each entry contains only skill id, name, and description; full instructions are NOT loaded here (progressive disclosure).',
      'When a skill looks useful for the current task, load its full instructions on demand by calling the `mcp__spark_platform__skills_load` tool with the skill `id`, then follow the returned instructions. (When the native Skill tool is available it achieves the same.) Note in the conversation which skills you used.',
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

function normalizeEnvLayer(value: unknown): EnvVarLayerValue {
  if (value == null || typeof value !== 'object') return emptyEnvLayer()
  const record = value as Record<string, unknown>
  const rawVars = Array.isArray(record['vars']) ? record['vars'] : []
  const vars: EnvVarItem[] = []
  const seen = new Set<string>()
  for (const raw of rawVars) {
    if (raw == null || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const key = typeof item['key'] === 'string' ? item['key'].trim() : ''
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    vars.push({
      key,
      value: typeof item['value'] === 'string' ? item['value'] : '',
      ...(typeof item['description'] === 'string' && item['description'].trim().length > 0
        ? { description: item['description'].trim() }
        : {}),
    })
  }
  return {
    enabled: record['enabled'] !== false,
    vars,
  }
}

function emptyEnvLayer(): EnvVarLayerValue {
  return { enabled: false, vars: [] }
}

/**
 * 脱敏单个密钥值：仅保留首尾各 1 个字符以提示「确实配置了值」，中间统一打码；
 * 长度 < 4 时完全打码，避免泄露过短的敏感值。空值返回 (空)。
 */
function maskSecret(value: string): string {
  if (value.length === 0) return '(空)'
  if (value.length < 4) return '****'
  return `${value[0]}***${value[value.length - 1]} (${value.length} 字符)`
}

/**
 * 构建注入系统提示词的「环境变量」段：只暴露键名、描述、脱敏后的值，绝不暴露真实值。
 * 告知 agent 这些变量已注入运行环境，应通过变量名引用（$KEY / process.env.KEY），
 * 不得在输出中打印真实值或要求用户重新提供。
 */
function buildEnvSystemPrompt(items: EnvVarItem[]): string {
  if (items.length === 0) return ''

  const lines = items.map((item) => {
    const desc = item.description != null && item.description.length > 0 ? ` — ${item.description}` : ''
    return `- ${item.key}${desc}（值已脱敏: ${maskSecret(item.value)}）`
  })

  return [
    '[Environment Variables]',
    '以下环境变量已注入你的运行环境（子进程 env）。这里显示的值经过脱敏，仅用于让你知道这些变量存在及其用途。',
    '使用时请通过变量名引用真实值（shell 中用 $KEY，代码中用 process.env.KEY 等），不要在回复或日志中打印真实值，也不要要求用户重新提供这些敏感信息。',
    lines.join('\n'),
  ].join('\n\n')
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
