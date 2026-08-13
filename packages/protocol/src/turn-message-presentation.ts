/** Turn 的发起来源。缺省表示历史记录或普通用户输入，保持向后兼容。 */
export type TurnSource = 'user' | 'scheduled_task' | 'goal_contract_draft' | 'goal_iteration'

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
