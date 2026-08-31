/** Turn 的发起来源。缺省表示历史记录或普通用户输入，保持向后兼容。 */
export type TurnSource =
  | 'user'
  | 'scheduled_task'
  | 'goal_contract_draft'
  | 'goal_iteration'
  | 'command_follow_up'

/** 用户消息正文在产品时间线中的呈现策略；不影响持久化或模型上下文。 */
export type UserMessageVisibility = 'visible' | 'hidden'

export interface UserMessagePresentation {
  /** Renderer-generated id used to reconcile the optimistic bubble with the persisted event. */
  clientMessageId?: string
  turnSource?: TurnSource
  userMessageVisibility?: UserMessageVisibility
  /**
   * 当模型输入包含平台内部上下文时，聊天时间线可展示的安全正文。
   * 缺省时继续遵循 userMessageVisibility；该字段不改变模型实际收到的消息。
   */
  userMessageDisplayContent?: string
}

export const SCHEDULED_TASK_TURN_PRESENTATION = {
  turnSource: 'scheduled_task',
  userMessageVisibility: 'hidden',
} as const satisfies UserMessagePresentation

export function createScheduledTaskTurnPresentation(
  userMessageDisplayContent: string,
): typeof SCHEDULED_TASK_TURN_PRESENTATION & { userMessageDisplayContent: string } {
  return {
    ...SCHEDULED_TASK_TURN_PRESENTATION,
    userMessageDisplayContent,
  }
}

export const GOAL_CONTRACT_DRAFT_TURN_PRESENTATION = {
  turnSource: 'goal_contract_draft',
  userMessageVisibility: 'hidden',
} as const satisfies UserMessagePresentation

export const GOAL_ITERATION_TURN_PRESENTATION = {
  turnSource: 'goal_iteration',
  userMessageVisibility: 'hidden',
} as const satisfies UserMessagePresentation

/**
 * 命令（如 /spark-app-create、技能命令）解析成功后注入的 follow-up Agent turn。
 * 提示词是面向模型的内置指令，不属于用户输入，不进入聊天时间线展示。
 */
export const COMMAND_FOLLOW_UP_TURN_PRESENTATION = {
  turnSource: 'command_follow_up',
  userMessageVisibility: 'hidden',
} as const satisfies UserMessagePresentation

/**
 * Claude Code 引擎压缩完成后注入的承接摘要固定以该前缀开头
 * （"This session is being continued from a previous conversation..."）。
 * 该消息面向模型上下文承接，不面向用户时间线；runtime 映射与 renderer
 * 旧数据回放共用此签名识别，避免把摘要渲染成 agent 正文。
 */
export const ENGINE_COMPACT_SUMMARY_PREFIX =
  'This session is being continued from a previous conversation'

/** 判断文本是否为引擎注入的压缩承接摘要。 */
export function isEngineCompactSummaryText(text: string): boolean {
  return text.trimStart().startsWith(ENGINE_COMPACT_SUMMARY_PREFIX)
}

/** Prevents runtime-only turn options from leaking into persisted user_message events. */
export function pickUserMessagePresentation(
  value: UserMessagePresentation,
): UserMessagePresentation {
  return {
    ...(value.clientMessageId != null ? { clientMessageId: value.clientMessageId } : {}),
    ...(value.turnSource != null ? { turnSource: value.turnSource } : {}),
    ...(value.userMessageVisibility != null
      ? { userMessageVisibility: value.userMessageVisibility }
      : {}),
    ...(value.userMessageDisplayContent != null
      ? { userMessageDisplayContent: value.userMessageDisplayContent }
      : {}),
  }
}
