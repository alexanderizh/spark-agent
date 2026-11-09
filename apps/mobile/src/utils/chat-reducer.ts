/**
 * 对话时间线归约器：把桌面端推来的 BridgeEvent 流转成可渲染的消息列表。
 *
 * 规则（与桌面端渲染管线同口径的移动端简化版）：
 *   - user_message                       → 用户气泡
 *   - assistant_message delta            → 按 segmentId（缺省 turnId）追加到当前助手气泡
 *   - assistant_message complete         → 替换同 segment 的文本
 *   - agent_thinking delta/complete      → 按 segment 拼接思考内容
 *   - tool_call / tool_result            → 工具提示行（折叠展示）
 *   - agent_status thinking/calling_tool → 运行中指示（转写为「思考中 / 调用工具」）
 *   - agent_status 终态 / agent_error    → 结束指示
 */

import type { BridgeEvent } from '../api/bridge'
import { normalizeTextEvents, sortEvents } from './chat-order'

export interface ChatMessage {
  /** 稳定 key：用户消息用事件 id，助手气泡用 segmentId ?? turnId */
  key: string
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'status' | 'media'
  text: string
  /** 所属回合（用户消息 = fork 分支锚点数据源；助手消息 final 收尾归并本 turn 分段用） */
  turnId?: string
  /** 工具名（role=tool） */
  toolName?: string
  toolStatus?: 'running' | 'success' | 'error'
  /** 状态文案（role=status） */
  tone?: 'running' | 'done' | 'error'
  /** 桌面端图片绝对路径（role=media；presented_files 过滤后的图片子集） */
  paths?: string[]
  /** 随消息提交的附件（role=user；历史事件透传，图片缩略图经本地缓存解析） */
  attachments?: { type: 'image' | 'file'; path: string; name?: string }[]
  createdAt: string
}

export interface ChatTimeline {
  messages: ChatMessage[]
  /** 是否有进行中的回合 */
  running: boolean
}

export function emptyTimeline(): ChatTimeline {
  return { messages: [], running: false }
}

/**
 * 用服务端权威 running 覆盖本地归约结果。
 *
 * 中继事件是「发完即丢」的直通帧，终态 agent_status 有可能在断线窗口丢失，
 * 本地归约因此会永久停在 running=true（输入被锁死）。服务端 getMessages 的
 * running 由最后一条 agent_status 推导，是唯一可信口径；对账后必须覆盖它。
 */
export function withServerRunning(timeline: ChatTimeline, running: boolean): ChatTimeline {
  const messages = timeline.messages.map((item) =>
    item.role === 'tool' && !running && item.toolStatus === 'running'
      ? { ...item, toolStatus: 'success' as const, text: `${item.toolName ?? '工具'} 完成` }
      : item,
  )
  const statusRows = running
    ? messages
    : messages.filter((item) => !(item.role === 'status' && item.tone === 'running'))
  return { messages: statusRows, running }
}

/**
 * 过滤中继重连重放的事件。Set 由聊天页在一次页面生命周期内持有，避免每次 delta
 * 都复制整段历史的事件 ID；历史翻页和首屏加载也应把返回事件交给此函数登记。
 */
export function filterUnseenEvents(
  seenEventIds: Set<string>,
  events: BridgeEvent[],
): BridgeEvent[] {
  const unseen: BridgeEvent[] = []
  for (const event of events) {
    if (seenEventIds.has(event.id)) continue
    seenEventIds.add(event.id)
    unseen.push(event)
  }
  return unseen
}

/** presented_files → 可展示图片子集（按扩展名过滤，与桌面端 PresentedMedia 白名单一致） */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp)$/i

function imagePathsFromPresentedFiles(event: BridgeEvent): string[] {
  if (!Array.isArray(event.files)) return []
  return event.files
    .filter((file): file is { path: string; title?: string } => {
      return typeof file?.path === 'string' && IMAGE_EXTENSIONS.test(file.path)
    })
    .map((file) => file.path)
}

/** 运行中状态 → 人类可读文案 */
function runningStatusText(event: BridgeEvent): string {
  if (event.type === 'tool_call') return `调用工具 ${event.toolName ?? ''}`.trim()
  if (event.status === 'thinking') return '思考中'
  if (event.status === 'calling_tool') return '执行工具'
  if (event.status === 'waiting_permission') return '等待权限确认'
  if (event.status === 'waiting_user') return '等待用户输入'
  return event.statusMessage ?? '处理中'
}

/** 最后一条运行中状态行的下标（无则 -1）。不用 findLastIndex：ES2023，低版本机型缺失。 */
function lastRunningStatusIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i]
    if (item.role === 'status' && item.tone === 'running') return i
  }
  return -1
}

/** 终态判定（AgentStatusValue 的终态子集） */
function isTerminalStatus(status: string | undefined): boolean {
  return status === 'idle' || status === 'completed' || status === 'cancelled' || status === 'error'
}

