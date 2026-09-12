import { describe, expect, it } from 'vitest'
import { TeamModeConfigSchema } from './schemas/index.js'

const AGENT_ID = '11111111-1111-4111-8111-111111111111'

function baseConfig() {
  return {
    enabled: true,
    hostAgentId: AGENT_ID,
    memberAgentIds: [AGENT_ID],
    maxDepth: 1,
    allowNesting: false,
  }
}

describe('TeamModeConfigSchema 会话级可选字段透传', () => {
  it('保留 dispatchTimeoutMs 与 threadContextTokenBudget（提交回写 round-trip）', () => {
    const parsed = TeamModeConfigSchema.parse({
      ...baseConfig(),
      dispatchTimeoutMs: 1_800_000,
      threadContextTokenBudget: 6000,
    })
    // 渲染端提交会整体替换 sessions.metadata.team；字段若在 IPC 校验（strip）中丢失，
    // DB 补丁会被静默冲掉，派发超时回落默认 600s。
    expect(parsed.dispatchTimeoutMs).toBe(1_800_000)
    expect(parsed.threadContextTokenBudget).toBe(6000)
  })

  it('未携带可选字段的老配置保持兼容', () => {
    const parsed = TeamModeConfigSchema.parse(baseConfig())
    expect(parsed.dispatchTimeoutMs).toBeUndefined()
    expect(parsed.threadContextTokenBudget).toBeUndefined()
  })

  it('拒绝超出后端上限的 dispatchTimeoutMs（MAX_DISPATCH_TIMEOUT_MS 对齐）', () => {
    expect(() =>
      TeamModeConfigSchema.parse({ ...baseConfig(), dispatchTimeoutMs: 1_800_001 }),
    ).toThrow()
    expect(() =>
      TeamModeConfigSchema.parse({ ...baseConfig(), dispatchTimeoutMs: 5_000 }),
    ).toThrow()
  })
})
