import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../../services/event-mapper'
import { projectAssistantTurnCollapse } from './assistant-turn-collapse'

const text = (
  content: string,
  options: { streaming?: boolean; final?: boolean } = {},
): Extract<UIBlock, { kind: 'text' }> => ({
  kind: 'text',
  content,
  isStreaming: options.streaming ?? false,
  ...(options.final === true ? { isFinalAnswer: true } : {}),
})

describe('projectAssistantTurnCollapse', () => {
  it('waits for the normalized whole-turn completed status', () => {
    const blocks: UIBlock[] = [text('过程说明'), text('最终总结', { final: true })]

    expect(projectAssistantTurnCollapse('streaming', blocks)).toEqual({
      canCollapse: false,
      collapsedBlocks: blocks,
    })
    expect(projectAssistantTurnCollapse('error', blocks).canCollapse).toBe(false)
    expect(projectAssistantTurnCollapse('cancelled', blocks).canCollapse).toBe(false)
  })

  it('keeps only the provider-marked final host answer after completion', () => {
    const final = text('最终总结\n\n- 已完成 A\n- 已验证 B', { final: true })
    const blocks: UIBlock[] = [
      text('我先定位调用链。'),
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'bash',
        toolInput: { command: 'pnpm test' },
        status: 'success',
        output: 'ok',
        error: undefined,
        durationMs: 10,
      },
      final,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks)).toEqual({
      canCollapse: true,
      collapsedBlocks: [final],
    })
  })

  it('falls back to the last body for legacy completed histories', () => {
    const summary = text('旧历史最后一段正文')
    const blocks: UIBlock[] = [text('旧历史过程正文'), summary]

    expect(projectAssistantTurnCollapse('completed', blocks).collapsedBlocks).toEqual([summary])
  })

  it('does not hide pending approvals, questions, warnings, or running work', () => {
    const final = text('暂时总结', { final: true })
    const blockers: UIBlock[] = [
      { kind: 'plan_proposed', plan: '等待确认' },
      {
        kind: 'user_question',
        toolCallId: 'question-1',
        questions: [],
        answered: false,
      },
      {
        kind: 'runtime_signal',
        signal: 'rate_limit',
        level: 'warning',
        title: '额度提醒',
        message: '请注意',
        retryable: false,
      },
      {
        kind: 'team_dispatch',
        dispatchId: 'dispatch-1',
        hostAgentId: 'host',
        memberAgentId: 'member',
        task: {
          taskId: 'task-1',
          hostAgentId: 'host',
          memberAgentId: 'member',
          rootTurnId: 'turn-1',
          instruction: '检查实现',
        },
        state: 'working',
      },
    ]

    for (const blocker of blockers) {
      expect(projectAssistantTurnCollapse('completed', [final, blocker]).canCollapse).toBe(false)
    }
  })

  it('uses the final member answer when a direct team-member turn has no host answer', () => {
    const memberFinal: Extract<UIBlock, { kind: 'team_member_message' }> = {
      kind: 'team_member_message',
      dispatchId: 'dispatch-1',
      memberAgentId: 'member-1',
      content: '成员最终结论',
      isStreaming: false,
      isFinalAnswer: true,
    }
    const blocks: UIBlock[] = [
      {
        kind: 'team_dispatch',
        dispatchId: 'dispatch-1',
        hostAgentId: 'host',
        memberAgentId: 'member-1',
        task: {
          taskId: 'task-1',
          hostAgentId: 'host',
          memberAgentId: 'member-1',
          rootTurnId: 'turn-1',
          instruction: '分析问题',
        },
        state: 'completed',
      },
      memberFinal,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks)).toEqual({
      canCollapse: true,
      collapsedBlocks: [memberFinal],
    })
  })
})
