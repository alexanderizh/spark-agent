/**
 * @module wiki-tool-contract
 *
 * Wiki 工具契约 — 内置（in-process SDK MCP）与 MCP（stdio 瘦桥）两形态共用。
 *
 * 职责：
 *   - 12 个工具（mcp__spark_wiki__ 命名空间）的名称、描述、入参 schema 单一事实源
 *   - L0 system prompt 片段（≤200 token，递进规则写进提示词作为行为契约）
 *   - 常驻 token 计量（L0 + L0′ ≤ 800 软目标，CI 断言基线）
 *
 * 挂载集（S1）：5 只读 + 6 写 ——
 *   只读 wiki_list_spaces / wiki_search / wiki_read / wiki_list / wiki_backlinks（免审批）
 *   写入 wiki_write / wiki_update / wiki_archive / wiki_delete / wiki_restore / wiki_link（走审批）
 * wiki_propose_skill 属 S3（技能提议区落地后挂载）。
 *
 * 同一会话内置 / MCP 择一挂载（设计原则 4）；工具瘦身（wiki/budget/helpDisclosure）
 * 开启时低频工具收进 wiki_admin 二级入口（§8.3），常驻 schema 只留核心六件套。
 */

import { estimateTokens } from '@spark/shared'

/** MCP server 名称（stdio 形态进程名 / SDK 形态 server key） */
export const SPARK_WIKI_MCP_SERVER_NAME = 'spark_wiki'

/** 工具全名（挂载后 agent 看到的名字）前缀 */
export const WIKI_TOOL_PREFIX = 'mcp__spark_wiki__'

/** 只读工具集（免审批白名单成员）——S0 挂载前三件套，S1 扩展为全 5 只读工具。 */
export const WIKI_READ_TOOL_NAMES = [
  'wiki_list_spaces',
  'wiki_search',
  'wiki_read',
  'wiki_list',
  'wiki_backlinks',
] as const

/** 只读工具全集（= 当前挂载的全部只读工具） */
export const WIKI_ALL_READ_TOOL_NAMES = [...WIKI_READ_TOOL_NAMES] as const

/** 写工具集（走 canUseTool 审批，不进白名单） */
export const WIKI_WRITE_TOOL_NAMES = [
  'wiki_write',
  'wiki_update',
  'wiki_archive',
  'wiki_delete',
  'wiki_restore',
  'wiki_link',
] as const

/** S3 起追加的写工具（技能提议区落地后挂载；契约已冻结） */
export const WIKI_S3_TOOL_NAMES = ['wiki_propose_skill'] as const

/**
 * 核心工具（工具瘦身开启时仍常驻）—— 覆盖「找空间 → 找到 → 读 → 写 → 浏览」主链路。
 *
 * 组成 = 方案 §8.3 规定的首屏四件套（search / read / write / list）
 *      + wiki_list_spaces（写入前必须知道目标空间 id，否则首屏不可用）
 *      + wiki_admin（低频工具的二级入口，本身占一份 schema）。
 * 预算校验见 wiki-context-budget.test.ts：该组合必须 ≤ 800 token 软目标。
 */
export const WIKI_CORE_TOOL_NAMES = [
  'wiki_list_spaces',
  'wiki_search',
  'wiki_read',
  'wiki_list',
  'wiki_write',
] as const

/**
 * 低频工具（工具瘦身开启时收进 wiki_admin 二级入口）。
 * 能力不消失，只是不再各占一份常驻 schema。
 */
export const WIKI_DEFERRED_TOOL_NAMES = [
  'wiki_update',
  'wiki_backlinks',
  'wiki_archive',
  'wiki_restore',
  'wiki_delete',
  'wiki_link',
  // S3：技能提议是低频动作（知识沉淀成技能是偶发决策），同样收进二级入口
  'wiki_propose_skill',
] as const

/** 二级入口工具名（工具瘦身开启时挂载） */
export const WIKI_ADMIN_TOOL_NAME = 'wiki_admin'

export interface WikiMountPlan {
  /** 直接挂载（对模型可见 schema）的工具名 */
  toolNames: string[]
  /** 是否挂载 wiki_admin 二级入口 */
  admin: boolean
}

/**
 * 根据设置档位决定挂载集（§8.3）。
 * @param helpDisclosure wiki/budget/helpDisclosure（true = 低频工具收进二级入口）
 */
