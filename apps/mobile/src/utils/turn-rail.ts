/**
 * 会话轮次（turn）划分 + 轮次轨道数据派生。
 *
 * 桌面端主对话区有 ChatTurnNavigator（左侧竖轨：一轮一刻度、悬浮预览、点击跳转），
 * 移动端此前完全没有对应物——长会话里滚几下就不知道自己在第几轮、某一轮讲了什么。
 * 本文件把「轮次」从渲染项里纯函数地派生出来，供右侧轮次轨道与锚点跳转共用。
 *
 * 轮次口径与 utils/chat-view.ts 的 collapseFinishedTurns 保持一致：
 * 用户提问即新一轮起点；列表首条也自成一轮（历史分页可能从助手消息开始）。
 * 两处若改口径必须同步，否则「折叠按轮折、轨道按另一套切」会互相打脸。
 */

import type { TimelineItem } from './chat-view'

/** 一轮在轨道上的一份数据 */
export interface TurnRailItem {
  /** 轮次稳定 key（取该轮首条渲染项的 key；历史前翻时不会变） */
  key: string
  /** 1 起的轮次序号 */
  ordinal: number
  /** 锚点元素 id（量位置 / scroll-into-view 用；已剔除非 selector 安全字符） */
  anchorId: string
  /** 用户提问摘要（预览首行） */
  userPreview: string
  /** 助手答复摘要（预览次行） */
  assistantPreview: string
}

export interface TurnRailProjection {
  /** 原渲染项数组（锚点 id 已回填到每轮首条上） */
  items: TimelineItem[]
  /** 按时间正序的轮次列表 */
  turns: TurnRailItem[]
}

/** 摘要截断长度：预览卡两行放得下，又能认出是哪一轮 */
const PREVIEW_LIMIT = 60

const EMPTY_USER_PREVIEW = '（这一轮没有文字提问）'
const EMPTY_ASSISTANT_PREVIEW = '（这一轮没有文字答复）'

function flatten(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function clip(text: string): string {
  if (text === '') return ''
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text
}

/**
 * 轮次锚点 id。渲染项 key 里含 `:`（如 `a:turn-1`、`div:u1`），
 * 在 SelectorQuery / scroll-into-view 的 selector 里不安全，只留字母数字与 -_。
 */
export function turnAnchorId(itemKey: string): string {
  return `turn-${itemKey.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

interface MutableTurn {
  key: string
  anchorId: string
  user: string
  assistant: string
}

function toTurnItem(raw: MutableTurn, index: number): TurnRailItem {
  return {
    key: raw.key,
    ordinal: index + 1,
    anchorId: raw.anchorId,
    userPreview: raw.user !== '' ? clip(raw.user) : EMPTY_USER_PREVIEW,
    assistantPreview: raw.assistant !== '' ? raw.assistant : EMPTY_ASSISTANT_PREVIEW,
  }
}

/**
 * 从渲染项派生轮次列表，并把锚点 id 回填到每轮首条。
 *
 * 原地修改传入数组里的 `turnAnchorId`（与 assignTimelineGaps 改 gap 同一套路），
 * 返回的 items 就是同一个数组，调用方直接拿去 setData。
 */
export function buildTurnRail(items: TimelineItem[]): TurnRailProjection {
  const turns: TurnRailItem[] = []
  let current: MutableTurn | null = null

  for (const item of items) {
    // 用户提问 = 新轮起点；列表首条也自成一轮
    if (item.kind === 'user' || current == null) {
      if (current != null) turns.push(toTurnItem(current, turns.length))
      current = {
        key: item.key,
        anchorId: turnAnchorId(item.key),
        user: item.kind === 'user' ? flatten(item.text) : '',
        assistant: '',
      }
      item.turnAnchorId = current.anchorId
      continue
    }
    // 取该轮最后一段有文字的助手正文作答复摘要：一轮常有「干活 → 总结」多段，
    // 最后一段才是结论，与回合折叠（collapseFinishedTurns）留总结的口径一致。
    if (item.kind === 'assistant') {
      const text = clip(flatten(item.text))
      if (text !== '') current.assistant = text
    }
  }
  if (current != null) turns.push(toTurnItem(current, turns.length))
  return { items, turns }
}

/**
 * 当前轮次的激活边距（px）：锚点进入视口顶部这个范围之内就算「轮到它了」。
 * 取 80px 是让轮次在标题即将滚出屏幕前就高亮，而不是刚好压线才跳。
 */
export const TURN_ACTIVATION_MARGIN_PX = 80

/**
 * 按滚动位置挑当前轮次 key。
 *
 * @param turns  轮次列表（时间正序，锚点偏移随之递增）
 * @param tops   anchorId → 该锚点在滚动内容里的偏移（px），由页面侧量好后传入
 * @param scrollTop 当前滚动偏移（px）
 *
 * 口径：最后一个「已经过去」的轮次即当前轮。全部没过去取第一轮（用户在会话最顶端），
 * 全部过去了自然落到最后一轮（贴底）。量不到偏移的轮次跳过，不影响其余判定。
 */
export function pickActiveTurnKey(
  turns: readonly TurnRailItem[],
  tops: ReadonlyMap<string, number>,
  scrollTop: number,
): string | null {
  if (turns.length === 0) return null
  let active = turns[0]
  for (const turn of turns) {
    const top = tops.get(turn.anchorId)
    if (top == null) continue
    if (top <= scrollTop + TURN_ACTIVATION_MARGIN_PX) active = turn
  }
  return active.key
}
