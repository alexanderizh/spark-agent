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
    getProviderModelIds: vi.fn(() => ['gpt-4o', 'gpt-4.1']),
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

  it('has two-layer architecture commands', () => {
    const registry = createBuiltinRegistry()
    const cmds = registry.list()
    // Layer 1: SDK commands
    const sdkCmds = cmds.filter((c) => c.layer === 'sdk')
    expect(sdkCmds.length).toBeGreaterThan(10)
    // Layer 2: Builtin commands
    const builtinCmds = cmds.filter((c) => c.layer === 'builtin')
    expect(builtinCmds.length).toBeGreaterThan(0)
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

  it('registerSkillCommands adds skills as Layer 3 commands', () => {
    const registry = createBuiltinRegistry()
    const beforeCount = registry.list().length
    registry.registerSkillCommands([
      { id: 'builtin:code-review', name: 'Code Review', description: 'Review code quality', tags: ['review'] },
      { id: 'builtin:translate', name: 'Translate', description: 'Translate text', tags: ['i18n'] },
    ])
    const afterCount = registry.list().length
    expect(afterCount).toBe(beforeCount + 2)

    // Verify the commands are accessible
    const reviewCmd = registry.get('code-review')
    expect(reviewCmd).toBeDefined()
    expect(reviewCmd?.layer).toBe('skill')
    expect(reviewCmd?.group).toBe('skill')
    expect(reviewCmd?.description).toBe('Review code quality')

    const translateCmd = registry.get('translate')
    expect(translateCmd).toBeDefined()
    expect(translateCmd?.layer).toBe('skill')
  })

  it('registerSkillCommands skips names that collide with Layer 1/2', () => {
    const registry = createBuiltinRegistry()
    const beforeCount = registry.list().length
    // 'status' is already registered as Layer 1 SDK command
    registry.registerSkillCommands([
      { id: 'my:status', name: 'Status', description: 'A skill named status', tags: [] },
      { id: 'my:other', name: 'Other', description: 'Other skill', tags: [] },
    ])
    const afterCount = registry.list().length
    // 'status' should be skipped (collision), only 'other' added
    expect(afterCount).toBe(beforeCount + 1)
    const statusCmd = registry.get('status')
    expect(statusCmd?.layer).toBe('sdk') // still the original
  })

  it('registerSkillCommands replaces previous skill commands on re-call', () => {
    const registry = createBuiltinRegistry()
    registry.registerSkillCommands([
      { id: '1', name: 'My Skill A', description: 'First', tags: [] },
    ])
    expect(registry.get('my-skill-a')).toBeDefined()
    // Re-register with different skills
    registry.registerSkillCommands([
      { id: '2', name: 'My Skill B', description: 'Second', tags: [] },
    ])
    expect(registry.get('my-skill-a')).toBeUndefined()
    expect(registry.get('my-skill-b')).toBeDefined()
  })

  it('registerSkillCommands handles numeric skill IDs correctly', () => {
    const registry = createBuiltinRegistry()
    // Skills from database can have numeric IDs
    registry.registerSkillCommands([
      { id: '1', name: 'Code Review', description: 'Review code', tags: [] },
      { id: '2', name: 'Translate', description: 'Translate text', tags: [] },
    ])
    // Command names should be derived from skill names, not IDs
    expect(registry.get('1')).toBeUndefined()
    expect(registry.get('2')).toBeUndefined()
    expect(registry.get('code-review')).toBeDefined()
    expect(registry.get('translate')).toBeDefined()
    expect(registry.get('code-review')?.layer).toBe('skill')
  })

  it('skill command handler returns followUpSkillId', async () => {
    const registry = createBuiltinRegistry()
    registry.registerSkillCommands([
      { id: 'builtin:code-review', name: 'Code Review', description: 'Review code', tags: ['review'] },
    ])
    const cmd = registry.get('code-review')!
    const result = await cmd.handler(
      { name: 'code-review', args: [], flags: {}, targets: [], freeText: '' } as any,
      { sessionId: 'sess-1' },
      makeDeps(),
    )
    expect(result.success).toBe(true)
    expect(result.followUpSkillId).toBe('builtin:code-review')
    expect(result.followUpPrompt).toContain('builtin:code-review')
  })

  it('skill command handler uses freeText as followUpPrompt', async () => {
    const registry = createBuiltinRegistry()
    registry.registerSkillCommands([
      { id: 'builtin:code-review', name: 'Code Review', description: 'Review code', tags: ['review'] },
    ])
    const cmd = registry.get('code-review')!
    const result = await cmd.handler(
      { name: 'code-review', args: [], flags: {}, targets: [], freeText: 'check the auth module for security issues' } as any,
      { sessionId: 'sess-1' },
      makeDeps(),
    )
    expect(result.success).toBe(true)
    expect(result.followUpPrompt).toBe('check the auth module for security issues')
    expect(result.followUpSkillId).toBe('builtin:code-review')
  })
})

