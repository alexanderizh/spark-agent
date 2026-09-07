/**
 * 会话标题手动提取（重命名弹窗「提取标题」按钮，2026-09-07）。
 *
 * 与首轮自动精炼（session-command-title-refinement）同一套模型解析链：
 * session.model_id → provider defaultModel（即"当前会话模型-默认模型"），
 * 再用会话中按轮次均匀取样的可见正文调 generateSessionTitle。
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
  TurnPromptSnapshotEvent,
  UserMessageEvent,
} from '@spark/protocol'
import { resolveProviderApiKey } from '../provider-credential-resolver.js'
import { generateSessionTitle } from '../session-title-generator.js'

const log = createLogger('session-title-extraction')

const MAX_TITLE_SOURCE_TURNS = 4
const MAX_TITLE_SAMPLE_CHARS = 180

interface TitleDialogueTurn {
  firstSeq: number
  userMessage: string
  snapshotUserMessage: string
  assistantMessages: string[]
  hidden: boolean
}

interface TitleDialogueSample {
  turnNumber: number
  userMessage: string
  assistantMessage: string
}

/**
 * 从对话事件中收集可见轮次，并按时间均匀抽取标题素材。
 *
 * - 以 turnId 配对用户正文与同轮 assistant 回复，避免把隐藏定时任务的回复
 *   错配给下一条可见用户消息。
 * - 隐藏消息（定时任务/command follow-up/goal 等内部 turn）整轮跳过。
 * - 会话超过 4 轮时取首、中间、末尾等均匀位置，避免标题只反映开场内容。
 * - 没有可见用户正文但存在 assistant 正文时，仍允许从 assistant 内容提取标题；
 *   这兼容导入、恢复或仅产生 assistant 输出的历史会话。
 */
export function pickTitleSourceFromDialogueEvents(
  events: AgentEvent[],
): { userMessage: string; assistantMessage: string } | null {
  const turns = new Map<string, TitleDialogueTurn>()
  const orderedEvents = [...events].sort((left, right) => left.seq - right.seq)

  for (const event of orderedEvents) {
    const turnId = event.turnId || event.id
    let turn = turns.get(turnId)
    if (turn == null) {
      turn = {
        firstSeq: event.seq,
        userMessage: '',
        snapshotUserMessage: '',
        assistantMessages: [],
        hidden: false,
      }
      turns.set(turnId, turn)
    }

    if (event.type === 'user_message') {
      const user = event as UserMessageEvent
      if (user.userMessageVisibility === 'hidden') {
        turn.hidden = true
        continue
      }
      const content = resolvePreferredText(user.userMessageDisplayContent, user.content)
      if (turn.userMessage.length === 0 && content.length > 0) turn.userMessage = content
      continue
    }

    if (event.type === 'turn_prompt_snapshot') {
      const snapshot = event as TurnPromptSnapshotEvent
      if (snapshot.userMessageVisibility === 'hidden') {
        turn.hidden = true
        continue
      }
      const content = resolvePreferredText(snapshot.userMessageDisplayContent, snapshot.userMessage)
      if (turn.snapshotUserMessage.length === 0 && content.length > 0) {
        turn.snapshotUserMessage = content
      }
      continue
    }

    if (event.type === 'assistant_message') {
      const assistant = event as AssistantMessageEvent
      const content = (assistant.content ?? '').trim()
      if (content.length > 0) turn.assistantMessages.push(content)
    }
  }

  for (const turn of turns.values()) {
    if (turn.userMessage.length === 0) turn.userMessage = turn.snapshotUserMessage
  }

  const allTurns = [...turns.values()].sort((left, right) => left.firstSeq - right.firstSeq)
  const visibleTurns = allTurns.filter((turn) => !turn.hidden && turn.userMessage.length > 0)
  if (visibleTurns.length > 0) {
    const samples = selectEvenly(visibleTurns, MAX_TITLE_SOURCE_TURNS).map((turn) =>
      toTitleDialogueSample(turn, visibleTurns.indexOf(turn) + 1),
    )
    return formatTitleSource(samples)
  }

  // A reference/imported session can contain assistant output without a usable
  // user text event. Keep this as a fallback instead of reporting dialogue_empty.
  const assistantOnlyTurns = allTurns.filter(
    (turn) => !turn.hidden && turn.assistantMessages.length > 0,
  )
  if (assistantOnlyTurns.length === 0) return null
  const samples = selectEvenly(assistantOnlyTurns, MAX_TITLE_SOURCE_TURNS).map((turn, index) =>
    toTitleDialogueSample(turn, index + 1),
  )
  const source = formatTitleSource(samples)
  if (source == null) return null
  return {
    userMessage: source.assistantMessage || source.userMessage,
    assistantMessage: source.assistantMessage ? '' : source.userMessage,
  }
}

function selectEvenly<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items
  if (maxItems <= 0) return []
  if (maxItems === 1) return items.slice(0, 1)

  const selectedIndices = new Set(
    Array.from({ length: maxItems }, (_, index) =>
      Math.round((index * (items.length - 1)) / (maxItems - 1)),
    ),
  )
  return [...selectedIndices]
    .sort((left, right) => left - right)
    .flatMap((index) => (items[index] === undefined ? [] : [items[index]]))
}

function toTitleDialogueSample(turn: TitleDialogueTurn, turnNumber: number): TitleDialogueSample {
  return {
    turnNumber,
    userMessage: clipTitleSample(turn.userMessage),
    assistantMessage: clipTitleSample(turn.assistantMessages.join('\n')),
  }
}

function formatTitleSource(samples: TitleDialogueSample[]): {
  userMessage: string
  assistantMessage: string
} | null {
  const userMessage = samples
    .filter((sample) => sample.userMessage.length > 0)
    .map((sample) => `[第${sample.turnNumber}轮用户]\n${sample.userMessage}`)
    .join('\n\n')
  const assistantMessage = samples
    .filter((sample) => sample.assistantMessage.length > 0)
    .map((sample) => `[第${sample.turnNumber}轮助手]\n${sample.assistantMessage}`)
    .join('\n\n')

  if (userMessage.length === 0 && assistantMessage.length === 0) return null
  return { userMessage, assistantMessage }
}

function clipTitleSample(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= MAX_TITLE_SAMPLE_CHARS
    ? normalized
    : normalized.slice(0, MAX_TITLE_SAMPLE_CHARS)
}

function resolvePreferredText(preferred: string | undefined, fallback: string): string {
  const preferredText = preferred?.trim() ?? ''
  return preferredText.length > 0 ? preferredText : fallback.trim()
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
      .queryDialogueEvents(params.sessionId, 1_000)
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
