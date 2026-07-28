import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { CanvasHostBridge } from './canvas-host-bridge'

const mocks = vi.hoisted(() => ({
  createCanvasMcpServer: vi.fn(),
}))

vi.mock('@spark/agent-runtime', () => ({
  createCanvasMcpServer: mocks.createCanvasMcpServer,
  canvasAllowedToolNames: (schemas: ReadonlyArray<{ name: string }>) =>
    schemas.map((schema) => `mcp__spark_canvas__${schema.name}`),
}))

function createWebContents(): WebContents {
  return {
    once: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    send: vi.fn(),
  } as unknown as WebContents
}

describe('CanvasHostBridge.asMcpProvider', () => {
  beforeEach(() => {
    mocks.createCanvasMcpServer.mockReset()
  })

  it('keeps an attached session distinguishable while tool schemas are unavailable', async () => {
    const bridge = new CanvasHostBridge()
    bridge.attach('canvas-session', createWebContents(), 'project-1')

    const context = await bridge.asMcpProvider()('canvas-session')

    expect(context).toMatchObject({
      allowedTools: [],
      toolSchemas: [],
    })
    expect(context?.callTool).toBeTypeOf('function')
    expect(mocks.createCanvasMcpServer).not.toHaveBeenCalled()
  })

  it('still returns null for an ordinary session that is not attached to a canvas', async () => {
    const bridge = new CanvasHostBridge()

    await expect(bridge.asMcpProvider()('chat-session')).resolves.toBeNull()
  })

  it('keeps an attached session distinguishable when the in-process server throws', async () => {
    mocks.createCanvasMcpServer.mockRejectedValueOnce(new Error('SDK unavailable'))
    const bridge = new CanvasHostBridge()
    bridge.setToolSchemas([
      {
        name: 'get_project',
        description: 'Read the project.',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    bridge.attach('canvas-session', createWebContents(), 'project-1')

    const context = await bridge.asMcpProvider()('canvas-session')

    expect(context).not.toBeNull()
    expect(context?.server).toBeUndefined()
    expect(context?.toolSchemas).toHaveLength(1)
  })
})
