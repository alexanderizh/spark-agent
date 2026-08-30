import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  governAgentToolResultEvent,
  governMcpToolResult,
  listToolResultArtifacts,
  readToolResultArtifact,
  searchToolResultArtifact,
  type ToolResultEnvelope,
} from '../../tools/tool-result-artifact-store.mjs'

describe('tool result artifact store', () => {
  let workspaceRoot = ''

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-tool-results-'))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('leaves bounded MCP results unchanged', () => {
    const result = { content: [{ type: 'text', text: 'small result' }] }
    expect(governMcpToolResult(result, { workspaceRoot, toolName: 'small' })).toBe(result)
    expect(listToolResultArtifacts(workspaceRoot)).toEqual([])
  })

  it('leaves bounded agent tool-result events unchanged', () => {
    const event = {
      id: 'event-small',
      type: 'tool_result',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: new Date().toISOString(),
      seq: 1,
      toolCallId: 'call-small',
      toolName: 'bash',
      status: 'success',
      output: 'small result',
    } satisfies AgentEvent

    expect(governAgentToolResultEvent(event, workspaceRoot)).toBe(event)
    expect(listToolResultArtifacts(workspaceRoot)).toEqual([])
  })

  it('archives large results once and returns an error-aware envelope', () => {
    const output = [
      'build started',
      ...Array.from({ length: 4_000 }, (_, index) => `line ${index}: regular output`),
      'TypeError: cannot read property value',
      'at src/main.ts:42:7',
      'build failed',
    ].join('\n')
    const event = {
      id: 'event-1',
      type: 'tool_result',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: new Date().toISOString(),
      seq: 1,
      toolCallId: 'call-1',
      toolName: 'bash',
      status: 'error',
      output,
      error: output,
    } satisfies AgentEvent

    const governed = governAgentToolResultEvent(event, workspaceRoot)
    const envelope = governed.output as ToolResultEnvelope
    expect(envelope.kind).toBe('spark.tool_result_envelope')
    expect(envelope.preview.strategy).toBe('error-context-and-boundaries')
    expect(envelope.preview.text).toContain('TypeError')
    expect(envelope.preview.text).toContain('build failed')
    expect(envelope.preview.text.length).toBeLessThan(9_000)
    expect(governed.error).toBe(envelope.preview.text)
    expect(envelope.artifact.available).toBe(true)
    if (!envelope.artifact.available) throw new Error('expected archived result')

    const full = readToolResultArtifact(workspaceRoot, envelope.artifact.artifactId, {
      offset: 0,
      limit: 40_000,
    })
    expect(full.content).toContain('build started')
    expect(full.nextOffset).not.toBeNull()

    const match = searchToolResultArtifact(workspaceRoot, envelope.artifact.artifactId, 'TypeError')
    expect(match.totalMatches).toBe(1)
    expect(match.matches[0]?.snippet).toContain('src/main.ts:42:7')

    const again = governAgentToolResultEvent({ ...event, id: 'event-2' }, workspaceRoot)
    const secondEnvelope = again.output as ToolResultEnvelope
    expect(secondEnvelope.artifact.available).toBe(true)
    if (!secondEnvelope.artifact.available) throw new Error('expected reused result')
    expect(secondEnvelope.artifact.artifactId).toBe(envelope.artifact.artifactId)
    expect(secondEnvelope.artifact.reused).toBe(true)
    expect(listToolResultArtifacts(workspaceRoot)).toHaveLength(1)
  })

  it('archives large MCP structured content without re-injecting binary blocks', () => {
    const result = {
      _meta: { 'spark/ui-resource': 'ui://large-result' },
      content: [
        { type: 'image', data: 'a'.repeat(30_000), mimeType: 'image/png' },
        { type: 'text', text: 'x'.repeat(30_000) },
      ],
      structuredContent: { source: 'y'.repeat(30_000) },
    }
    const governed = governMcpToolResult(result, {
      workspaceRoot,
      toolName: 'mcp__example__large',
    }) as {
      _meta: { 'spark/ui-resource': string }
      content: Array<{ type: string; text?: string }>
      structuredContent: ToolResultEnvelope
    }

    expect(governed._meta).toEqual({ 'spark/ui-resource': 'ui://large-result' })
    expect(governed.content).toHaveLength(1)
    expect(governed.content[0]?.type).toBe('text')
    expect(governed.structuredContent.kind).toBe('spark.tool_result_envelope')
    expect(governed.structuredContent.preview.strategy).toBe('sanitized-and-boundaries')
    expect(governed.content[0]?.text?.length).toBeLessThan(10_000)
    expect(governed.content[0]?.text).toContain('binary payload omitted from preview')
    expect(governed.content[0]?.text).not.toContain('a'.repeat(512))
  })

  it('does not follow a symlinked tool-result directory outside the workspace', () => {
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'spark-tool-results-outside-'))
    mkdirSync(path.join(workspaceRoot, '.spark-agent'), { recursive: true })
    symlinkSync(
      outsideRoot,
      path.join(workspaceRoot, '.spark-agent', 'tool-results'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    try {
      const result = governMcpToolResult(
        { content: [{ type: 'text', text: 'x'.repeat(30_000) }] },
        { workspaceRoot, toolName: 'unsafe-result' },
      ) as { structuredContent: ToolResultEnvelope }
      expect(result.structuredContent.artifact.available).toBe(false)
      expect(result.structuredContent.preview.text).toContain('完整结果未能归档')
      expect(result.structuredContent.preview.text).not.toContain('完整工具结果已归档')
      expect(existsSync(path.join(outsideRoot, `${'x'.repeat(64)}.txt`))).toBe(false)
      expect(existsSync(path.join(outsideRoot, 'unsafe-result'))).toBe(false)
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('rejects a content-addressed artifact that was modified after creation', () => {
    const governed = governMcpToolResult(
      { content: [{ type: 'text', text: 'original'.repeat(5_000) }] },
      { workspaceRoot, toolName: 'tamper-check' },
    ) as { structuredContent: ToolResultEnvelope }
    expect(governed.structuredContent.artifact.available).toBe(true)
    if (!governed.structuredContent.artifact.available) {
      throw new Error('expected archived result')
    }
    const artifact = governed.structuredContent.artifact
    writeFileSync(path.join(workspaceRoot, artifact.relativePath), 'tampered', 'utf8')

    expect(() => readToolResultArtifact(workspaceRoot, artifact.artifactId)).toThrow(
      '完整性校验失败',
    )
    expect(() => searchToolResultArtifact(workspaceRoot, artifact.artifactId, 'tampered')).toThrow(
      '完整性校验失败',
    )
  })
})
