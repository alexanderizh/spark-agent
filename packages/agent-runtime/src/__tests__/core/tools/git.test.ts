import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ToolRegistry } from '../../../core/tool-registry.js'
import { isGitReadonly, isGitDenied } from '../../../core/tools/git.js'
import type { ToolCallEvent } from '@spark/protocol'

const BASE = { id: 'e1', sessionId: 's1', turnId: 't1', timestamp: new Date().toISOString(), seq: 0, provider: 'mock' as const }

function makeToolCall(name: string, input: Record<string, unknown>): ToolCallEvent {
  return { ...BASE, type: 'tool_call', toolCallId: 'tc1', toolName: name, toolInput: input, source: 'builtin' }
}

describe('git tool', () => {
  let registry: ToolRegistry
  let tmpDir: string

  beforeEach(async () => {
    registry = new ToolRegistry()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-git-test-'))
    // Initialize a git repo
    await exec('git init')
    await exec('git config user.email "test@test.com"')
    await exec('git config user.name "Test"')
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test Project')
    await exec('git add README.md')
    await exec('git commit -m "Initial commit"')
  }, 30000)

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    return promisify(exec)(cmd, { cwd: tmpDir })
  }

  // --- Read operations (auto-approved) ---

  it('executes git status', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'status' }),
      BASE,
    )
    expect(result.status).toBe('success')
    expect(result.output).toMatch(/main|master|nothing to commit|On branch/)
  })

  it('executes git log', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'log' }),
      BASE,
    )
    expect(result.status).toBe('success')
    expect(result.output).toContain('Initial commit')
  })

  it('executes git branch', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'branch' }),
      BASE,
    )
    expect(result.status).toBe('success')
    expect(result.output).toMatch(/main|master/)
  })

  it('executes git diff', async () => {
    // Modify a file to create diff
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test Project\n\nModified content')
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'diff' }),
      BASE,
    )
    expect(result.status).toBe('success')
  })

  it('executes git remote', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'remote' }),
      BASE,
    )
    expect(result.status).toBe('success')
  })

  it('executes git show', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'show' }),
      BASE,
    )
    expect(result.status).toBe('success')
    expect(result.output).toContain('Initial commit')
  })

  // --- Write operations (require approval) ---

  it('executes git add', async () => {
    await fs.writeFile(path.join(tmpDir, 'new-file.txt'), 'content')
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'add', args: 'new-file.txt' }),
      BASE,
    )
    expect(result.status).toBe('success')
  })

  it('executes git commit', async () => {
    await fs.writeFile(path.join(tmpDir, 'another.txt'), 'content')
    await exec('git add another.txt')
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'commit', args: '-m "Second commit"' }),
      BASE,
    )
    expect(result.status).toBe('success')
  })

  it('executes git checkout to create branch', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'checkout', args: '-b feature-test' }),
      BASE,
    )
    expect(result.status).toBe('success')
  })

  // --- Denied operations ---

  it('denies git push', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'push' }),
      BASE,
    )
    expect(result.status).toBe('denied')
    expect(result.error).toMatch(/blocked/i)
  })

  it('denies git push_force', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'push_force' }),
      BASE,
    )
    expect(result.status).toBe('denied')
  })

  it('denies git reset_hard', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'reset_hard' }),
      BASE,
    )
    expect(result.status).toBe('denied')
  })

  it('denies git clean', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'clean' }),
      BASE,
    )
    expect(result.status).toBe('denied')
  })

  // --- Input validation ---

  it('rejects empty operation', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', {}),
      BASE,
    )
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/no git operation/i)
  })

  it('rejects unknown operation', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'unknown_op' }),
      BASE,
    )
    expect(result.status).toBe('denied')
  })

  // --- Duration tracking ---

  it('tracks durationMs', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('git', { operation: 'status' }),
      BASE,
    )
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('isGitReadonly', () => {
  it('status is readonly', () => {
    expect(isGitReadonly('status')).toBe(true)
  })
  it('log is readonly', () => {
    expect(isGitReadonly('log')).toBe(true)
  })
  it('diff is readonly', () => {
    expect(isGitReadonly('diff')).toBe(true)
  })
  it('branch is readonly', () => {
    expect(isGitReadonly('branch')).toBe(true)
  })
  it('show is readonly', () => {
    expect(isGitReadonly('show')).toBe(true)
  })
  it('remote is readonly', () => {
    expect(isGitReadonly('remote')).toBe(true)
  })
  it('tag is readonly', () => {
    expect(isGitReadonly('tag')).toBe(true)
  })
  it('stash_list is readonly', () => {
    expect(isGitReadonly('stash_list')).toBe(true)
  })
  it('blame is readonly', () => {
    expect(isGitReadonly('blame')).toBe(true)
  })
  it('add is NOT readonly', () => {
    expect(isGitReadonly('add')).toBe(false)
  })
  it('commit is NOT readonly', () => {
    expect(isGitReadonly('commit')).toBe(false)
  })
  it('checkout is NOT readonly', () => {
    expect(isGitReadonly('checkout')).toBe(false)
  })
})

describe('isGitDenied', () => {
  it('push is denied', () => {
    expect(isGitDenied('push')).toBe(true)
  })
  it('push_force is denied', () => {
    expect(isGitDenied('push_force')).toBe(true)
  })
  it('reset_hard is denied', () => {
    expect(isGitDenied('reset_hard')).toBe(true)
  })
  it('clean is denied', () => {
    expect(isGitDenied('clean')).toBe(true)
  })
  it('cherry_pick is denied', () => {
    expect(isGitDenied('cherry_pick')).toBe(true)
  })
  it('status is NOT denied', () => {
    expect(isGitDenied('status')).toBe(false)
  })
  it('commit is NOT denied', () => {
    expect(isGitDenied('commit')).toBe(false)
  })
})
