/**
 * @module wiki-repo-enrich-prompt
 *
 * Repo Wiki AI 导读的提示词与输出校验（方案B §6.2）—— 纯函数、可单测。
 *
 * 范式对齐 wiki-extraction-prompt（「prompt 约束 + 本地严格解析」）：
 * 输出是**纯 markdown 段**（非 JSON，兼容面最广），硬约束写进 prompt，
 * 校验失败一律作废该页（status='failed'），绝不猜内容。
 *
 * 三条硬约束：
 *   1. 固定三小节 `## 模块职责` / `## 关键入口` / `## 依赖关系`；
 *   2. 总长 ≤1500 字符（导读是补充层，不是正文）；
 *   3. 禁止 `[[...]]` 双链语法（AI 段不进 wiki_link 图谱，引用一律反引号）。
 */

/** 导读段总长上限（§6.2） */
export const WIKI_REPO_ENRICH_MAX_SECTION_CHARS = 1500

/** 固定三小节标题（校验必需） */
export const WIKI_REPO_ENRICH_REQUIRED_SECTIONS = [
  '## 模块职责',
  '## 关键入口',
  '## 依赖关系',
] as const

export type WikiRepoEnrichValidationReason = 'empty' | 'too_long' | 'missing_section' | 'wiki_link'

export type WikiRepoEnrichValidation =
  | { ok: true; section: string }
  | { ok: false; reason: WikiRepoEnrichValidationReason }

export const WIKI_REPO_ENRICH_SYSTEM_PROMPT = [
  '你是代码仓库文档工程师。任务：依据给定的模块结构材料，为该模块写一段「AI 导读」，帮助读者在阅读统计性骨架页之前快速建立心智模型。',
  '',
  '输出要求（严格遵守）：',
  '- 只输出一段纯 Markdown，不要代码围栏、不要开场白与结束语。',
  '- 固定三个小节，顺序与标题一字不差：`## 模块职责`、`## 关键入口`、`## 依赖关系`。',
  '- 每小节 1-4 行要点；全文总长不超过 ' +
    `${WIKI_REPO_ENRICH_MAX_SECTION_CHARS} 字符。`,
  '- 只依据给定材料：文件清单、入口文件内容、依赖提示。禁止编造材料中未出现的文件路径、模块名或依赖。',
  '- 不确定的地方直接写「未从材料中确认」，不要猜测。',
  '- 引用文件路径、目录、包名一律用反引号代码格式；禁止使用 `[[...]]` 双链语法。',
  '- 「依赖关系」区分两类：对兄弟模块的内部依赖（来自 import 提示）与对外部包的依赖（来自 dependencies），材料不足的类别如实说明。',
].join('\n')

export function buildModuleEnrichPrompt(material: string): string {
  return [
    '请依据以下材料，为该模块生成「AI 导读」段（按系统提示的输出要求）：',
    '',
    material,
  ].join('\n')
}

/**
 * 校验模型输出的导读段。
 *
 * 四条拒绝路径：空 / 超长 / 缺必需小节 / 含 `[[`（双链强拦）。
 * 通过时返回 trim 后的 section（入库形态）。
 */
export function validateEnrichSection(raw: string): WikiRepoEnrichValidation {
  const section = raw.trim()
  if (section.length === 0) return { ok: false, reason: 'empty' }
  if (section.length > WIKI_REPO_ENRICH_MAX_SECTION_CHARS) {
    return { ok: false, reason: 'too_long' }
  }
  for (const heading of WIKI_REPO_ENRICH_REQUIRED_SECTIONS) {
    if (!section.includes(heading)) return { ok: false, reason: 'missing_section' }
  }
  if (section.includes('[[')) return { ok: false, reason: 'wiki_link' }
  return { ok: true, section }
}
