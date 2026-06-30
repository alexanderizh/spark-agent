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
    expect(items.length).toBeGreaterThanOrEqual(20)
    expect(items[0]).toHaveProperty('layer')
    expect(items[0]).toHaveProperty('group')
    expect(items[0]).toHaveProperty('risk')
  })

  it('marks compatibility commands as hidden from the command palette', () => {
    const registry = createBuiltinRegistry()
    const items = registry.listItems()
    const hiddenNames = items.filter((item) => item.palette?.hidden === true).map((item) => item.name)
    expect(hiddenNames).toEqual(expect.arrayContaining(['help', 'compact', 'add-dir', 'memory', 'review', 'plan']))
    expect(items.find((item) => item.name === 'status')?.palette?.hidden).not.toBe(true)
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

  it('registerCustomCommands adds valid enabled commands and skips invalid entries', () => {
    const registry = createBuiltinRegistry()
    registry.registerCustomCommands([
      { id: 'plan', name: '/custom-plan', description: 'Plan work', prompt: 'Create a plan', script: '', scriptLanguage: 'javascript', enabled: true },
      { id: 'bad', name: '/1-invalid', description: 'Invalid', prompt: 'No-op', script: '', scriptLanguage: 'python', enabled: true },
      { id: 'disabled', name: '/disabled-command', description: 'Disabled', prompt: 'No-op', script: '', scriptLanguage: 'python', enabled: false },
    ])

    expect(registry.get('custom-plan')?.layer).toBe('custom')
    expect(registry.get('custom-plan')?.description).toBe('Plan work')
    expect(registry.get('1-invalid')).toBeUndefined()
    expect(registry.get('disabled-command')).toBeUndefined()
  })

  it('custom prompt command returns followUpPrompt with arguments', async () => {
    const registry = createBuiltinRegistry()
    registry.registerCustomCommands([
      { id: 'plan', name: '/custom-plan', description: 'Plan work', prompt: 'Create a plan', script: '', scriptLanguage: 'javascript', enabled: true },
    ])

    const result = await registry.execute(parse('/custom-plan auth refactor'), ctx, makeDeps())
    expect(result.success).toBe(true)
    expect(result.followUpPrompt).toContain('Create a plan')
    expect(result.followUpPrompt).toContain('auth refactor')
  })

  it('custom script command executes through injected shell dependency', async () => {
    const execShell = vi.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }))
    const registry = createBuiltinRegistry()
    registry.registerCustomCommands([
      { id: 'script', name: '/custom-script', description: 'Run script', prompt: '', script: 'console.log(process.argv[2])', scriptLanguage: 'javascript', enabled: true },
    ])

    const result = await registry.execute(parse('/custom-script hello'), ctx, makeDeps({ execShell }))
    expect(result.success).toBe(true)
    expect(result.message).toContain('stdout')
    expect(execShell).toHaveBeenCalledWith(expect.stringContaining('node'), undefined)
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

  it('/usage shows session token and cost totals from deps', async () => {
    const result = await registry.execute(parse('/usage'), ctx, makeDeps({
      getSessionUsage: vi.fn(() => ({ totalInputTokens: 1234, totalOutputTokens: 567, totalCost: 0.0425 })),
    }))
    expect(result.success).toBe(true)
    expect(result.message).toContain('1,234')
    expect(result.message).toContain('567')
    expect(result.message).toContain('$0.0425')
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

  it('/goal creates a Spark-managed goal instead of forwarding to agent', async () => {
    const deps = makeDeps({
      setGoal: vi.fn(async () => ({ id: 'goal-1', objective: 'ship the feature' })),
    })
    const result = await registry.execute(parse('/goal ship the feature'), ctx, deps)
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBeUndefined()
    expect(deps.setGoal).toHaveBeenCalledWith('sess-1', 'ship the feature')
  })

  it('/goal pause controls the current Spark-managed goal', async () => {
    const deps = makeDeps({
      controlGoal: vi.fn(async () => ({ id: 'goal-1', status: 'paused' })),
    })
    const result = await registry.execute(parse('/goal pause'), ctx, deps)
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBeUndefined()
    expect(deps.controlGoal).toHaveBeenCalledWith('sess-1', 'pause', '')
  })

  it('/goal confirm activates a pending contract', async () => {
    const deps = makeDeps({
      confirmGoalContract: vi.fn(async () => ({ id: 'goal-1', status: 'active' })),
    })
    const result = await registry.execute(parse('/goal confirm'), ctx, deps)
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBeUndefined()
    expect(deps.confirmGoalContract).toHaveBeenCalledWith('sess-1')
  })

  it('/goal confirm fails when contract not activatable (gate enforced)', async () => {
    const deps = makeDeps({
      confirmGoalContract: vi.fn(async () => ({ id: 'goal-1', status: 'pending_contract' })),
    })
    const result = await registry.execute(parse('/goal confirm'), ctx, deps)
    expect(result.success).toBe(false)
    expect(deps.confirmGoalContract).toHaveBeenCalledWith('sess-1')
  })

  it('/goal reject clears a pending contract', async () => {
    const deps = makeDeps({
      rejectGoalContract: vi.fn(async () => null),
    })
    const result = await registry.execute(parse('/goal reject'), ctx, deps)
    expect(result.success).toBe(true)
    expect(result.forwardToAgent).toBeUndefined()
    expect(deps.rejectGoalContract).toHaveBeenCalledWith('sess-1')
  })

  it('/goal status surfaces a pending acceptance contract', async () => {
    const deps = makeDeps({
      getGoal: vi.fn(() => ({ id: 'goal-1', status: 'pending_contract', successCriteria: ['builds pass', 'tests green'] })),
    })
    const result = await registry.execute(parse('/goal status'), ctx, deps)
    expect(result.success).toBe(true)
    expect(result.message).toContain('待确认验收契约')
    expect(result.message).toContain('builds pass')
    expect(result.message).toContain('/goal confirm')
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

  it('/side is removed instead of forwarding as a normal agent turn', async () => {
    const result = await registry.execute(parse('/side should be separate'), ctx, makeDeps())
    expect(result.success).toBe(false)
    expect(result.message).toContain('/help')
    expect(result.forwardToAgent).not.toBe(true)
  })

  it('/btw alias is removed with /side', async () => {
    const result = await registry.execute(parse('/btw should be separate'), ctx, makeDeps())
    expect(result.success).toBe(false)
    expect(result.forwardToAgent).not.toBe(true)
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

  it('/diff shows only unstaged working tree diff', async () => {
    const execShell = vi.fn(async (command: string) => {
      if (command === 'git diff') {
        return { stdout: 'diff --git a/src/app.ts b/src/app.ts\n+unstaged', stderr: '', exitCode: 0 }
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const result = await registry.execute(parse('/diff'), ctx, makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell,
    }))

    expect(result.success).toBe(true)
    expect(result.message).toContain('## Working tree diff')
    expect(result.message).toContain('```diff\n')
    expect(result.message).toContain('+unstaged')
    expect(result.message).toContain('## Staged diff')
    expect(result.message).toContain('## Untracked files')
    expect(execShell).toHaveBeenCalledWith('git diff', '/fake/workspace')
    expect(execShell).toHaveBeenCalledWith('git diff --cached', '/fake/workspace')
    expect(execShell).toHaveBeenCalledWith('git ls-files --others --exclude-standard', '/fake/workspace')
  })

  it('/diff shows only staged diff', async () => {
    const execShell = vi.fn(async (command: string) => {
      if (command === 'git diff --cached') {
        return { stdout: 'diff --git a/src/app.ts b/src/app.ts\n+staged', stderr: '', exitCode: 0 }
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const result = await registry.execute(parse('/diff'), ctx, makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell,
    }))

    expect(result.success).toBe(true)
    expect(result.message).toContain('## Working tree diff')
    expect(result.message).toContain('## Staged diff')
    expect(result.message).toContain('+staged')
    expect(result.message).toContain('## Untracked files')
  })

  it('/diff shows only untracked files outside diff fences', async () => {
    const execShell = vi.fn(async (command: string) => {
      if (command === 'git ls-files --others --exclude-standard') {
        return { stdout: 'notes.txt\nsrc/new-file.ts\n', stderr: '', exitCode: 0 }
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const result = await registry.execute(parse('/diff'), ctx, makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell,
    }))

    expect(result.success).toBe(true)
    expect(result.message).toContain('## Untracked files')
    expect(result.message).toContain('```\nnotes.txt\nsrc/new-file.ts\n```')
    expect(result.message).not.toContain('```diff\nnotes.txt')
  })

  it('/diff returns no changes when working tree, staged, and untracked are empty', async () => {
    const result = await registry.execute(parse('/diff'), ctx, makeDeps({
      getWorkspacePath: () => '/fake/workspace',
      execShell: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    }))

    expect(result.success).toBe(true)
    expect(result.message).toBe('没有文件变更。')
  })

  it('/doctor reports missing workspace', async () => {
    const result = await registry.execute(parse('/doctor'), ctx, makeDeps({
      getWorkspacePath: () => null,
      execShell: vi.fn(async (command: string) => ({
        stdout: command.includes('git --version') ? 'git version 2.40.0' : 'spark-shell-ok',
        stderr: '',
        exitCode: 0,
      })),
      checkSdkAvailability: vi.fn(async () => ({ claudeSdk: true, codexCli: true, openaiSdk: true })),
      checkWorkspaceShell: vi.fn(async () => ({ available: true, shell: '/bin/bash' })),
      getCurrentAgentSummary: vi.fn(() => ({
        id: 'agent-1',
        name: 'Agent',
        exists: true,
        enabled: true,
        hasModelConfig: true,
      })),
      getMcpStatusSummary: vi.fn(() => []),
    }))

    expect(result.success).toBe(true)
    expect(result.message).toContain('## Session')
    expect(result.message).toContain('Workspace: ⚠️ 未打开')
    expect(result.message).toContain('未打开 workspace')
  })

  it('/doctor reports missing shell', async () => {
    const result = await registry.execute(parse('/doctor'), ctx, makeDeps({
      getWorkspacePath: () => '/workspace/app',
      checkSdkAvailability: vi.fn(async () => ({ claudeSdk: true, codexCli: true, openaiSdk: true })),
      checkWorkspaceShell: vi.fn(async () => ({ available: false, error: 'ENOENT' })),
      getCurrentAgentSummary: vi.fn(() => ({
        id: 'agent-1',
        name: 'Agent',
        exists: true,
        enabled: true,
        hasModelConfig: true,
      })),
      getMcpStatusSummary: vi.fn(() => []),
    }))

    expect(result.success).toBe(true)
    expect(result.message).toContain('Shell: ❌ 不可用：ENOENT')
    expect(result.message).toContain('workspace shell 不可执行')
  })

  it('/doctor reports missing provider and model', async () => {
    const result = await registry.execute(parse('/doctor'), ctx, makeDeps({
      getSession: vi.fn(() => ({ title: 'Test', status: 'idle', modelId: null, providerProfileId: '' })),
      getProviderName: vi.fn(() => null),
      getWorkspacePath: () => '/workspace/app',
      execShell: vi.fn(async (command: string) => ({
        stdout: command.includes('git --version') ? 'git version 2.40.0' : 'spark-shell-ok',
        stderr: '',
        exitCode: 0,
      })),
      checkSdkAvailability: vi.fn(async () => ({ claudeSdk: true, codexCli: true, openaiSdk: true })),
      checkWorkspaceShell: vi.fn(async () => ({ available: true, shell: '/bin/bash' })),
      getCurrentAgentSummary: vi.fn(() => ({
        id: 'agent-1',
        name: 'Agent',
        exists: true,
        enabled: true,
        hasModelConfig: false,
      })),
      getMcpStatusSummary: vi.fn(() => []),
    }))

    expect(result.success).toBe(true)
    expect(result.message).toContain('Provider: ❌ 未配置')
    expect(result.message).toContain('Model: ⚠️ 未配置')
    expect(result.message).toContain('当前 session 缺少 provider 配置')
  })

  it('/doctor reports all healthy sections', async () => {
    const result = await registry.execute(parse('/doctor'), ctx, makeDeps({
      getSession: vi.fn(() => ({
        title: 'Test',
        status: 'idle',
        modelId: 'gpt-4.1',
        providerProfileId: 'p1',
        agentAdapter: 'codex',
        permissionMode: 'codex-default',
        agentId: 'agent-1',
      })),
      getWorkspacePath: () => '/workspace/app',
      execShell: vi.fn(async (command: string) => ({
        stdout: command.includes('git --version') ? 'git version 2.40.0' : 'spark-shell-ok',
        stderr: '',
        exitCode: 0,
      })),
      checkSdkAvailability: vi.fn(async () => ({ claudeSdk: true, codexCli: true, openaiSdk: true })),
      checkWorkspaceShell: vi.fn(async () => ({ available: true, shell: '/bin/bash' })),
      getCurrentAgentSummary: vi.fn(() => ({
        id: 'agent-1',
        name: 'Agent',
        exists: true,
        enabled: true,
        hasModelConfig: true,
        providerProfileId: 'p1',
        modelId: 'gpt-4.1',
      })),
      getMcpStatusSummary: vi.fn(() => [{
        id: 'mcp-1',
        name: 'Local MCP',
        enabled: true,
        connected: true,
        toolCount: 3,
      }]),
    }))

    expect(result.success).toBe(true)
    for (const section of ['## Session', '## Provider/Model', '## Agent Adapter', '## Shell/Git', '## MCP', '## Known Issues / Suggestions']) {
      expect(result.message).toContain(section)
    }
    expect(result.message).toContain('✅ 未发现明显问题')
    expect(result.message).toContain('1/1 enabled servers connected')
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
