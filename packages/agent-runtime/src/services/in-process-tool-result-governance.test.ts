/**
 * M4 in-process 工具结果治理测试：超限结果 envelope 化（artifact 内容完整、
 * 可经 readToolResultArtifact 读回——即 spark_tool_results MCP 同一读回链）、
 * 边界值（恰好等于阈值）不截断、团队工具 defs 包装、配置归一化。
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DEFAULT_IN_PROCESS_TOOL_RESULT_GOVERNANCE,
  IN_PROCESS_TOOL_RESULT_RANGES,
  governInProcessToolResult,
  isInProcessToolResultEnvelope,
  normalizeInProcessToolResultGovernance,
  wrapTeamToolDefinitionsWithGovernance,
} from './in-process-tool-result-governance.js'
import {
  listToolResultArtifacts,
  readToolResultArtifact,
} from '../tools/tool-result-artifact-store.mjs'
import type { TeamToolDefinition } from './team-mcp-http-bridge.js'

describe('normalizeInProcessToolResultGovernance', () => {
  it('默认 32768，越界钳制到 4096–262144（方案 §六 工具结果组）', () => {
    expect(DEFAULT_IN_PROCESS_TOOL_RESULT_GOVERNANCE.inProcessMaxChars).toBe(32_768)
    expect(normalizeInProcessToolResultGovernance(undefined)).toEqual(
      DEFAULT_IN_PROCESS_TOOL_RESULT_GOVERNANCE,
    )
    expect(normalizeInProcessToolResultGovernance({ inProcessMaxChars: 1 }).inProcessMaxChars).toBe(
      IN_PROCESS_TOOL_RESULT_RANGES.min,
    )
    expect(
      normalizeInProcessToolResultGovernance({ inProcessMaxChars: 99_999_999 }).inProcessMaxChars,
    ).toBe(IN_PROCESS_TOOL_RESULT_RANGES.max)
    // 嵌套 toolResult 形态（settings JSON 按组存放）
    expect(
      normalizeInProcessToolResultGovernance({ toolResult: { inProcessMaxChars: 8_192 } })
        .inProcessMaxChars,
    ).toBe(8_192)
  })
})

describe('governInProcessToolResult', () => {
  let workspaceRoot = ''

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-inprocess-governance-'))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('未超限结果原样返回（同一引用，逐字节不变）且不产生 artifact', () => {
    const result = {
      content: [{ type: 'text' as const, text: 'small reply' }],
      structuredContent: { ok: true },
    }
    const governed = governInProcessToolResult(result, {
      workspaceRootPath: workspaceRoot,
      toolName: 'agent_dispatch',
      maxChars: 32_768,
    })
    expect(governed).toBe(result)
    expect(listToolResultArtifacts(workspaceRoot)).toEqual([])
  })

  it('恰好等于阈值不截断（边界值，按序列化总长构造）', () => {
    // 阈值作用于序列化后的整体结果（与 stdio 治理代理同语义）：动态构造
    // 序列化长度恰好等于 maxChars 的输入。
    const wrapperLength = JSON.stringify({ content: [{ type: 'text', text: '' }] }, null, 2).length
    const text = 'a'.repeat(32_768 - wrapperLength)
    const result = { content: [{ type: 'text' as const, text }] }
    expect(JSON.stringify(result, null, 2).length).toBe(32_768)
    const governed = governInProcessToolResult(result, {
      workspaceRootPath: workspaceRoot,
      toolName: 'agent_dispatch',
      maxChars: 32_768,
    })
    expect(governed).toBe(result)
  })

  it('超限结果 envelope 化：artifact 内容完整且可读回（spark_tool_results 同链）', () => {
    const fullText = Array.from({ length: 40_000 }, (_, i) => `line-${i}`).join('\n')
    const result = {
      content: [{ type: 'text' as const, text: fullText }],
      structuredContent: { payload: fullText },
    }
    const governed = governInProcessToolResult(result, {
      workspaceRootPath: workspaceRoot,
      toolName: 'agent_dispatch',
      maxChars: 32_768,
    })
    expect(governed).not.toBe(result)
    expect(isInProcessToolResultEnvelope(governed)).toBe(true)
    if (!isInProcessToolResultEnvelope(governed)) return
    const envelope = governed.structuredContent
    expect(envelope.kind).toBe('spark.tool_result_envelope')
    expect(envelope.toolName).toBe('agent_dispatch')
    expect(envelope.artifact.available).toBe(true)
    if (!envelope.artifact.available) return
    // artifact 文件真实存在
    const artifactFile = path.join(workspaceRoot, '.spark-agent', 'tool-results')
    expect(existsSync(artifactFile)).toBe(true)
    // 读回链与 spark_tool_results MCP 一致：单页 40K 上限，分页读全量
    let offset = 0
    let content = ''
    for (let guard = 0; guard < 100; guard += 1) {
      const page = readToolResultArtifact(workspaceRoot, envelope.artifact.artifactId, {
        offset,
        limit: 40_000,
      })
      content += page.content
      if (page.eof || page.nextOffset == null) {
        expect(page.totalCharacters).toBe(envelope.artifact.characters)
        break
      }
      offset = page.nextOffset
    }
    expect(content).toContain('line-0')
    expect(content).toContain('line-39999')
    // 完整原文在 artifact 内（截断只发生在进上下文的 preview）：artifact 以 JSON
    // 序列化形态存储，解析后与原始结果逐字段一致。
    const restored = JSON.parse(content) as { content: Array<{ text: string }> }
    expect(restored.content[0]?.text).toBe(fullText)
    // continuation 指引模型用 spark_tool_results 读回
    expect(envelope.continuation?.readTool).toBe('mcp__spark_tool_results__read')
  })

  it('isError 结果保留错误态', () => {
    const errorText = 'E'.repeat(40_000)
    const result = {
      content: [{ type: 'text' as const, text: errorText }],
      isError: true,
    }
    const governed = governInProcessToolResult(result, {
      workspaceRootPath: workspaceRoot,
      toolName: 'agent_dispatch',
      maxChars: 32_768,
    })
    expect(isInProcessToolResultEnvelope(governed)).toBe(true)
    if (!isInProcessToolResultEnvelope(governed)) return
    expect(governed.isError).toBe(true)
    expect(governed.structuredContent.status).toBe('error')
  })
})

describe('wrapTeamToolDefinitionsWithGovernance', () => {
  let workspaceRoot = ''

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-inprocess-governance-'))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('包装后的 handler 透传 args、schema/name 原样、超限结果被治理', async () => {
    const seenArgs: Array<Record<string, unknown>> = []
    const def: TeamToolDefinition = {
      name: 'agent_dispatch',
      description: 'dispatch',
      schema: { targetAgentId: z.string() },
      handler: async (args) => {
        seenArgs.push(args)
        return {
          content: [{ type: 'text' as const, text: 'R'.repeat(50_000) }],
        }
      },
    }
    const [wrappedMaybe] = wrapTeamToolDefinitionsWithGovernance([def], {
      workspaceRootPath: workspaceRoot,
      maxChars: 32_768,
    })
    const wrapped = wrappedMaybe!
    expect(wrapped.name).toBe('agent_dispatch')
    expect(wrapped.description).toBe('dispatch')
    const reply = await wrapped.handler({ targetAgentId: 'worker-1' })
    expect(seenArgs).toEqual([{ targetAgentId: 'worker-1' }])
    expect(isInProcessToolResultEnvelope(reply)).toBe(true)
  })

  it('未超限结果经包装后仍为原对象', async () => {
    const def: TeamToolDefinition = {
      name: 'team_ledger_read',
      description: 'read',
      schema: {},
      handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    }
    const [wrappedMaybe] = wrapTeamToolDefinitionsWithGovernance([def], {
      workspaceRootPath: workspaceRoot,
      maxChars: 32_768,
    })
    const reply = await wrappedMaybe!.handler({})
    expect(reply).toEqual({ content: [{ type: 'text', text: 'ok' }] })
    expect(isInProcessToolResultEnvelope(reply)).toBe(false)
  })

  it('空 defs 返回空数组', () => {
    expect(
      wrapTeamToolDefinitionsWithGovernance([], {
        workspaceRootPath: workspaceRoot,
        maxChars: 32_768,
      }),
    ).toEqual([])
  })
})
