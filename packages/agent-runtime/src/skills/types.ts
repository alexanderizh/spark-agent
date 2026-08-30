/**
 * @module skills/types
 *
 * Skill 定义核心类型
 *
 * 每个 Skill 是一个可复用的 Agent 能力模块，包含：
 *   - 元数据（name, description, category 等）
 *   - system prompt 模板（注入到 Agent 的 system message）
 *   - 依赖的工具列表（requiredTools）
 *   - 参数定义（用户可配置的选项）
 */

/** Skill 分类 */
export type SkillCategory = 'coding' | 'writing' | 'analysis' | 'workflow' | 'utility'

/** Skill 参数类型 */
export type SkillParamType = 'string' | 'number' | 'boolean' | 'select'

/** Skill 参数定义 */
export interface SkillParameter {
  /** 参数名 */
  name: string
  /** 参数类型 */
  type: SkillParamType
  /** 显示标签 */
  label: string
  /** 参数描述 */
  description?: string
  /** 默认值 */
  defaultValue?: unknown
  /** select 类型的可选值 */
  options?: Array<{ label: string; value: string }>
  /** 是否必填 */
  required?: boolean
}

/** Skill 定义（静态元数据 + 行为） */
export interface SkillDefinition {
  /** 唯一 ID（如 "builtin:code-review"） */
  id: string
  /** 显示名称 */
  name: string
  /** 描述 */
  description: string
  /** 版本号 */
  version: string
  /** 作者 */
  author: string
  /** 分类 */
  category: SkillCategory
  /** 图标标识（可选，用于 UI 渲染） */
  icon?: string
  /** 标签 */
  tags: string[]

  /** Skill 的 system prompt 模板 */
  systemPrompt: string

  /** Skill 正常工作所需的工具名列表 */
  requiredTools: string[]

  /** 用户可配置的参数 */
  parameters: SkillParameter[]
}

/** Skill 执行上下文 */
export interface SkillExecutionContext {
  /** 当前会话 ID */
  sessionId: string
  /** 用户传入的参数 */
  params: Record<string, unknown>
  /** 当前使用的模型 */
  model: string
}

/**
 * 从 SkillDefinition 生成完整的 system prompt
 * 将参数默认值填入模板
 */
export function buildSkillSystemPrompt(
  def: SkillDefinition,
  userParams: Record<string, unknown>,
): string {
  let prompt = def.systemPrompt

  // 合并参数（用户值优先，默认值兜底）
  const merged: Record<string, unknown> = {}
  for (const param of def.parameters) {
    merged[param.name] = userParams[param.name] ?? param.defaultValue ?? ''
  }

  // 替换 {{paramName}} 占位符
  for (const [key, value] of Object.entries(merged)) {
    prompt = prompt.replaceAll(`{{${key}}}`, String(value))
  }

  return prompt
}
