/**
 * 远程会话时间线摘要（产物面板与检查器共用）。
 *
 * 独立于聊天面板（RemoteChatPane 自持一套合并状态，不外借——并行开发期间不动它）：
 * 本 hook 按 (deviceId, sessionId) 自行订阅事件流（主进程引用计数，重复订阅不重复推送）
 * 并拉一页最近历史，聚合出三类轻量信息：
 *   - presented_files 文件（产物 tab 即时并入，见 mergeSessionTimelineArtifacts）
 *   - 工具调用统计（检查器「工具调用日志」，对齐本地 Inspector 的工具执行口径）
 *   - 消息计数 / 最近活动时间（检查器「会话信息」）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MobileBridgeEvent } from '@spark/protocol'
import { buildHistoryUrl, type RemoteHistoryPage } from './remoteHistory'
import { mergeRemoteEvents } from './remoteEventMerge'
import { useRemoteCall, useRemoteSessionStream } from './useRemoteBridge'

/** 单个工具调用的聚合统计（按 toolName 归组，对齐本地检查器的工具执行区） */
export interface RemoteToolCallStat {
  toolName: string
  /** 调用总数 */
  total: number
  success: number
  error: number
  running: number
  /** 最近一次调用状态（success / error / running） */
  lastStatus: 'success' | 'error' | 'running'
  /** 最近一次调用时间（事件 timestamp 原文） */
  lastUsedAt: string | null
}

export interface RemoteSessionTimelineSummary {
  /** presented_files 事件里的文件（同路径保留最新一次的标题） */
  files: Array<{ path: string; title?: string }>
  /** 工具调用统计（按最近使用倒序） */
  toolCalls: RemoteToolCallStat[]
  /** user_message 条数 */
  messageCount: number
  /** 最近一次事件时间（ISO 原文，无事件时 null） */
  lastActivityAt: string | null
  loading: boolean
  error: string | null
}

/** 纯聚合：事件 → 摘要（单测入口，不触网络） */
export function summarizeRemoteTimeline(events: MobileBridgeEvent[]): RemoteSessionTimelineSummary {
  const filesByPath = new Map<string, { path: string; title?: string; seq: number }>()
  const tools = new Map<string, RemoteToolCallStat>()
  /** toolCallId → toolName：结果事件靠它改判对应调用行的状态 */
  const toolNameByCallId = new Map<string, string>()
  let messageCount = 0
  let lastActivityAt: string | null = null

  const touchTool = (
    toolName: string,
    status: 'success' | 'error' | 'running',
    timestamp: string,
  ): void => {
    const stat = tools.get(toolName) ?? {
      toolName,
      total: 0,
      success: 0,
      error: 0,
      running: 0,
      lastStatus: 'running' as const,
      lastUsedAt: null,
    }
    stat.total += 1
    if (status === 'success') stat.success += 1
    else if (status === 'error') stat.error += 1
    else stat.running += 1
    if (stat.lastUsedAt == null || timestamp >= stat.lastUsedAt) {
      stat.lastUsedAt = timestamp
      stat.lastStatus = status
    }
    tools.set(toolName, stat)
  }

  for (const event of events) {
    if (lastActivityAt == null || event.timestamp >= lastActivityAt) lastActivityAt = event.timestamp
    switch (event.type) {
      case 'user_message':
        messageCount += 1
        break
      case 'presented_files': {
        if (!Array.isArray(event.files)) break
        for (const file of event.files) {
          if (file == null || typeof file.path !== 'string' || file.path.length === 0) continue
          const existing = filesByPath.get(file.path)
          if (existing != null && existing.seq >= event.seq) continue
          filesByPath.set(file.path, {
            path: file.path,
            ...(typeof file.title === 'string' && file.title.length > 0 ? { title: file.title } : {}),
            seq: event.seq,
          })
        }
        break
      }
      case 'tool_call': {
        // 调用行计数：total + running；结果事件只改判状态，不重复计数
        if (typeof event.toolName === 'string' && event.toolName.length > 0) {
          touchTool(event.toolName, 'running', event.timestamp)
          if (typeof event.toolCallId === 'string' && event.toolCallId.length > 0) {
            toolNameByCallId.set(event.toolCallId, event.toolName)
          }
        }
        break
      }
      case 'tool_result': {
        const pairedToolName =
          typeof event.toolCallId === 'string' ? toolNameByCallId.get(event.toolCallId) : undefined
        if (pairedToolName != null) {
          const stat = tools.get(pairedToolName)
          if (stat != null) {
            if (stat.running > 0) stat.running -= 1
            if (event.toolStatus === 'error') stat.error += 1
            else stat.success += 1
            if (stat.lastUsedAt == null || event.timestamp >= stat.lastUsedAt) {
              stat.lastUsedAt = event.timestamp
              stat.lastStatus = event.toolStatus === 'error' ? 'error' : 'success'
            }
          }
        } else if (typeof event.toolName === 'string' && event.toolName.length > 0) {
          // 旧目标端只发结果不发调用的兜底：按独立一次计入
          touchTool(event.toolName, event.toolStatus === 'error' ? 'error' : 'success', event.timestamp)
        }
        break
      }
      default:
        break
    }
  }

  const toolCalls = [...tools.values()].sort((a, b) => {
    const aAt = a.lastUsedAt ?? ''
    const bAt = b.lastUsedAt ?? ''
    return aAt < bAt ? 1 : aAt > bAt ? -1 : 0
  })
  const files = [...filesByPath.values()]
    .sort((a, b) => b.seq - a.seq)
    .map(({ path, title }) => (title != null ? { path, title } : { path }))

  return {
    files,
    toolCalls,
    messageCount,
    lastActivityAt,
    loading: false,
    error: null,
  }
}

/**
 * 订阅 + 拉一页最近历史，聚合当前会话时间线摘要。
 * 事件量可能很大，merge 结果存 ref、只把派生摘要放进 state，避免全量重渲染。
 */
export function useRemoteSessionTimelineSummary(
  deviceId: string | null,
  sessionId: string | null,
): RemoteSessionTimelineSummary {
  const call = useRemoteCall()
  const eventsRef = useRef<MobileBridgeEvent[]>([])
  const [derived, setDerived] = useState<RemoteSessionTimelineSummary>({
    files: [],
    toolCalls: [],
    messageCount: 0,
    lastActivityAt: null,
    loading: false,
    error: null,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recompute = useCallback(() => {
    setDerived(summarizeRemoteTimeline(eventsRef.current))
  }, [])

  // 切会话：清空旧事件，拉一页最近历史（产物/工具统计覆盖「最近几轮」足够；
  // 更早的历史由产物 REST 聚合兜底，这里不为摘要翻完整历史）
  useEffect(() => {
    eventsRef.current = []
    setError(null)
    if (deviceId == null || sessionId == null) {
      setLoading(false)
      recompute()
      return
    }
    let cancelled = false
    setLoading(true)
    call<RemoteHistoryPage>(deviceId, 'GET', buildHistoryUrl(sessionId))
      .then((page) => {
        if (cancelled) return
        eventsRef.current = mergeRemoteEvents(eventsRef.current, page.events ?? [])
        recompute()
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // 历史拉取失败不致命：实时流还能增量补；占位为空 + 错误提示
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
        recompute()
      })
    return () => {
      cancelled = true
    }
  }, [call, deviceId, recompute, sessionId])

  useRemoteSessionStream(deviceId, sessionId, (incoming) => {
    eventsRef.current = mergeRemoteEvents(eventsRef.current, incoming)
    recompute()
  })

  return useMemo(
    () => ({ ...derived, loading, error }),
    [derived, error, loading],
  )
}
