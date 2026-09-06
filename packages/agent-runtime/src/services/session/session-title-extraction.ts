/**
 * 会话标题手动提取（重命名弹窗「提取标题」按钮，2026-09-07）。
 *
 * 与首轮自动精炼（session-command-title-refinement）同一套模型解析链：
 * session.model_id → provider defaultModel（即"当前会话模型-默认模型"），
 * 再用会话首条可见用户消息 + 首条 assistant 回复调 generateSessionTitle。
 * 与自动精炼的区别：结果只返回给渲染端填充输入框，不直接改会话标题，
 * 由用户在重命名弹窗里确认后才落库。
 */
import {
  EventRepository,
  ProviderProfileRepository,
  SessionRepository,
  type SparkDatabase,
} from '@spark/storage'
import { createLogger } from '@spark/shared'
import type {
  AgentEvent,
  AssistantMessageEvent,
  SessionExtractTitleResponse,
  UserMessageEvent,
} from '@spark/protocol'
import { resolveProviderApiKey } from '../provider-credential-resolver.js'
import { generateSessionTitle } from '../session-title-generator.js'

const log = createLogger('session-title-extraction')

/**
 * 从按 seq 正序的对话事件中挑出标题素材：首条可见用户消息 + 首条 assistant 回复。
 *
 * - 隐藏消息（定时任务/command follow-up/goal 等内部 turn）不作为标题来源，
 *   但其后的 assistant 回复仍然可用（回复本身面向用户）。
 * - team_member_message / subagent_message 不作为 assistant 素材（与自动精炼一致，
 *   只认主持人 assistant 正文）。
 */
export function pickTitleSourceFromDialogueEvents(
  events: AgentEvent[],
): { userMessage: string; assistantMessage: string } | null {
  let userMessage = ''
  let assistantMessage = ''
  for (const event of events) {
    if (userMessage.length === 0 && event.type === 'user_message') {
      const user = event as UserMessageEvent
      if (user.userMessageVisibility === 'hidden') continue
      const content = (user.userMessageDisplayContent ?? user.content ?? '').trim()
      if (content.length > 0) userMessage = content
      continue
    }
    if (assistantMessage.length === 0 && event.type === 'assistant_message') {
      const assistant = event as AssistantMessageEvent
      const content = (assistant.content ?? '').trim()
      if (content.length > 0) assistantMessage = content
    }
    if (userMessage.length > 0 && assistantMessage.length > 0) break
  }
  if (userMessage.length === 0) return null
  return { userMessage, assistantMessage }
}

export async function extractSessionTitle(params: {
  db: SparkDatabase
  sessionId: string
}): Promise<SessionExtractTitleResponse> {
  try {
    const session = new SessionRepository(params.db).get(params.sessionId)
    if (session == null) return { ok: false, code: 'session_not_found' }

    // 与 refineCommandSessionTitleAsync 相同的解析链：会话模型 → Provider 默认模型。
    // keystore_ref 为空的本地 CLI Provider（claude-sdk/codex 适配器）没有可直连的
    // HTTP 端点，与自动精炼一致按不可用处理（空串与 null 都视为未配置 key）。
    if (session.provider_profile_id == null) return { ok: false, code: 'provider_missing' }
    const provider = new ProviderProfileRepository(params.db).get(session.provider_profile_id)
    const keystoreRef = provider?.keystore_ref?.trim() ?? ''
    if (provider == null || keystoreRef.length === 0) {
      return { ok: false, code: 'provider_no_api_key' }
    }
    const config = JSON.parse(provider.config_json) as {
      apiEndpoint?: string
      defaultModel?: string
    }
    const model = session.model_id?.trim() || config.defaultModel?.trim() || ''
    if (model.length === 0) return { ok: false, code: 'model_missing' }

    const events = new EventRepository(params.db)
      .queryDialogueEvents(params.sessionId, 400)
      .map((row) => JSON.parse(row.event_json) as AgentEvent)
    const source = pickTitleSourceFromDialogueEvents(events)
    if (source == null) return { ok: false, code: 'dialogue_empty' }

    const title = await generateSessionTitle({
      providerType: provider.provider_type,
      apiKey: await resolveProviderApiKey(provider),
      ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
      model,
      userMessage: source.userMessage,
      assistantMessage: source.assistantMessage,
    })
    if (title == null || title.length === 0) return { ok: false, code: 'title_empty' }
    return { ok: true, title }
  } catch (err) {
    log.warn(`extractSessionTitle failed: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, code: 'title_empty' }
  }
}
