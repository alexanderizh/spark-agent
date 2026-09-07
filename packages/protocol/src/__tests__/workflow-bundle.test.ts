import { describe, expect, it } from 'vitest'
import {
  BUNDLE_SKILL_ID_PREFIX,
  WorkflowBundleChecksumsSchema,
  WorkflowBundleManifestSchema,
  WorkflowBundleWorkflowFileSchema,
  workflowBundleSecretPathFromPlaceholder,
  workflowBundleSecretPlaceholder,
} from '../workflow-bundle.js'

const sha = (n: number) => String(n).padStart(64, '0')

function validManifestInput() {
  return {
    schemaVersion: 1 as const,
    name: '舆情分析流水线',
    exportedAt: '2026-09-05T10:00:00.000Z',
    workflows: [{ file: 'workflows/0.json', name: '主流程' }],
    skills: [{ slug: 'web-search', path: 'skills/web-search', sha256: sha(1) }],
    mcpServers: [
      {
        refId: 'tavily',
        name: 'Tavily Search',
        transport: 'http' as const,
        file: 'mcp/tavily.json',
        requiredSecrets: [{ path: 'headers.X-API-Key', label: 'API Key', required: true }],
      },
    ],
    unresolved: [{ type: 'agent' as const, nodeId: 'node-1', hint: '需手动绑定执行 Agent' }],
    verification: { status: 'passed' as const, checks: [{ id: 'graph', ok: true }] },
  }
}

describe('WorkflowBundleManifestSchema', () => {
  it('解析完整 manifest 并补全默认值', () => {
    const parsed = WorkflowBundleManifestSchema.parse(validManifestInput())
    expect(parsed.version).toBe('1.0.0')
    expect(parsed.verification.status).toBe('passed')
    expect(parsed.mcpServers[0]?.requiredSecrets).toHaveLength(1)
    expect(parsed.skills[0]?.slug).toBe('web-search')
  })

  it('拒绝错误的 schemaVersion', () => {
    expect(() =>
      WorkflowBundleManifestSchema.parse({ ...validManifestInput(), schemaVersion: 2 }),
    ).toThrow()
  })

  it('拒绝目录穿越的包内路径', () => {
    const input = validManifestInput()
    input.workflows = [{ file: '../etc/passwd', name: 'x' }]
    expect(() => WorkflowBundleManifestSchema.parse(input)).toThrow()
  })

  it('拒绝绝对路径与反斜杠路径', () => {
    const input = validManifestInput()
    input.skills = [{ slug: 'a', path: '/abs/path', sha256: sha(1) }]
    expect(() => WorkflowBundleManifestSchema.parse(input)).toThrow()
    const input2 = validManifestInput()
    input2.skills = [{ slug: 'a', path: 'skills\\a', sha256: sha(1) }]
    expect(() => WorkflowBundleManifestSchema.parse(input2)).toThrow()
  })

  it('至少要求一个工作流', () => {
    const input = validManifestInput()
    input.workflows = []
    expect(() => WorkflowBundleManifestSchema.parse(input)).toThrow()
  })

  it('拒绝非小写十六进制的 sha256', () => {
    const input = validManifestInput()
    input.skills = [{ slug: 'a', path: 'skills/a', sha256: 'XYZ' }]
    expect(() => WorkflowBundleManifestSchema.parse(input)).toThrow()
  })
})

describe('WorkflowBundleWorkflowFileSchema', () => {
  it('要求 nodes/edges 数组并保留未知字段', () => {
    const parsed = WorkflowBundleWorkflowFileSchema.parse({
      name: '流程',
      graph: { nodes: [{ id: 'a' }], edges: [], futureField: 1 },
    })
    expect(parsed.status).toBe('draft')
    expect(parsed.tags).toEqual([])
    expect((parsed.graph as Record<string, unknown>).futureField).toBe(1)
  })

  it('graph 缺少 nodes 时拒绝', () => {
    expect(() =>
      WorkflowBundleWorkflowFileSchema.parse({ name: '流程', graph: { edges: [] } }),
    ).toThrow()
  })
})

describe('WorkflowBundleChecksumsSchema', () => {
  it('接受 path -> sha256 映射', () => {
    const parsed = WorkflowBundleChecksumsSchema.parse({
      algorithm: 'sha256',
      files: { 'manifest.json': sha(2), 'workflows/0.json': sha(3) },
    })
    expect(parsed.files['manifest.json']).toBe(sha(2))
  })

  it('algorithm 固定为 sha256', () => {
    expect(() => WorkflowBundleChecksumsSchema.parse({ algorithm: 'md5', files: {} })).toThrow()
  })
})

describe('密钥占位符', () => {
  it('生成与还原互逆', () => {
    const ph = workflowBundleSecretPlaceholder('headers.X-API-Key')
    expect(ph).toBe('{{secret:headers.X-API-Key}}')
    expect(workflowBundleSecretPathFromPlaceholder(ph)).toBe('headers.X-API-Key')
  })

  it('非占位符返回 null', () => {
    expect(workflowBundleSecretPathFromPlaceholder('sk-abc123')).toBeNull()
    expect(workflowBundleSecretPathFromPlaceholder('{{secret:}}')).toBeNull()
  })
})

describe('bundle 技能 ID 前缀约定', () => {
  it('前缀用于运行时防污染回落过滤', () => {
    expect(BUNDLE_SKILL_ID_PREFIX).toBe('bundle:')
    expect(`bundle:abc123:web-search`.startsWith(BUNDLE_SKILL_ID_PREFIX)).toBe(true)
    expect('skill:skillhub:web-search'.startsWith(BUNDLE_SKILL_ID_PREFIX)).toBe(false)
  })
})
