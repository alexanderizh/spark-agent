/**
 * 远程输入区的「配置条」数据源（纯函数，可单测）。
 *
 * 目标端 /v1/catalog 提供 agents / providers+models / permissionModes，
 * /v1/sessions/:id/runtime 提供当前会话的生效配置。这里只做「目录 + 运行时」
 * 到「下拉选项 + chip 文案」的映射，不发请求、不持状态。
 *
 * 设计约束：
 *   - 目标端是旧版（没有 /v1/catalog）时，调用方拿到 null 目录，chips 整体隐藏，
 *     不能因为目录缺失就把输入区打残；
 *   - 权限档位的中文标签复用桌面端 permission-options，避免同一语义两套文案。
 */
import type {
  MobileBridgeCatalog,
  MobileBridgeSessionRuntime,
  SessionAgentAdapter,
} from '@spark/protocol'
import { REASONING_EFFORT_OPTIONS } from '../chat/reasoning-effort-options'
import { getPermissionModeOptions } from '../../utils/permission-options'

export type RemoteOptionTone = 'default' | 'auto' | 'danger'

/** 下拉项（助手 / 权限 / 模型共用一套渲染） */
export interface RemoteSelectOption {
  id: string
  label: string
  description?: string
  tone?: RemoteOptionTone
  selected?: boolean
}

/** 模型选项需要额外携带写回 PATCH 的两个字段 */
export interface RemoteModelOption extends RemoteSelectOption {
  providerProfileId: string
  /** null = 渠道自动路由 / 渠道默认模型 */
  modelId: string | null
  /** 不带渠道前缀的短名（下拉已按渠道分组，重复渠道名只会挤长一行） */
  shortLabel: string
}

/** 目标端没配助手时的兜底文案 */
export const REMOTE_DEFAULT_AGENT_LABEL = '默认助手'
/** runtime 缺字段时的兜底文案 */
export const REMOTE_DEFAULT_MODEL_LABEL = '电脑默认模型'
export const REMOTE_DEFAULT_PERMISSION_LABEL = '电脑默认'
/** 会话没显式设推理强度 = 跟随电脑端默认（与权限同义，但 chip 上避免两处都写「电脑默认」） */
export const REMOTE_DEFAULT_REASONING_LABEL = '默认'

/** 当前会话实际生效的 adapter（助手目录 → 运行时 → 兜底 claude） */
export function resolveAdapter(
  catalog: MobileBridgeCatalog | null,
  runtime: MobileBridgeSessionRuntime | null,
): string {
  const fromRuntime = runtime?.agentAdapter?.trim()
  if (fromRuntime) return fromRuntime
  const defaultAgent = catalog?.agents.find((agent) => agent.isDefault)
  return defaultAgent?.agentAdapter ?? 'claude'
}

export function buildAgentOptions(
  catalog: MobileBridgeCatalog | null,
  runtime: MobileBridgeSessionRuntime | null,
): RemoteSelectOption[] {
  if (catalog == null) return []
  const current = runtime?.agentId ?? null
  return catalog.agents.map((agent) => ({
    id: agent.id,
    label: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    selected: agent.id === current,
  }))
}

/**
 * 模型选项：先按渠道分组渲染（label 用渠道名），单模型项用「渠道 · 模型」。
 * 自动路由渠道与无模型渠道各给一条「默认模型」项（modelId = null）。
 */
export function buildModelOptions(
  catalog: MobileBridgeCatalog | null,
  runtime: MobileBridgeSessionRuntime | null,
): RemoteModelOption[] {
  if (catalog == null) return []
  const options: RemoteModelOption[] = []
  for (const provider of catalog.providers) {
    const selectedProvider = runtime?.providerProfileId === provider.id
    if (provider.isAutoRouter || provider.models.length === 0) {
      const shortLabel = provider.isAutoRouter ? '自动路由' : '默认模型'
      options.push({
        id: `${provider.id}::`,
        label: `${provider.name} · ${shortLabel}`,
        shortLabel,
        ...(provider.isAutoRouter ? { description: '由电脑端自动挑选模型' } : {}),
        providerProfileId: provider.id,
        modelId: null,
        selected: selectedProvider && (runtime?.modelId ?? null) === null,
      })
      continue
    }
    for (const model of provider.models) {
      options.push({
        id: `${provider.id}::${model.id}`,
        label: `${provider.name} · ${model.name}`,
        shortLabel: model.name,
        providerProfileId: provider.id,
        modelId: model.id,
        selected: selectedProvider && runtime?.modelId === model.id,
      })
    }
  }
  return options
}

/**
 * 权限选项：以目标端给出的合法档位为准（catalog.permissionModes[adapter]），
 * 标签/语气复用桌面端 permission-options；目录里没有该 adapter 就返回空数组，
 * 调用方据此隐藏权限 chip。
 */
export function buildPermissionOptions(
  catalog: MobileBridgeCatalog | null,
  adapter: string,
  current: string | null | undefined,
): RemoteSelectOption[] {
  const modes = catalog?.permissionModes?.[adapter] ?? []
  if (modes.length === 0) return []
  const known = getPermissionModeOptions(adapter as SessionAgentAdapter)
  return modes.map((mode) => {
    const meta = known.find((option) => option.value === mode)
    return {
      id: mode,
      label: meta?.label ?? mode,
      ...(meta?.description ? { description: meta.description } : {}),
      tone: meta?.tone ?? 'default',
      selected: mode === current,
    }
  })
}

/**
 * 推理强度选项：档位以目标端 catalog.reasoningEfforts 为准，中文标签复用桌面端
 * REASONING_EFFORT_OPTIONS，避免同一档位两套文案。
 * 目录缺失或目标端没给枚举（旧版）时返回空数组，调用方据此隐藏 chip。
 */