export function resolveWikiMountPlan(helpDisclosure: boolean): WikiMountPlan {
  const all: string[] = [
    ...WIKI_ALL_READ_TOOL_NAMES,
    ...WIKI_WRITE_TOOL_NAMES,
    ...WIKI_S3_TOOL_NAMES,
  ]
  if (!helpDisclosure) return { toolNames: all, admin: false }
  const core: readonly string[] = WIKI_CORE_TOOL_NAMES
  return { toolNames: all.filter((n) => core.includes(n)), admin: true }
}

/**
 * L0 能力声明（system prompt 固定片段，≤200 token）。
 * 递进规则原文（方案 §8.1）：先 search 拿 id+摘要 → 确需全文才 read；
 * 禁止凭标题臆测；不一次读多页；读完即总结。
 */
export const WIKI_L0_PROMPT = [
  'wiki_* = 可检索的知识库（空间/页面/双链）。',
  '仅在自动注入的记忆摘要不足以回答、或需要沉淀/复用成篇知识时使用。',
  '取用顺序：wiki_list_spaces → wiki_search（拿 id + 摘要）→ 只在确需全文时 wiki_read(id)。',
  '禁止凭标题臆测内容；不要一次读多页；读完即总结，避免重复读取。',
].join('\n')

/** 工具描述（描述只写"何时用 + 返回什么"，不写字段枚举长文） */
export interface WikiToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const WIKI_TOOL_DEFINITIONS: readonly WikiToolDefinition[] = [
  {
    name: 'wiki_list_spaces',
    description:
      '列出当前会话可访问的知识库空间（每空间一行：id+名称+页面数）。开始取用 wiki 前先看有哪些空间。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'wiki_search',
    description:
      '按关键词检索知识库页面（FTS 全文，中英文均可）。只返回 id+标题+摘要+标签，不返回正文；需要全文时再用 wiki_read。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词（1-500 字符）。' },
        space_id: { type: 'string', description: '限定检索的空间 id。' },
        limit: { type: 'number', description: '条数上限，默认 8，最大 20。' },
      },
      required: ['query'],
    },
  },
  {
    name: 'wiki_read',
    description:
      '读取一个知识页面的正文（默认单页 ≤3000 token）。超长页返回 truncated + nextOffset，传 offset 续读。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '页面 id。' },
        offset: { type: 'number', description: '续读偏移。' },
      },
      required: ['id'],
    },
  },
  {
    name: 'wiki_list',
    description:
      '列出一个空间内的页面目录树（每节点 id+标题+类型+有无子节点，无正文摘要）。浏览结构时用。',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: '空间 id。' },
        parent_id: { type: 'string', description: '父节点 id（缺省根层）。' },
      },
      required: ['space_id'],
    },
  },
  {
    name: 'wiki_backlinks',
    description: '查一个页面的反向链接（谁引用了它，每边一行）。追溯知识关联时用。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '页面 id。' } },
      required: ['id'],
    },
  },
  // ── 写工具（S1 挂载，契约冻结） ──
  {
    name: 'wiki_write',
    description: '在知识库新建页面。回执只含 id/title/version，不回显正文。',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: '目标空间 id。' },
        title: { type: 'string', description: '页面标题。' },
        body: { type: 'string', description: 'Markdown 正文。' },
        kind: {
          type: 'string',
          enum: ['knowledge', 'experience', 'pattern', 'reference', 'note'],
          description: '默认 knowledge。',
        },
        summary: { type: 'string', description: '摘要。' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
      },
      required: ['space_id', 'title', 'body'],
    },
  },
  {
    name: 'wiki_update',
    description: '更新页面（CAS：带 expectedVersion，失配拒绝并回传当前版本）。回执不含正文。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '页面 id。' },
        expected_version: { type: 'number', description: 'CAS 期望版本。' },
        title: { type: 'string', description: '新标题（须带 body）。' },
        body: { type: 'string', description: '新正文。' },
        summary: { type: 'string', description: '新摘要（须带 body）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '新标签。' },
      },
      required: ['id', 'expected_version'],
    },
  },
  {
    name: 'wiki_archive',
    description: '归档页面（可恢复，非物理删除；经 wiki_restore 还原）。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '页面 id。' } },
      required: ['id'],
    },
  },
  {
    name: 'wiki_restore',
    description: '取消归档：恢复为 published 并重建双链。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '页面 id。' } },
      required: ['id'],
    },
  },
  {
    name: 'wiki_delete',
    description: '物理删除页面（进入删除屏障，清理正文与版本快照；不可恢复）。仅在明确要求时使用。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '页面 id。' } },
      required: ['id'],
    },
  },
  {
    name: 'wiki_link',
    description: '建立/移除两个页面的显式关联（reference 边）。正文内 [[标题]] 自动建 wiki 边。',
    inputSchema: {
      type: 'object',
      properties: {
        from_id: { type: 'string', description: '来源页面 id。' },
        to_id: { type: 'string', description: '目标页面 id。' },
        remove: { type: 'boolean', description: 'true = 移除。' },
      },
      required: ['from_id', 'to_id'],
    },
  },
  {
    name: 'wiki_propose_skill',
    description: '从知识页提议技能（只写提议区，不创建；须经用户确认）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名称。' },
        purpose: { type: 'string', description: '创建目的与要解决的问题。' },
        source_page_ids: { type: 'array', items: { type: 'string' }, description: '溯源页面 id。' },
        skill_draft: { type: 'string', description: 'SKILL.md 草稿。' },
      },
      required: ['name', 'purpose', 'source_page_ids', 'skill_draft'],
    },
  },
  {
    name: WIKI_ADMIN_TOOL_NAME,
    description:
      '知识库低频入口。tool 取 enum 中的子工具名，args 传其入参：' +
      'wiki_update(id,expected_version)、wiki_backlinks(id)、wiki_archive(id)、' +
      'wiki_restore(id)、wiki_delete(id)、wiki_link(from_id,to_id)、' +
      'wiki_propose_skill(name,purpose,source_page_ids,skill_draft)。',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: [...WIKI_DEFERRED_TOOL_NAMES] },
        args: { type: 'object' },
      },
      required: ['tool'],
    },
  },
] as const

