import { describe, it, expect, vi } from 'vitest'
import { CommandRegistry, createBuiltinRegistry } from '../../core/command-registry.js'
import type { CommandDeps } from '../../core/command-registry.js'

function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    getSession: vi.fn(() => ({ title: 'Test', status: 'idle', modelId: null, providerProfileId: 'p1' })),
    updateSession: vi.fn(async () => {}),
    clearSessionEvents: vi.fn(async () => {}),
    getProviderName: vi.fn(() => 'Anthropic'),
    setApprovalMode: vi.fn(),
    ...overrides,
  }
}

const ctx = { sessionId: 'sess-1' }

describe('CommandRegistry', () => {
  it('returns error for unknown command', async () => {
    const registry = new CommandRegistry()
    const result = await registry.execute({ name: 'unknown', args: [], flags: {}, rawText: '/unknown' }, ctx, makeDeps())
    expect(result.success).toBe(false)
    expect(result.message).toContain('/help')
  })

  it('lists registered commands', () => {
    const registry = createBuiltinRegistry()
    const cmds = registry.list()
    expect(cmds.map((c) => c.name)).toContain('help')
    expect(cmds.map((c) => c.name)).toContain('status')
    expect(cmds.map((c) => c.name)).toContain('model')
  })
})

describe('Built-in commands', () => {
  const registry = createBuiltinRegistry()

  it('/help returns command list', async () => {
    const result = await registry.execute({ name: 'help', args: [], flags: {}, rawText: '/help' }, ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('/help')
  })

  it('/status returns session info', async () => {
    const result = await registry.execute({ name: 'status', args: [], flags: {}, rawText: '/status' }, ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('sess-1')
  })

  it('/model with arg updates model', async () => {
    const deps = makeDeps()
    const result = await registry.execute({ name: 'model', args: ['gpt-4o'], flags: {}, rawText: '/model gpt-4o' }, ctx, deps)
    expect(result.success).toBe(true)
    expect(deps.updateSession).toHaveBeenCalledWith('sess-1', { modelId: 'gpt-4o' })
  })

  it('/model without arg shows current', async () => {
    const result = await registry.execute({ name: 'model', args: [], flags: {}, rawText: '/model' }, ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('Provider 默认')
  })

  it('/clear calls clearSessionEvents', async () => {
    const deps = makeDeps()
    const result = await registry.execute({ name: 'clear', args: [], flags: {}, rawText: '/clear' }, ctx, deps)
    expect(result.success).toBe(true)
    expect(deps.clearSessionEvents).toHaveBeenCalledWith('sess-1')
  })

  it('/approval on enables approval', async () => {
    const deps = makeDeps()
    const result = await registry.execute({ name: 'approval', args: ['on'], flags: {}, rawText: '/approval on' }, ctx, deps)
    expect(result.success).toBe(true)
    expect(deps.setApprovalMode).toHaveBeenCalledWith('sess-1', true)
  })

  it('/approval with invalid arg returns error', async () => {
    const result = await registry.execute({ name: 'approval', args: ['maybe'], flags: {}, rawText: '/approval maybe' }, ctx, makeDeps())
    expect(result.success).toBe(false)
  })
})
