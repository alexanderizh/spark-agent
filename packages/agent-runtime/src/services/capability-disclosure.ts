/**
 * 能力引导渐进式披露（Capability Progressive Disclosure）。
 *
 * 与技能目录（buildAvailableSkillsPrompt + skills_load）同构：
 * - 常驻注入的只有 `[Capability Catalog]` 目录段（id + 一句话触发描述）与
 *   各能力的动态状态行（computer-use 可用性、媒体路由摘要等，见各 status builder）；
 * - 完整使用手册由 `mcp__spark_platform__capability_load`（bridge method
 *   `capabilities.load`）按需加载，加载正文与本文件注册表共享同一事实源。
 *
 * 分层原则（详见 todo/能力引导渐进式披露方案.md）：
 * - Tier A 行为契约（作用于每一轮、模型无法自主判断加载时机）保持常驻注入，不在此处；
 * - Tier B 能力手册（由可识别任务意图触发）在此注册，手册常驻改为目录 + 按需加载。
 *
 * 注意：新增能力时同步维护 CAPABILITY_IDS / CATALOG_DESCRIPTIONS /
 * CAPABILITY_GUIDES 三处，并在 platform-management-mcp-server.mjs 的
 * capability_load 工具描述中确认 id 枚举提示仍然准确。
 *
 * 加载手段门控（M-1 纪律：目录可见必须有加载手段）：目录条目与 statusPrompt
 * 的 load 指引仅在 spark_platform 已挂载（capability_load 真实可用）时出现；
 * 否则组装点（session.service.ts）回退为手册全文常驻注入，任何 MCP 白名单
 * 组合下使用手册都不丢失。
 */

import { BROWSER_AUTOMATION_SYSTEM_PROMPT } from './browser-automation-prompt.js'
import { buildComputerUsePlaybookPrompt } from '../computer-use/computer-use-system-prompt.js'
import { MEDIA_GENERATION_GUIDE_PROMPT } from './media/media-mcp-contract.js'
import {
  IMAGE_GENERATION_GUIDE_PROMPT,
  RENDER_DIAGRAM_SYSTEM_PROMPT,
  RENDER_HTML_SYSTEM_PROMPT,
} from './session-mcp-tooling-helpers.js'
import { SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT } from './session-schedule-agent-tools.js'

export const CAPABILITY_IDS = [
  'computer-use',
  'browser-automation',
  'media-generation',
  'image-generation',
  'session-schedule',
  'render-html',
  'render-diagram',
] as const

export type CapabilityId = (typeof CAPABILITY_IDS)[number]

/** 目录条目的一句话触发描述（何时用 + 首次使用前先 load）。 */
const CATALOG_DESCRIPTIONS: Record<CapabilityId, string> = {
  'computer-use':
    'Operate real desktop apps: read the screen (element tree / screenshot), semantic click & type, delegate long tasks via start_task. Load before first use of `mcp__spark_computer__*` tools.',
  'browser-automation':
    'Visible in-app browser window automation: navigate, inject persistent scripts, capture console, observe/intercept network (spark_browser). Load before first use of `mcp__spark_browser__*` tools.',
  'media-generation':
    'Text-to-image / image edit / video / speech / transcription via spark_media. MUST load before the first generate_image / edit_image / generate_video / generate_audio / transcribe_audio call, then describe_model first.',
  'image-generation':
    'Image generation via the legacy spark_image route. Load before the first `mcp__spark_image__generate_image` call.',
  'session-schedule':
    'Durable scheduled wake-ups for this session (interval / cron / once) — e.g. polling a long-running third-party job. Load before first use of `session_schedule_*` tools.',
  'render-html':
    'Render an HTML fragment inline in the conversation for diagrams, visual comparisons, or compact interactive demos. Load before the first `render_html` call.',
  'render-diagram':
    'Render mind maps and standard Mermaid charts inline (cheaper than hand-written HTML). Load before the first `render_diagram` call.',
}

/** capability_load 的加载正文（单一事实源，直接复用各能力现有提示词常量）。 */
const CAPABILITY_GUIDES: Record<CapabilityId, string> = {
  'computer-use': buildComputerUsePlaybookPrompt(),
  'browser-automation': BROWSER_AUTOMATION_SYSTEM_PROMPT,
  'media-generation': MEDIA_GENERATION_GUIDE_PROMPT,
  'image-generation': IMAGE_GENERATION_GUIDE_PROMPT,
  'session-schedule': SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT,
  'render-html': RENDER_HTML_SYSTEM_PROMPT,
  'render-diagram': RENDER_DIAGRAM_SYSTEM_PROMPT,
}

const VALID_IDS_SUMMARY = CAPABILITY_IDS.join(', ')

export function isCapabilityId(id: string): id is CapabilityId {
  return (CAPABILITY_IDS as readonly string[]).includes(id)
}

/**
 * capability_load 的解析入口（bridge `capabilities.load` handler 调用）。
 * 未知 id 抛出带合法枚举的错误，方便模型自纠。
 */
export function resolveCapabilityGuide(rawId: string): { id: CapabilityId; guide: string } {
  const id = rawId.trim()
  if (!isCapabilityId(id)) {
    throw new Error(`Unknown capability id "${rawId}". Valid ids: ${VALID_IDS_SUMMARY}`)
  }
  const guide = CAPABILITY_GUIDES[id]
  if (guide.trim().length === 0) {
    throw new Error(`Capability "${id}" has no guide to load`)
  }
  return { id, guide }
}

/**
 * 构建 `[Capability Catalog]` 目录段。ids 为空时返回空字符串（调用方按
 * joinDistinctPromptSections 的 undefined 语义跳过）。条目与当轮实际挂载
 * 一一对应，由组装处传入；未挂载的能力不出现。
 */
export function buildCapabilityCatalogPrompt(ids: readonly CapabilityId[]): string {
  if (ids.length === 0) return ''
  const seen = new Set<CapabilityId>()
  const lines: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    lines.push(`- ${id} — ${CATALOG_DESCRIPTIONS[id]}`)
  }
  if (lines.length === 0) return ''
  return [
    '[Capability Catalog]',
    '',
    'Metadata only. Each entry describes a mounted capability; full usage guides are NOT loaded here (progressive disclosure).',
    "Before the first use of a capability's tools in this conversation, call `mcp__spark_platform__capability_load` with the capability `id`, then follow the returned guide. The loaded guide stays in the conversation context; after context compaction you may load it again.",
    '',
    ...lines,
  ].join('\n')
}