export function buildReasoningOptions(
  catalog: MobileBridgeCatalog | null,
  runtime: MobileBridgeSessionRuntime | null,
): RemoteSelectOption[] {
  const efforts = catalog?.reasoningEfforts ?? []
  if (efforts.length === 0) return []
  const current = runtime?.reasoningEffort ?? null
  return efforts.map((effort) => {
    const meta = REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)
    return {
      id: effort,
      label: meta?.label ?? effort,
      ...(meta?.description ? { description: meta.description } : {}),
      selected: effort === current,
    }
  })
}

/** 助手 chip 文案 */
export function agentLabel(
  catalog: MobileBridgeCatalog | null,
  runtime: MobileBridgeSessionRuntime | null,
): string {
  const id = runtime?.agentId ?? null
  if (id == null) return REMOTE_DEFAULT_AGENT_LABEL
  return catalog?.agents.find((agent) => agent.id === id)?.name ?? REMOTE_DEFAULT_AGENT_LABEL
}

/** 模型 chip 文案：优先模型名，其次「渠道名」，都缺就兜底 */
export function modelLabel(
  catalog: MobileBridgeCatalog | null,
  runtime: MobileBridgeSessionRuntime | null,
): string {
  const providerId = runtime?.providerProfileId ?? null
  if (providerId == null) return REMOTE_DEFAULT_MODEL_LABEL
  const provider = catalog?.providers.find((item) => item.id === providerId) ?? null
  const modelId = runtime?.modelId ?? null
  if (modelId != null) {
    const model = provider?.models.find((item) => item.id === modelId)
    if (model != null) return model.name
    // 渠道目录里找不到（模型被下线/切走）时别把裸 id 当名字，回退渠道名
    return provider != null ? `${provider.name} · 自定义模型` : modelId
  }
  if (provider == null) return REMOTE_DEFAULT_MODEL_LABEL
  return provider.isAutoRouter ? `${provider.name} · 自动` : `${provider.name} · 默认`
}

/** 权限 chip 文案 + 是否高危（高危档用警示色，与桌面端 composer 一致） */
export function permissionLabel(
  catalog: MobileBridgeCatalog | null,
  runtime: MobileBridgeSessionRuntime | null,
): { label: string; danger: boolean } {
  const adapter = resolveAdapter(catalog, runtime)
  const current = runtime?.permissionMode ?? null
  if (current == null) return { label: REMOTE_DEFAULT_PERMISSION_LABEL, danger: false }
  const option = buildPermissionOptions(catalog, adapter, current).find(
    (item) => item.id === current,
  )
  if (option == null) {
    // 目录缺失（旧版目标端）：按裸值显示，不带语气色，避免误报高危
    return { label: current, danger: false }
  }
  return { label: option.label, danger: option.tone === 'danger' }
}

/**
 * 推理强度 chip 文案。
 * 目标端可能比桌面端新（多出未收录的档位）：认不出就按裸值显示，不吞掉；
 * runtime 没给值说明会话走电脑端默认，按兜底文案展示。
 */
export function reasoningLabel(runtime: MobileBridgeSessionRuntime | null): string {
  const current = runtime?.reasoningEffort ?? null
  if (current == null) return REMOTE_DEFAULT_REASONING_LABEL
  const known = REASONING_EFFORT_OPTIONS.find((option) => option.value === current)
  return known?.label ?? current
}

export interface SlashTrigger {
  /** token 在文本中的起点（含 /） */
  start: number
  /** 光标位置 */
  end: number
  /** / 之后的查询串（可为空） */
  query: string
}

/**
 * 光标处是否处于 / 命令补全状态。
 * 只有 token 位于行首或空白之后才算，且 token 内不能再出现 / ——
 * 否则输入绝对路径（/Users/me）会弹出命令列表。
 */
export function slashTriggerAt(text: string, caret: number): SlashTrigger | null {
  if (caret < 0 || caret > text.length) return null
  const before = text.slice(0, caret)
  const tokenStart = Math.max(
    before.lastIndexOf(' '),
    before.lastIndexOf('\n'),
    before.lastIndexOf('\t'),
  )
  const start = tokenStart + 1
  const token = before.slice(start)
  if (!token.startsWith('/')) return null
  const query = token.slice(1)
  // 命令名只允许常见字符；出现 / 说明是路径，过长说明是在写正文，都放弃
  if (query.length > 32 || !/^[A-Za-z0-9_:.-]*$/.test(query)) return null
  return { start, end: caret, query }
}

/** 命令 / 技能列表按前缀过滤（名称优先，其次描述包含） */
export function filterRemoteCommands<T extends { name: string; description?: string }>(
  commands: T[],
  query: string,
  limit = 8,
): T[] {
  const keyword = query.trim().toLowerCase()
  if (keyword.length === 0) return commands.slice(0, limit)
  const prefix: T[] = []
  const contains: T[] = []
  for (const command of commands) {
    const name = command.name.toLowerCase()
    if (name.startsWith(keyword)) prefix.push(command)
    else if (
      name.includes(keyword) ||
      (command.description ?? '').toLowerCase().includes(keyword)
    ) {
      contains.push(command)
    }
  }
  return [...prefix, ...contains].slice(0, limit)
}

/** 用选中的命令替换光标处 token，返回新文本与落点 */
export function applyCommandPick(
  text: string,
  trigger: SlashTrigger,
  name: string,
): { text: string; caret: number } {
  const inserted = `/${name} `
  const next = text.slice(0, trigger.start) + inserted + text.slice(trigger.end)
  return { text: next, caret: trigger.start + inserted.length }
}
