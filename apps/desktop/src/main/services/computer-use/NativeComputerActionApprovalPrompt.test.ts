import { describe, expect, it, vi } from 'vitest'
import { createNativeComputerActionApprovalPrompt } from './NativeComputerActionApprovalPrompt.js'

describe('NativeComputerActionApprovalPrompt', () => {
  it('uses a native main-process confirmation with only deny and exact one-time allow', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 1 }))
    const prompt = createNativeComputerActionApprovalPrompt({
      getWindow: () => ({ id: 1, isDestroyed: () => false }) as never,
      showMessageBox,
    })

    await expect(
      prompt({
        sessionId: 'session-1',
        toolName: 'mcp__spark_computer__approve_click',
        riskLevel: 'L2',
        toolInput: {
          intent: 'Send the prepared message',
          targetAppId: 'mail',
          action: { type: 'click', point: { x: 0.5, y: 0.5 } },
        },
      }),
    ).resolves.toBe(true)
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'warning',
        buttons: ['拒绝', '仅允许这一次'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }),
    )
  })

  it('fails closed when no trusted main window exists or the native dialog fails', async () => {
    const missing = createNativeComputerActionApprovalPrompt({
      getWindow: () => null,
      showMessageBox: vi.fn(),
    })
    await expect(
      missing({ sessionId: 's', toolName: 'approve', riskLevel: 'L3', toolInput: {} }),
    ).resolves.toBe(false)

    const failed = createNativeComputerActionApprovalPrompt({
      getWindow: () => ({ id: 1, isDestroyed: () => false }) as never,
      showMessageBox: vi.fn(async () => {
        throw new Error('dialog unavailable')
      }),
    })
    await expect(
      failed({ sessionId: 's', toolName: 'approve', riskLevel: 'L3', toolInput: {} }),
    ).resolves.toBe(false)
  })
})
