import { describe, expect, it } from 'vitest'
import type { CustomToolRecord } from '@spark/protocol'
import { executeCustomTool } from '../../services/custom-tools/custom-tool-executor.js'

function codeRecord(source: string, toolIds: string[] = []): CustomToolRecord {
  const now = new Date(0).toISOString()
  return {
    id: 'calculation_tool',
    title: '计算工具',
    description: '执行用户定义的 TypeScript 计算逻辑并返回结构化结果。',
    type: 'code',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 5_000,
    spec: {
      runtime: { kind: 'trusted-worker', language: 'typescript', source, entryExport: 'default' },
      permissions: { toolIds },
      limits: { memoryMb: 64, maxOutputBytes: 64 * 1024 },
      trust: 'trusted-local',
    },
    enabled: true,
    origin: 'local',
    publishedVersion: 1,
    draftVersion: 1,
    lastTestAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

const baseContext = () => ({
  signal: new AbortController().signal,
  resolveSecret: async () => '',
})

describe('native code custom tool worker', () => {
  it('executes TypeScript in a standalone worker and returns structured output', async () => {
    const result = await executeCustomTool(
      codeRecord(
        'export default async function(input: { a: number; b: number }) { return { sum: input.a + input.b } }',
      ),
      { a: 4, b: 7 },
      baseContext(),
    )

    expect(JSON.parse(result.text)).toEqual({ sum: 11 })
    expect(result.meta.bytes).toBeGreaterThan(0)
  })

  it('composes only explicitly allow-listed native tools through the host broker', async () => {
    const result = await executeCustomTool(
      codeRecord(
        `export default async function(input: { a: number; b: number }, sdk: any) {
          const nested = await sdk.tools.call('number_lookup', { value: input.a })
          return { nested, total: input.a + input.b }
        }`,
        ['number_lookup'],
      ),
      { a: 2, b: 3 },
      {
        ...baseContext(),
        invokeTool: async (toolId, input) => ({ toolId, input }),
      },
    )

    expect(JSON.parse(result.text)).toEqual({
      nested: { toolId: 'number_lookup', input: { value: 2 } },
      total: 5,
    })
  })

  it('rejects undeclared composition and unavailable module imports', async () => {
    await expect(
      executeCustomTool(
        codeRecord(
          `export default async function(_input: unknown, sdk: any) {
            return sdk.tools.call('hidden_tool', {})
          }`,
        ),
        { a: 1, b: 2 },
        { ...baseContext(), invokeTool: async () => 'should-not-run' },
      ),
    ).rejects.toThrow(/未在代码工具权限白名单/)

    await expect(
      executeCustomTool(
        codeRecord(
          `import fs from 'node:fs'; export default async function() { return fs.readFileSync('/etc/hosts', 'utf8') }`,
        ),
        { a: 1, b: 2 },
        baseContext(),
      ),
    ).rejects.toThrow(/Imports are not available/)
  })
})
