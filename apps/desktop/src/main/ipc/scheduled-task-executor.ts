import {
  deriveScheduledTaskSessionTitle,
  shouldDeriveSessionTitleFromScheduledTurn,
} from '@spark/agent-runtime'
import { createScheduledTaskTurnPresentation } from '@spark/protocol'

export interface SessionScheduledTaskTurnParams {
  sessionId: string
  promptTemplate: string
  userMessageDisplayContent: string
  onSessionCreated?: (sessionId: string) => void
}

export interface SessionScheduledTaskTurnDeps {
  getSession: (sessionId: string) => {
    id: string
    archived_at: string | null
    title: string | null
  } | null
  submitTurn: (params: {
    sessionId: string
    message: string
    turnSource: 'scheduled_task'
    userMessageVisibility: 'hidden'
    userMessageDisplayContent: string
  }) => Promise<{ turnId: string }>
  /** 占位标题被任务正文提取的标题覆盖后，向渲染端广播重命名（缺省时仅落库由宿主决定）。 */
  renameSessionTitle?: (sessionId: string, title: string) => void
}

/** Queue a scheduled turn in its existing session, preserving that session's live runtime config. */
export async function runSessionScheduledTaskTurn(
  params: SessionScheduledTaskTurnParams,
  deps: SessionScheduledTaskTurnDeps,
): Promise<{ sessionId: string; output: string }> {
  const session = deps.getSession(params.sessionId)
  if (session == null) {
    throw new Error(`Scheduled task session no longer exists: ${params.sessionId}`)
  }
  if (session.archived_at != null) {
    throw new Error(`Scheduled task session is archived: ${params.sessionId}`)
  }

  // 定时任务链路的用户消息是隐藏的内部提示，dispatchTurn 的首轮标题派生对 hidden turn
  // 一律跳过，而会话定时任务又总在已存在的会话里追加 turn——占位标题（默认标题，或
  // 父定时任务新建会话写入的 `[⏰] 任务名`）会一直无法被任务正文提取的标题覆盖。
  // 这里补上标题提取：仅覆盖占位标题，用户手动命名的标题不动。
  const nextTitle = shouldDeriveSessionTitleFromScheduledTurn(session.title)
    ? deriveScheduledTaskSessionTitle(params.userMessageDisplayContent)
    : null
  if (nextTitle != null && nextTitle !== session.title) {
    deps.renameSessionTitle?.(params.sessionId, nextTitle)
  }

  params.onSessionCreated?.(params.sessionId)
  const result = await deps.submitTurn({
    sessionId: params.sessionId,
    message: params.promptTemplate,
    ...createScheduledTaskTurnPresentation(params.userMessageDisplayContent),
  })
  return {
    sessionId: params.sessionId,
    output: `Turn ${result.turnId} queued`,
  }
}
