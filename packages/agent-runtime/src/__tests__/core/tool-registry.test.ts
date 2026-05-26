import { describe, it, expect, beforeEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ToolRegistry } from '../../core/tool-registry.js'
import type { ToolCallEvent } from '@spark/protocol'

const BASE = { id: 'e1', sessionId: 's1', turnId: 't1', timestamp: new Date().toISOString(), seq: 0, provider: 'mock' as const }

function makeToolCall(name: string, input: Record<string, unknown>): ToolCallEvent {
  return { ...BASE, type: 'tool_call', toolCallId: 'tc1', toolName: name, toolInput: input, source: 'builtin' }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry
  let tmpDir: string

  beforeEach(async () => {
    registry = new ToolRegistry()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-test-'))
  })

  it('getDefinitions returns 4 built-in tools', () => {
    const defs = registry.getDefinitions()
    expect(defs.map((d) => d.name)).toEqual(
      expect.arrayContaining(['read_file', 'write_file', 'list_directory', 'search_files']),
    )
    expect(defs).toHaveLength(4)
  })

  it('read_file reads a temp file', async () => {
    await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'hello world')
    const result = await registry.execute({ workspaceRootPath: tmpDir }, makeToolCall('read_file', { path: 'hello.txt' }), BASE)
    expect(result.status).toBe('success')
    expect(result.output).toBe('hello world')
  })

  it('read_file rejects path traversal', async () => {
    const result = await registry.execute({ workspaceRootPath: tmpDir }, makeToolCall('read_file', { path: '../etc/passwd' }), BASE)
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/outside workspace/i)
  })

  it('unknown tool returns error', async () => {
    const result = await registry.execute({ workspaceRootPath: tmpDir }, makeToolCall('nonexistent', {}), BASE)
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/Unknown tool/)
  })

  it('write_file creates a file', async () => {
    const result = await registry.execute({ workspaceRootPath: tmpDir }, makeToolCall('write_file', { path: 'out.txt', content: 'data' }), BASE)
    expect(result.status).toBe('success')
    const content = await fs.readFile(path.join(tmpDir, 'out.txt'), 'utf-8')
    expect(content).toBe('data')
  })

  it('list_directory lists entries', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), '')
    const result = await registry.execute({ workspaceRootPath: tmpDir }, makeToolCall('list_directory', { path: '.' }), BASE)
    expect(result.status).toBe('success')
    expect(result.output).toEqual(expect.arrayContaining([{ name: 'a.txt', type: 'file' }]))
  })
})