/**
 * 回合收尾时收敛仍标 running 的工具行。
 * 桌面端不一定为每次 tool_call 都补 tool_result（尤其取消/异常场景），
 * 旧行为会让这些行永远显示「运行中」，看起来像会话没结束。
 */
function settleRunningTools(messages: ChatMessage[]): void {
  for (let i = 0; i < messages.length; i += 1) {
    const item = messages[i]
    if (item.role === 'tool' && item.toolStatus === 'running') {
      messages[i] = {
        ...item,
        toolStatus: 'success',
        text: `${item.toolName ?? '工具'} 已完成`,
      }
    }
  }
}

/**
 * 严格自重复兜底：全文恰好是「X + X」时截成 X。
 * 保守条件（长度 ≥ 24、偶数、前后完全一致），只用于清理历史上已经写脏的
 * 「delta 被追加到完整版之后」的气泡；正常回复不会是严格的两倍重复。
 */
function stripDoubledText(text: string): string {
  const len = text.length
  if (len < 24 || len % 2 !== 0) return text
  const half = len / 2
  return text.slice(0, half) === text.slice(half) ? text.slice(0, half) : text
}

/**
 * 输出去重：同一回合里文本完全相同的两条 assistant 气泡（分段 key 与 final
 * turnId 不一致时会出现）只保留第一条；顺带清掉严格自重复的文本。
 * 不修改入参里的消息对象。
 */
export function dedupeAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>()
  const out: ChatMessage[] = []
  for (const item of messages) {
    if (item.role !== 'assistant') {
      out.push(item)
      continue
    }
    const text = stripDoubledText(item.text)
    const trimmed = text.trim()
    const dedupeKey = `${item.turnId ?? ''}\u0000${trimmed}`
    if (trimmed.length > 0 && seen.has(dedupeKey)) continue
    if (trimmed.length > 0) seen.add(dedupeKey)
    out.push(text === item.text ? item : { ...item, text })
  }
  return out
}

/**
 * 应用一批事件（按 seq 升序）到时间线。
 * 返回新 timeline（不改入参），调用方直接 setData。
 *
 * 入口先做 normalizeTextEvents：同一分段若同时有 delta 与 complete，只认完整版，
 * 否则 delta 会被追加到已有全文后面，agent 输出就显示两遍。
 */
