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
  turnSource?: TurnSource
  userMessageVisibility?: UserMessageVisibility
}

export const SCHEDULED_TASK_TURN_PRESENTATION = {
  turnSource: 'scheduled_task',
  userMessageVisibility: 'hidden',
} as const satisfies UserMessagePresentation

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

/** Prevents runtime-only turn options from leaking into persisted user_message events. */
export function pickUserMessagePresentation(
  value: UserMessagePresentation,
): UserMessagePresentation {
  return {
    ...(value.turnSource != null ? { turnSource: value.turnSource } : {}),
    ...(value.userMessageVisibility != null
      ? { userMessageVisibility: value.userMessageVisibility }
      : {}),
  }
}
