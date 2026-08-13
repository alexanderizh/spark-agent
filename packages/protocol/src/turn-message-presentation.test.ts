import { describe, expect, it } from 'vitest'
import {
  GOAL_CONTRACT_DRAFT_TURN_PRESENTATION,
  GOAL_ITERATION_TURN_PRESENTATION,
  SCHEDULED_TASK_TURN_PRESENTATION,
  pickUserMessagePresentation,
} from './turn-message-presentation.js'

describe('turn message presentation', () => {
  it('keeps all platform-generated user prompts hidden with explicit sources', () => {
    expect(SCHEDULED_TASK_TURN_PRESENTATION).toEqual({
      turnSource: 'scheduled_task',
      userMessageVisibility: 'hidden',
    })
    expect(GOAL_CONTRACT_DRAFT_TURN_PRESENTATION).toEqual({
      turnSource: 'goal_contract_draft',
      userMessageVisibility: 'hidden',
    })
    expect(GOAL_ITERATION_TURN_PRESENTATION).toEqual({
      turnSource: 'goal_iteration',
      userMessageVisibility: 'hidden',
    })
  })

  it('does not copy unrelated runtime options into persisted events', () => {
    expect(
      pickUserMessagePresentation({
        ...SCHEDULED_TASK_TURN_PRESENTATION,
        workspaceRootPath: '/private/project',
        agentId: 'agent-1',
      } as typeof SCHEDULED_TASK_TURN_PRESENTATION & {
        workspaceRootPath: string
        agentId: string
      }),
    ).toEqual(SCHEDULED_TASK_TURN_PRESENTATION)
  })
})
