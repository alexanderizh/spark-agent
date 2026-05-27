import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ToolRegistry } from '../../../core/tool-registry.js'
import type { ToolCallEvent } from '@spark/protocol'

const BASE = { id: 'e1', sessionId: 's1', turnId: 't1', timestamp: new Date().toISOString(), seq: 0, provider: 'mock' as const }

function makeToolCall(name: string, input: Record<string, unknown>): ToolCallEvent {
  return { ...BASE, type: 'tool_call', toolCallId: 'tc1', toolName: name, toolInput: input, source: 'builtin' }
}

describe('grep tool', () => {
  let registry: ToolRegistry
  let tmpDir: string

  beforeEach(async () => {
    registry = new ToolRegistry()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-grep-test-'))
    // Create test files
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'const greeting = "hello world";\nconsole.log(greeting);\n')
    await fs.writeFile(path.join(tmpDir, 'b.ts'), 'const farewell = "goodbye world";\nconsole.log(farewell);\n')
    await fs.writeFile(path.join(tmpDir, 'c.js'), 'var greeting = "hello javascript";\nconsole.log(greeting);\n')
    await fs.mkdir(path.join(tmpDir, 'sub'))
    await fs.writeFile(path.join(tmpDir, 'sub', 'd.ts'), 'const sub = "sub hello";\n')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // --- Basic search ---

  it('finds matching text across files', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('grep', { pattern: 'greeting' }),
      BASE,
    )
    expect(result.status).toBe('success')
    expect(result.output).toContain('greeting')
  })

  it('returns no matches for non-existent pattern', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('grep', { pattern: 'xyznonexistentpattern123' }),
      BASE,
    )
    expect(result.status).toBe('success')
    expect(result.output).toMatch(/no match/i)
  })

  // --- Input validation ---

  it('rejects empty pattern', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('grep', { pattern: '' }),
      BASE,
    )
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/no search pattern/i)
  })

  it('rejects path outside workspace', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('grep', { pattern: 'test', path: '../../etc' }),
      BASE,
    )
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/outside workspace/i)
  })

  // --- Case sensitivity ---

  it('searches case-insensitively by default', async () => {
    await fs.writeFile(path.join(tmpDir, 'case.txt'), 'Hello World')
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('grep', { pattern: 'hello' }),
      BASE,
    )
    expect(result.status).toBe('success')
    expect(result.output).toContain('Hello')
  })

  // --- Custom path ---

  it('searches in specified subdirectory', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('grep', { pattern: 'hello', path: 'sub' }),
      BASE,
    )
    expect(result.status).toBe('success')
    expect(result.output).toContain('sub hello')
  })

  // --- File type filtering ---

  it('filters by file glob pattern', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('grep', { pattern: 'greeting', include: '*.ts' }),
      BASE,
    )
    expect(result.status).toBe('success')
    if (typeof result.output === 'string') {
      // Should find .ts files but not .js files
      expect(result.output).not.toContain('.js')
    }
  })

  // --- Duration tracking ---

  it('tracks durationMs', async () => {
    const result = await registry.execute(
      { workspaceRootPath: tmpDir },
      makeToolCall('grep', { pattern: 'test' }),
      BASE,
    )
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
