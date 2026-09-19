import { describe, expect, it } from 'vitest'

import {
  isCompactCapable,
  isRateLimitsCapable,
  isSteerCapable,
  isThreadAttachmentsCapable,
} from '../engine-executor.js'
import { CodexAppServerExecutor } from './codex-app-server-executor.js'

/**
 * 载具级能力（steer/compact/thread attachments/rateLimits）的聚焦测试：
 * 能力守卫识别 + 无活跃 turn/thread 时的确定性报错。带活跃 client 的
 * 透传路径依赖 app-server 进程，由协议检查与集成链路覆盖。
 */
describe('CodexAppServerExecutor capabilities', () => {
  it('is detected by the capability probes', () => {
    const executor = new CodexAppServerExecutor()
    expect(isSteerCapable(executor)).toBe(true)
    expect(isCompactCapable(executor)).toBe(true)
    expect(isThreadAttachmentsCapable(executor)).toBe(true)
    expect(isRateLimitsCapable(executor)).toBe(true)
  })

  it('rejects attachment and rate-limit reads without an active turn context', async () => {
    const executor = new CodexAppServerExecutor()
    await expect(executor.listThreadAttachments()).rejects.toThrow(
      /no active codex app-server thread to list attachments/u,
    )
    await expect(
      executor.setThreadAttachment({ attachmentType: 't', identityKey: 'k', payload: 1 }),
    ).rejects.toThrow(/no active codex app-server thread to write attachments/u)
    await expect(
      executor.removeThreadAttachment({ attachmentType: 't', identityKey: 'k' }),
    ).rejects.toThrow(/no active codex app-server thread to remove attachments/u)
    await expect(executor.getAccountRateLimits()).rejects.toThrow(
      /no active codex app-server client to read rate limits/u,
    )
  })
})
