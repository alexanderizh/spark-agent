import type { AgentEvent, WorkflowProgressEvent, WorkflowProgressNode } from '@spark/protocol'
import { describe, expect, it } from 'vitest'
import { MessageBuilder, type UIBlock } from './event-mapper'

function progressNodes(completed: number, skipped = 0): WorkflowProgressNode[] {
  return Array.from({ length: 15 }, (_, index) => ({
    nodeId: `node-${index + 1}`,
    title: `Node ${index + 1}`,
    kind: 'agent',
    status: index < completed ? 'completed' : index < completed + skipped ? 'skipped' : 'pending',
  }))
}

function progressEvent(
  patch: Partial<WorkflowProgressEvent> & Pick<WorkflowProgressEvent, 'id' | 'turnId'>,
): WorkflowProgressEvent {
  const { id, turnId, ...rest } = patch
  return {
    id,
    type: 'workflow_progress',
    sessionId: 'session-1',
    turnId,
    timestamp: '2026-09-06T00:00:00.000Z',
    seq: 1,
    workflowId: 'workflow-1',
    runStatus: 'working',
    nodes: progressNodes(0),
    ...rest,
  }
}

function userEvent(id: string, turnId: string, seq: number): AgentEvent {
  return {
    id,
    type: 'user_message',
    sessionId: 'session-1',
    turnId,
    timestamp: '2026-09-06T00:00:00.000Z',
    seq,
    content: 'continue',
  }
}

function workflowBlocks(builder: MessageBuilder) {
  return builder
    .getAllMessages()
    .flatMap((message) => message.blocks)
    .filter(
      (block): block is Extract<UIBlock, { kind: 'workflow_progress' }> =>
        block.kind === 'workflow_progress',
    )
}

describe('MessageBuilder workflow progress reconciliation', () => {
  it('merges the same run across turns and replaces the old blocks reference', () => {
    const builder = new MessageBuilder()
    builder.processEvent(
      progressEvent({
        id: 'progress-1',
        turnId: 'turn-1',
        runId: 'run-1',
        nodes: progressNodes(6),
      }),
    )
    const originalMessage = builder.getAllMessages()[0]
    const originalBlocks = originalMessage?.blocks

    builder.processEvent(userEvent('user-2', 'turn-2', 2))
    builder.processEvent(
      progressEvent({
        id: 'progress-2',
        turnId: 'turn-2',
        runId: 'run-1',
        runStatus: 'completed',
        nodes: progressNodes(14, 1),
        seq: 3,
      }),
    )

    const blocks = workflowBlocks(builder)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ runId: 'run-1', runStatus: 'completed' })
    expect(blocks[0]?.nodes.filter((node) => node.status === 'completed')).toHaveLength(14)
    expect(blocks[0]?.nodes.filter((node) => node.status === 'skipped')).toHaveLength(1)
    expect(builder.getAllMessages()[0]?.blocks).not.toBe(originalBlocks)
    expect(builder.getAllMessages()[0]?.eventIds).toContain('progress-2')
  })

  it('keeps different run ids separate even for the same workflow', () => {
    const builder = new MessageBuilder()
    builder.processEvent(progressEvent({ id: 'progress-1', turnId: 'turn-1', runId: 'run-1' }))
    builder.processEvent(userEvent('user-2', 'turn-2', 2))
    builder.processEvent(
      progressEvent({ id: 'progress-2', turnId: 'turn-2', runId: 'run-2', seq: 3 }),
    )

    expect(workflowBlocks(builder).map((block) => block.runId)).toEqual(['run-1', 'run-2'])
  })

  it('conservatively merges legacy cross-turn snapshots that preserve settled progress', () => {
    const builder = new MessageBuilder()
    builder.processEvent(
      progressEvent({ id: 'progress-1', turnId: 'turn-1', nodes: progressNodes(6) }),
    )
    builder.processEvent(userEvent('user-2', 'turn-2', 2))
    builder.processEvent(
      progressEvent({
        id: 'progress-2',
        turnId: 'turn-2',
        runStatus: 'completed',
        nodes: progressNodes(14, 1),
        seq: 3,
      }),
    )

    expect(workflowBlocks(builder)).toEqual([
      expect.objectContaining({ runStatus: 'completed', nodes: progressNodes(14, 1) }),
    ])
  })

  it('does not merge a legacy zero-progress snapshot into a prior incomplete run', () => {
    const builder = new MessageBuilder()
    builder.processEvent(
      progressEvent({ id: 'progress-1', turnId: 'turn-1', nodes: progressNodes(6) }),
    )
    builder.processEvent(userEvent('user-2', 'turn-2', 2))
    builder.processEvent(
      progressEvent({ id: 'progress-2', turnId: 'turn-2', nodes: progressNodes(0), seq: 3 }),
    )

    expect(workflowBlocks(builder)).toHaveLength(2)
  })
})
