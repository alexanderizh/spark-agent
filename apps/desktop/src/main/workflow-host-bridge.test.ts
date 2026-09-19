import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { WorkflowHostBridge } from './workflow-host-bridge'

const mocks = vi.hoisted(() => ({
  createWorkflowMcpServer: vi.fn(),
}))

vi.mock('@spark/agent-runtime', () => ({
  createWorkflowMcpServer: mocks.createWorkflowMcpServer,
  workflowAllowedToolNames: (schemas: ReadonlyArray<{ name: string }>) =>
    schemas.map((schema) => `mcp__spark_workflow__${schema.name}`),
}))

function createWebContents(): WebContents {
  return {
    once: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    send: vi.fn(),
  } as unknown as WebContents
}

describe('WorkflowHostBridge.asMcpProvider', () => {
  beforeEach(() => {
    mocks.createWorkflowMcpServer.mockReset()
  })

  it('keeps an attached session distinguishable while tool schemas are unavailable', async () => {
    const bridge = new WorkflowHostBridge()
    bridge.attach('workflow-session', createWebContents())

    const context = await bridge.asMcpProvider()('workflow-session')

    expect(context).toMatchObject({
      allowedTools: [],
      toolSchemas: [],
    })
    expect(context?.callTool).toBeTypeOf('function')
    expect(mocks.createWorkflowMcpServer).not.toHaveBeenCalled()
  })

  it('still returns null for an ordinary session that is not attached to a workflow editor', async () => {
    const bridge = new WorkflowHostBridge()

    await expect(bridge.asMcpProvider()('chat-session')).resolves.toBeNull()
  })

  it('keeps an attached session distinguishable when the in-process server throws', async () => {
    mocks.createWorkflowMcpServer.mockRejectedValueOnce(new Error('SDK unavailable'))
    const bridge = new WorkflowHostBridge()
    bridge.setToolSchemas([
      {
        name: 'workflow_get_graph',
        description: 'Read the current workflow graph.',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    bridge.attach('workflow-session', createWebContents())

    const context = await bridge.asMcpProvider()('workflow-session')

    expect(context).not.toBeNull()
    expect(context?.server).toBeUndefined()
    expect(context?.toolSchemas).toHaveLength(1)
  })
})

describe('WorkflowHostBridge.callTool pipeline', () => {
  it('dispatches the tool call to the attached window and resolves on tool-result', async () => {
    const bridge = new WorkflowHostBridge()
    const webContents = createWebContents()
    bridge.attach('workflow-session', webContents)

    const pending = bridge.callTool('workflow-session', 'workflow_get_graph', {})
    // 派发即向绑定窗口推 stream:workflow:tool-call；从 send payload 取出 requestId
    expect(webContents.send).toHaveBeenCalledTimes(1)
    const [channel, payload] = (webContents.send as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { requestId: string; sessionId: string; toolName: string },
    ]
    expect(channel).toBe('stream:workflow:tool-call')
    expect(payload).toMatchObject({
      sessionId: 'workflow-session',
      toolName: 'workflow_get_graph',
    })

    // ACK 停掉宽限计时器，渲染端回报结果后 pending resolve
    bridge.handleToolAck(payload.requestId)
    bridge.handleToolResult({ requestId: payload.requestId, ok: true, result: { graph: {} } })

    await expect(pending).resolves.toEqual({ graph: {} })
  })

  it('rejects when the session has no attachment', async () => {
    const bridge = new WorkflowHostBridge()
    await expect(bridge.callTool('ghost-session', 'workflow_get_graph', {})).rejects.toThrow(
      /detach|从未/,
    )
  })
})