describe('Built-in commands', () => {
  const registry = createBuiltinRegistry()

  it('/help returns command list', async () => {
    const result = await registry.execute(parse('/help'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('/help')
  })

  it('/help command returns implemented command details', async () => {
    const result = await registry.execute(parse('/help compact'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.message).toContain('/compact')
    expect(result.message).toContain('交给 Agent 处理')
    expect(result.message).not.toContain('待实现')
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

  it('/model rejects models outside the current provider to avoid runtime mismatch', async () => {
    const deps = makeDeps({
      getSession: vi.fn(() => ({ title: 'Test', status: 'idle', modelId: 'glm-5', providerProfileId: 'tencent-provider' })),
      getProviderName: vi.fn(() => 'Tencent Coding'),
      getProviderModelIds: vi.fn(() => ['glm-5']),
    })
    const result = await registry.execute(parse('/model mimo-v2.5-pro'), ctx, deps)
    expect(result.success).toBe(false)
    expect(result.message).toContain('不属于当前 Provider')
    expect(deps.updateSession).not.toHaveBeenCalled()
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

  it('/compact forwards to agent instead of clearing session events', async () => {
    const deps = makeDeps()
    const result = await registry.execute(parse('/compact summarize decisions'), ctx, deps)
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBe(true)
    expect(deps.clearSessionEvents).not.toHaveBeenCalled()
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

  it('/reason is removed (unknown command)', async () => {
    const result = await registry.execute(parse('/reason high'), ctx, makeDeps())
    expect(result.success).toBe(false)
    expect(result.message).toContain('/help')
  })

  it('/workflow is removed (unknown command)', async () => {
    const result = await registry.execute(parse('/workflow'), ctx, makeDeps())
    expect(result.success).toBe(false)
  })

  it('/agent is removed (unknown command)', async () => {
    const result = await registry.execute(parse('/agent list'), ctx, makeDeps())
    expect(result.success).toBe(false)
  })

  it('/git add forwards to agent', async () => {
    const result = await registry.execute(parse('/git add .'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBe(true)
  })

  it('/git commit forwards to agent', async () => {
    const result = await registry.execute(parse('/git commit "fix: bug"'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBe(true)
  })

  it('/git push forwards to agent', async () => {
    const result = await registry.execute(parse('/git push'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBe(true)
  })

  it('/git pull forwards to agent', async () => {
    const result = await registry.execute(parse('/git pull'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBe(true)
  })

  it('/git status executes locally', async () => {
    const deps = makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell: vi.fn(async () => ({ stdout: 'M src/app.ts', stderr: '', exitCode: 0 })),
    })
    const result = await registry.execute(parse('/git status'), ctx, deps)
    expect(result.success).toBe(true)
    expect(result.message).toContain('M src/app.ts')
  })

  it('/git log with numeric limit executes locally', async () => {
    const deps = makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell: vi.fn(async () => ({ stdout: 'abc123 test commit', stderr: '', exitCode: 0 })),
    })
    const result = await registry.execute(parse('/git log 5'), ctx, deps)
    expect(result.success).toBe(true)
    expect(deps.execShell).toHaveBeenCalledWith('git log --oneline -5', '/fake/workspace')
  })

  it('/git log rejects non-numeric limit', async () => {
    const deps = makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    })
    const result = await registry.execute(parse('/git log foo'), ctx, deps)
    expect(result.success).toBe(false)
    expect(result.message).toContain('用法：/git log [n]')
    expect(deps.execShell).not.toHaveBeenCalled()
  })

  it('/git log rejects shell injection attempts without executing', async () => {
    const deps = makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    })
    const result = await registry.execute(parse('/git log "1; rm -rf /"'), ctx, deps)
    expect(result.success).toBe(false)
    expect(result.message).toContain('用法：/git log [n]')
    expect(deps.execShell).not.toHaveBeenCalled()
  })

  it('/init returns existing project config when .claude/commands directory exists', async () => {
    const execShell = vi.fn(async () => ({ stdout: 'exists\n', stderr: '', exitCode: 0 }))
    const deps = makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell,
    })

    const result = await registry.execute(parse('/init'), ctx, deps)

    expect(result.success).toBe(true)
    expect(result.message).toContain('项目配置已存在')
    expect(execShell).toHaveBeenCalledTimes(1)
    expect(execShell).toHaveBeenCalledWith('test -d .claude/commands && echo "exists" || echo "not_found"', '/fake/workspace')
  })

  it('/init creates .claude/commands directory for an empty workspace', async () => {
    const execShell = vi.fn(async (command: string) => ({
      stdout: command.startsWith('test -d ') ? 'not_found\n' : '',
      stderr: '',
      exitCode: 0,
    }))
    const deps = makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell,
    })

    const result = await registry.execute(parse('/init'), ctx, deps)

    expect(result.success).toBe(true)
    expect(result.message).toContain('已创建 `.claude/commands/` 目录')
    expect(execShell).toHaveBeenNthCalledWith(1, 'test -d .claude/commands && echo "exists" || echo "not_found"', '/fake/workspace')
    expect(execShell).toHaveBeenNthCalledWith(2, 'mkdir -p .claude/commands', '/fake/workspace')
  })

  it('/skill run selects a skill for the follow-up turn', async () => {
    const result = await registry.execute(parse('/skill run skill:review inspect changes'), ctx, makeDeps({
      listSkills: () => [{
        id: 'skill:review',
        name: 'Review',
        description: 'Review changes',
        tags: ['review'],
        enabled: true,
      }],
    }))

    expect(result.success).toBe(true)
    expect(result.followUpSkillId).toBe('skill:review')
    expect(result.followUpPrompt).toBe('inspect changes')
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
    const cmd = registry.get('cp')
    expect(cmd).toBeDefined()
    expect(cmd?.name).toBe('checkpoint')
  })
})

function makeWorkspace(scripts: Record<string, string>): string {
  const cwd = mkdtempSync(path.join(process.cwd(), 'tmp-command-registry-'))
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts }, null, 2))
  return cwd
}