export function applyEvents(timeline: ChatTimeline, events: BridgeEvent[]): ChatTimeline {
  const messages = [...timeline.messages]
  let running = timeline.running

  for (const event of normalizeTextEvents(sortEvents(events))) {
    switch (event.type) {
      case 'user_message': {
        messages.push({
          key: `u:${event.id}`,
          role: 'user',
          text: event.content ?? '',
          turnId: event.turnId,
          ...(Array.isArray(event.attachments) && event.attachments.length > 0
            ? { attachments: event.attachments }
            : {}),
          createdAt: event.timestamp,
        })
        running = true
        break
      }

      case 'assistant_message': {
        // 最终完整消息（isFinal，无 segmentId）：桌面端在流式分段之外会补一条
        // final 收尾消息。口径与桌面端渲染管线一致：按内容去重收尾、不覆盖此前
        // 各段叙述 —— 分段气泡必须保留原位，穿插其间的工具日志才不会被打乱时序
        // （旧行为把全部分段归并成一条大正文，工具日志会被整体挤到正文之后）。
        if (event.isFinal === true && event.segmentId == null) {
          const finalText = event.content ?? ''
          const turnAssistantIndexes: number[] = []
          messages.forEach((item, index) => {
            if (item.role === 'assistant' && item.turnId === event.turnId) {
              turnAssistantIndexes.push(index)
            }
          })
          if (turnAssistantIndexes.length === 0) {
            // turnId 不一致时 final 找不到同回合分段，但内容可能已由分段气泡
            // 渲染过（桌面端 turn_id IS NULL 的会话级事件会走到这里）。
            // 先按内容查重，避免整段输出再画一遍。
            if (
              messages.some(
                (item) => item.role === 'assistant' && item.text.trim() === finalText.trim(),
              )
            ) {
              break
            }
            // 无已渲染分段（历史只有 final 或流式事件缺失）：final 即正文
            messages.push({
              key: `a:${event.turnId}`,
              role: 'assistant',
              text: finalText,
              turnId: event.turnId,
              createdAt: event.timestamp,
            })
            break
          }
          const lastIndex = turnAssistantIndexes[turnAssistantIndexes.length - 1]
          const last = messages[lastIndex]
          const sameText = (a: string, b: string) => a.trim() === b.trim()
          const joined = turnAssistantIndexes.map((i) => messages[i].text).join('')
          if (sameText(joined, finalText)) {
            // 分段拼接已等于 final 全文：丢弃 final，分段原位保留（正常路径）
            break
          }
          if (sameText(last.text, finalText)) {
            // final 只覆盖最后一个分段（如 Claude result 仅含末段文本）：无操作收尾
            break
          }
          if (joined.length > 0 && finalText.startsWith(joined)) {
            // final 是分段拼接的扩展：差量补到最后一段，保持分段原位
            last.text += finalText.slice(joined.length)
            break
          }
          // 内容对不上（分段缺失/漂移）：内容正确性优先，退化为归并成一条 final 气泡
          const anchorIndex = turnAssistantIndexes[0]
          for (let i = turnAssistantIndexes.length - 1; i >= 0; i -= 1) {
            messages.splice(turnAssistantIndexes[i], 1)
          }
          const finalMessage: ChatMessage = {
            key: `a:${event.turnId}`,
            role: 'assistant',
            text: finalText,
            turnId: event.turnId,
            createdAt: event.timestamp,
          }
          if (anchorIndex != null) {
            messages.splice(anchorIndex, 0, finalMessage)
          } else {
            messages.push(finalMessage)
          }
          break
        }
        const key = `a:${event.segmentId ?? event.turnId}`
        const existing = messages.find((item) => item.key === key && item.role === 'assistant')
        if (existing == null) {
          messages.push({
            key,
            role: 'assistant',
            text: event.content ?? '',
            turnId: event.turnId,
            createdAt: event.timestamp,
          })
        } else if (event.mode === 'delta') {
          existing.text += event.content ?? ''
        } else {
          existing.text = event.content ?? ''
        }
        break
      }

      case 'agent_thinking': {
        const key = `r:${event.segmentId ?? event.turnId}`
        const existing = messages.find((item) => item.key === key && item.role === 'thinking')
        if (existing == null) {
          messages.push({
            key,
            role: 'thinking',
            text: event.content ?? '',
            turnId: event.turnId,
            createdAt: event.timestamp,
          })
        } else if (event.mode === 'delta') {
          existing.text += event.content ?? ''
        } else {
          existing.text = event.content ?? ''
        }
        break
      }

      case 'tool_call': {
        const existing = messages.find(
          (item) => item.role === 'tool' && item.key === `t:${event.toolCallId}`,
        )
        if (existing == null) {
          messages.push({
            key: `t:${event.toolCallId ?? event.id}`,
            role: 'tool',
            text: runningStatusText(event),
            toolName: event.toolName,
            toolStatus: 'running',
            createdAt: event.timestamp,
          })
        }
        break
      }

      case 'tool_result': {
        const key = `t:${event.toolCallId ?? event.id}`
        const existing = messages.find((item) => item.role === 'tool' && item.key === key)
        if (existing != null) {
          existing.toolStatus = event.toolStatus === 'success' ? 'success' : 'error'
          existing.text = `${event.toolName ?? existing.toolName ?? '工具'}${event.toolStatus === 'success' ? ' 完成' : ' 失败'}`
        } else {
          messages.push({
            key,
            role: 'tool',
            text: `${event.toolName ?? '工具'}${event.toolStatus === 'success' ? ' 完成' : ' 失败'}`,
            toolName: event.toolName,
            toolStatus: event.toolStatus === 'success' ? 'success' : 'error',
            createdAt: event.timestamp,
          })
        }
        break
      }

      case 'agent_status': {
        // 去掉上一条 running 状态行，换最新的
        const lastStatusIndex = lastRunningStatusIndex(messages)
        if (lastStatusIndex >= 0) messages.splice(lastStatusIndex, 1)
        if (isTerminalStatus(event.status)) {
          running = false
          settleRunningTools(messages)
          if (event.status === 'error') {
            messages.push({
              key: `s:${event.id}`,
              role: 'status',
              text: event.statusMessage ?? '回合出错',
              tone: 'error',
              createdAt: event.timestamp,
            })
          }
        } else {
          running = true
          messages.push({
            key: `s:${event.id}`,
            role: 'status',
            text: runningStatusText(event),
            tone: 'running',
            createdAt: event.timestamp,
          })
        }
        break
      }

      case 'agent_error': {
        const lastStatusIndex = lastRunningStatusIndex(messages)
        if (lastStatusIndex >= 0) messages.splice(lastStatusIndex, 1)
        running = false
        settleRunningTools(messages)
        messages.push({
          key: `s:${event.id}`,
          role: 'status',
          text: event.statusMessage ?? '回合出错',
          tone: 'error',
          createdAt: event.timestamp,
        })
        break
      }

      case 'presented_files': {
        // agent 显式呈现的产物图片：独立媒体条（不参与文本 delta 拼接）；
        // 空数组（全部为非图片）不入时间线
        const imagePaths = imagePathsFromPresentedFiles(event)
        if (imagePaths.length > 0) {
          messages.push({
            key: `m:${event.id}`,
            role: 'media',
            text: '',
            paths: imagePaths,
            createdAt: event.timestamp,
          })
        }
        break
      }

      default:
        break
    }
  }

  return { messages: dedupeAssistantMessages(messages), running }
}
