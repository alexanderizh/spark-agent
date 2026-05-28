import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { CommandRegistry, createBuiltinRegistry } from '../../core/command-registry.js'
import type { CommandDeps } from '../../core/command-registry.js'
import { parseCommand } from '../../core/command-parser.js'

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

/** Helper to parse a command string and ensure it's not null */
function parse(text: string) {
  const result = parseCommand(text)
  if (!result) throw new Error(`Failed to parse: ${text}`)
  return result
}

describe('CommandRegistry', () => {
  it('returns error for unknown command', async () => {
    const registry = new CommandRegistry()
    const result = await registry.execute(parse('/unknown'), ctx, makeDeps())
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

  it('has three-layer architecture commands', () => {
    const registry = createBuiltinRegistry()
    const cmds = registry.list()
    // Layer 1: SDK commands
    const sdkCmds = cmds.filter((c) => c.layer === 'sdk')
    expect(sdkCmds.length).toBeGreaterThan(10)
    // Layer 2: Builtin commands
    const builtinCmds = cmds.filter((c) => c.layer === 'builtin')
    expect(builtinCmds.length).toBeGreaterThan(10)
  })

  it('supports command aliases', () => {
    const registry = createBuiltinRegistry()
    // 'cost' is an alias for 'usage'
    const cmd = registry.get('cost')
    expect(cmd).toBeDefined()
    expect(cmd?.name).toBe('usage')
  })

  it('lists items with layer and group info', () => {
    const registry = createBuiltinRegistry()
    const items = registry.listItems()
    expect(items.length).toBeGreaterThan(20)
    expect(items[0]).toHaveProperty('layer')
    expect(items[0]).toHaveProperty('group')
    expect(items[0]).toHaveProperty('risk')
  })
})

describe('Built-in commands', () => {
  const registry = createBuiltinRegistry()

  it('/help returns command list', async () => {
    const result = await registry.execute(parse('/help'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('/help')
  })

  it('/status returns session info', async () => {
    const result = await registry.execute(parse('/status'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('sess-1')
  })

  it('/model with arg updates model', async () => {
    const deps = makeDeps()
    const result = await registry.execute(parse('/model gpt-4o'), ctx, deps)
    expect(result.success).toBe(true)
    expect(deps.updateSession).toHaveBeenCalledWith('sess-1', { modelId: 'gpt-4o' })
  })

  it('/model without arg shows current', async () => {
    const result = await registry.execute(parse('/model'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('Provider 默认')
  })

  it('/clear calls clearSessionEvents', async () => {
    const deps = makeDeps()
    const result = await registry.execute(parse('/clear'), ctx, deps)
    expect(result.success).toBe(true)
    expect(deps.clearSessionEvents).toHaveBeenCalledWith('sess-1')
  })

  it('/approval on enables approval', async () => {
    const deps = makeDeps()
    const result = await registry.execute(parse('/approval on'), ctx, deps)
    expect(result.success).toBe(true)
    expect(deps.setApprovalMode).toHaveBeenCalledWith('sess-1', true)
  })

  it('/approval with invalid arg returns error', async () => {
    const result = await registry.execute(parse('/approval maybe'), ctx, makeDeps())
    expect(result.success).toBe(false)
  })

  it('/rename updates session title', async () => {
    const deps = makeDeps()
    const result = await registry.execute(parse('/rename New Title'), ctx, deps)
    expect(result.success).toBe(true)
    expect(deps.updateSession).toHaveBeenCalledWith('sess-1', { title: 'New Title' })
  })

  it('/reason validates levels', async () => {
    const result = await registry.execute(parse('/reason invalid'), ctx, makeDeps())
    expect(result.success).toBe(false)
    const result2 = await registry.execute(parse('/reason high'), ctx, makeDeps())
    expect(result2.success).toBe(true)
  })

  it('/workflow shows subcommands', async () => {
    const result = await registry.execute(parse('/workflow'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('list')
    expect(result.message).toContain('run')
  })

  it('/agent list returns info', async () => {
    const result = await registry.execute(parse('/agent list'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('Code Agent')
  })

  it('/validate lists and runs workspace validation scripts', async () => {
    const cwd = makeWorkspace({ typecheck: 'tsc --noEmit', dev: 'vite' })
    try {
      const deps = makeDeps({
        getWorkspacePath: () => cwd,
        execShell: vi.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 })),
      })
      const list = await registry.execute(parse('/validate'), ctx, deps)
      expect(list.success).toBe(true)
      expect(list.message).toContain('npm run typecheck')

      const run = await registry.execute(parse('/validate npm run typecheck'), ctx, deps)
      expect(run.success).toBe(true)
      expect(deps.execShell).toHaveBeenCalledWith('npm run typecheck', cwd)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('/validate refuses non-validation scripts', async () => {
    const cwd = makeWorkspace({ typecheck: 'tsc --noEmit', postinstall: 'node unsafe.js' })
    try {
      const deps = makeDeps({
        getWorkspacePath: () => cwd,
        execShell: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
      })
      const result = await registry.execute(parse('/validate npm run postinstall'), ctx, deps)
      expect(result.success).toBe(false)
      expect(deps.execShell).not.toHaveBeenCalled()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('/validate --repair returns a follow-up prompt when validation fails', async () => {
    const cwd = makeWorkspace({ typecheck: 'tsc --noEmit' })
    try {
      const deps = makeDeps({
        getWorkspacePath: () => cwd,
        execShell: vi.fn(async () => ({ stdout: '', stderr: 'src/app.ts(1,1): error TS2322', exitCode: 2 })),
      })
      const result = await registry.execute(parse('/validate "npm run typecheck" --repair'), ctx, deps)
      expect(result.success).toBe(false)
      expect(result.message).toContain('Repair summary queued for Agent')
      expect(result.data).toMatchObject({
        repairQueued: true,
        validationRepair: { attempt: 1, maxAttempts: 3, nextAttempt: 2, stopped: false },
      })
      expect(result.followUpPrompt).toContain('验证命令: npm run typecheck')
      expect(result.followUpPrompt).toContain('error TS2322')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('/validate --repair stops when max retries are exhausted', async () => {
    const cwd = makeWorkspace({ typecheck: 'tsc --noEmit' })
    try {
      const deps = makeDeps({
        getWorkspacePath: () => cwd,
        execShell: vi.fn(async () => ({ stdout: '', stderr: 'still failing', exitCode: 2 })),
      })
      const result = await registry.execute(parse('/validate "npm run typecheck" --repair --attempt 2 --max-retries 2'), ctx, deps)
      expect(result.success).toBe(false)
      expect(result.message).toContain('Repair loop stopped')
      expect(result.data).toMatchObject({
        repairQueued: false,
        validationRepair: { attempt: 2, maxAttempts: 2, nextAttempt: null, stopped: true, stopReason: 'max_retries_exhausted' },
      })
      expect(result.followUpPrompt).toBeUndefined()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('/checkpoint list shows session checkpoints', async () => {
    const deps = makeDeps({
      listSessionCheckpoints: vi.fn(() => [{
        checkpointId: 'chk_123456',
        label: 'before edit',
        path: '.spark/checkpoints/chk_123456',
        filePaths: ['src/app.ts'],
      }]),
    })
    const result = await registry.execute(parse('/checkpoint list'), ctx, deps)
    expect(result.success).toBe(true)
    expect(result.message).toContain('chk_123456')
    expect(result.message).toContain('src/app.ts')
  })

  it('/checkpoint restore delegates to runtime restore dependency', async () => {
    const restoreCheckpoint = vi.fn(async () => ({
      checkpointId: 'chk_123456',
      restoredFiles: ['src/app.ts'],
      missingFiles: [],
    }))
    const deps = makeDeps({ restoreCheckpoint })
    const result = await registry.execute(parse('/checkpoint restore chk_123456'), ctx, deps)
    expect(result.success).toBe(true)
    expect(restoreCheckpoint).toHaveBeenCalledWith('sess-1', 'chk_123456')
    expect(result.data).toMatchObject({ restoredFiles: ['src/app.ts'] })
  })
})

describe('Command Parser', () => {
  it('parses simple command', () => {
    const result = parse('/help')
    expect(result).toBeDefined()
    expect(result?.name).toBe('help')
    expect(result?.args).toEqual([])
  })

  it('parses command with args', () => {
    const result = parse('/model gpt-4o')
    expect(result?.name).toBe('model')
    expect(result?.args).toEqual(['gpt-4o'])
  })

  it('parses command with flags', () => {
    const result = parse('/compact --keep decisions')
    expect(result?.flags).toEqual({ keep: 'decisions' })
  })

  it('parses @targets', () => {
    const result = parse('/pin @src/file.ts')
    expect(result?.targets).toEqual(['@src/file.ts'])
  })

  it('parses quoted args', () => {
    const result = parse('/rename "My Session Title"')
    expect(result?.args).toEqual(['My Session Title'])
  })

  it('returns null for non-commands', () => {
    expect(parseCommand('hello world')).toBeNull()
  })

  it('extracts alias via registry', () => {
    const registry = createBuiltinRegistry()
    const cmd = registry.get('new')
    expect(cmd).toBeDefined()
    expect(cmd?.name).toBe('new-session')
  })
})

function makeWorkspace(scripts: Record<string, string>): string {
  const cwd = mkdtempSync(path.join(process.cwd(), 'tmp-command-registry-'))
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts }, null, 2))
  return cwd
}