/**
 * L0′ 常驻 schema token 计量（CI 断言基线）。
 * 只计挂载子集的 name + description + inputSchema（system prompt 里的实际成本）。
 */
export function measureWikiResidentTokens(toolNames: readonly string[]): {
  l0Prompt: number
  l0Prime: number
  total: number
} {
  const l0Prompt = estimateTokens(WIKI_L0_PROMPT)
  const definitions = WIKI_TOOL_DEFINITIONS.filter((d) => toolNames.includes(d.name))
  const l0Prime = definitions.reduce(
    (sum, d) =>
      sum +
      estimateTokens(
        JSON.stringify({ name: d.name, description: d.description, inputSchema: d.inputSchema }),
      ),
    0,
  )
  return { l0Prompt, l0Prime, total: l0Prompt + l0Prime }
}

/** S0 挂载集（三只读）的常驻 token —— 历史基线，供回归对照 */
export const WIKI_S0_TOOL_NAMES = ['wiki_list_spaces', 'wiki_search', 'wiki_read'] as const

export function measureS0ResidentTokens(): number {
  return measureWikiResidentTokens(WIKI_S0_TOOL_NAMES).total
}

/** 按挂载计划计量常驻 token（含 wiki_admin 二级入口的 schema）。 */
export function measurePlanResidentTokens(plan: WikiMountPlan): number {
  const names = plan.admin ? [...plan.toolNames, WIKI_ADMIN_TOOL_NAME] : plan.toolNames
  return measureWikiResidentTokens(names).total
}

/** S1 默认（全量挂载）的常驻 token */
export function measureS1ResidentTokens(): number {
  return measurePlanResidentTokens(resolveWikiMountPlan(false))
}

/** 工具瘦身开启时的常驻 token（与全量挂载对照，验证瘦身收益） */
export function measureSlimResidentTokens(): number {
  return measurePlanResidentTokens(resolveWikiMountPlan(true))
}

/** 全量挂载（含所有已冻结契约工具）的常驻 token —— 预算上界的参照 */
export function measureFullResidentTokens(): number {
  return measureWikiResidentTokens([
    ...WIKI_ALL_READ_TOOL_NAMES,
    ...WIKI_WRITE_TOOL_NAMES,
    ...WIKI_S3_TOOL_NAMES,
  ]).total
}
