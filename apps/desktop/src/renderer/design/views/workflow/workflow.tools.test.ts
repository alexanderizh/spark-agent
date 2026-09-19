import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowGraph } from '@spark/protocol'
import {
  executeWorkflowTool,
  getWorkflowToolSchemas,
  READONLY_WORKFLOW_TOOL_NAMES,
  type WorkflowToolContext,
} from './workflow.tools'

const graphFixture = {
  nodes: [
    { id: 'node-1', kind: 'input', title: '需求输入', config: {} },
    { id: 'node-2', kind: 'agent', title: '执行节点', config: {} },
  ],
  edges: [{ id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' }],
} as unknown as WorkflowGraph

function createState(overrides?: Partial<{ workflowId: string | null; name: string }>) {
  return {
    workflowId: 'wf-1',
    name: '代码评审工作流',
    graph: graphFixture,
    ...overrides,
  }
}

function createContext(state: ReturnType<typeof createState> | null): WorkflowToolContext {
  return {
    getEditorState: vi.fn(() => state),
    createWorkflow: vi.fn(async () => ({
      workflowId: 'wf-new',
      updatedAt: '2026-09-19T10:00:00Z',
    })),
    updateWorkflow: vi.fn(async () => ({ updatedAt: '2026-09-19T11:00:00Z' })),
    getWorkflowUpdatedAt: vi.fn(async () => '2026-09-19T09:00:00Z'),
    validateGraph: vi.fn(async () => ({ ok: true, diagnostics: [] })),
  }
}

describe('workflow_get_graph', () => {
  it('returns the live graph plus baseVersion from the persisted workflow', async () => {
    const ctx = createContext(createState())
    const result = (await executeWorkflowTool(ctx, 'workflow_get_graph', {})) as {
      workflowId: string
      graph: WorkflowGraph
      baseVersion: string
    }
    expect(result.workflowId).toBe('wf-1')
    expect(result.graph).toBe(graphFixture)
    expect(result.baseVersion).toBe('2026-09-19T09:00:00Z')
    expect(ctx.getWorkflowUpdatedAt).toHaveBeenCalledWith('wf-1')
  })

  it('returns a null baseVersion for an unsaved draft graph', async () => {
    const ctx = createContext(createState({ workflowId: null }))
    const result = (await executeWorkflowTool(ctx, 'workflow_get_graph', {})) as {
      workflowId: null
      baseVersion: null
    }
    expect(result.workflowId).toBeNull()
    expect(result.baseVersion).toBeNull()
    expect(ctx.getWorkflowUpdatedAt).not.toHaveBeenCalled()
  })

  it('throws when the editor is not ready', async () => {
    const ctx = createContext(null)
    await expect(executeWorkflowTool(ctx, 'workflow_get_graph', {})).rejects.toThrow('尚未就绪')
  })
})

describe('workflow_validate', () => {
  it('defaults to the editor graph when no graph is provided', async () => {
    const ctx = createContext(createState())
    await executeWorkflowTool(ctx, 'workflow_validate', {})
    expect(ctx.validateGraph).toHaveBeenCalledWith(graphFixture)
  })

  it('prefers the explicit graph argument', async () => {
    const ctx = createContext(createState())
    const other = { nodes: [], edges: [] } as unknown as WorkflowGraph
    await executeWorkflowTool(ctx, 'workflow_validate', { graph: other })
    expect(ctx.validateGraph).toHaveBeenCalledWith(other)
  })
})

describe('workflow_generate', () => {
  it('creates a new workflow and notifies the editor when unbound', async () => {
    const ctx = createContext(createState({ workflowId: null }))
    ctx.onWorkflowCreated = vi.fn()
    const result = (await executeWorkflowTool(ctx, 'workflow_generate', {
      name: '新工作流',
      graph: graphFixture,
    })) as { created: boolean; workflowId: string }
    expect(result.created).toBe(true)
    expect(result.workflowId).toBe('wf-new')
    expect(ctx.createWorkflow).toHaveBeenCalledWith({ name: '新工作流', graph: graphFixture })
    expect(ctx.onWorkflowCreated).toHaveBeenCalledWith('wf-new')
  })

  it('never creates a second workflow when the editor is already bound', async () => {
    const ctx = createContext(createState())
    const result = (await executeWorkflowTool(ctx, 'workflow_generate', {
      name: '重复创建',
      graph: graphFixture,
    })) as { created: boolean; instruction: string }
    expect(result.created).toBe(false)
    expect(result.instruction).toContain('workflow_patch')
    expect(ctx.createWorkflow).not.toHaveBeenCalled()
  })

  it('rejects a missing name', async () => {
    const ctx = createContext(createState({ workflowId: null }))
    await expect(
      executeWorkflowTool(ctx, 'workflow_generate', { graph: graphFixture }),
    ).rejects.toThrow('name')
  })
})

describe('workflow_patch optimistic lock', () => {
  it('submits the full graph when baseVersion matches the persisted updatedAt', async () => {
    const ctx = createContext(createState())
    const result = (await executeWorkflowTool(ctx, 'workflow_patch', {
      baseVersion: '2026-09-19T09:00:00Z',
      graph: graphFixture,
    })) as { updated: boolean; baseVersion: string }
    expect(result.updated).toBe(true)
    expect(result.baseVersion).toBe('2026-09-19T11:00:00Z')
    expect(ctx.updateWorkflow).toHaveBeenCalledWith({ id: 'wf-1', graph: graphFixture })
  })

  it('rejects with the current baseVersion when the graph changed since read', async () => {
    const ctx = createContext(createState())
    const result = (await executeWorkflowTool(ctx, 'workflow_patch', {
      baseVersion: 'stale-version',
      graph: graphFixture,
    })) as { updated: boolean; reason: string; currentBaseVersion: string }
    expect(result.updated).toBe(false)
    expect(result.reason).toBe('graph_changed_since_read')
    expect(result.currentBaseVersion).toBe('2026-09-19T09:00:00Z')
    expect(ctx.updateWorkflow).not.toHaveBeenCalled()
  })

  it('reports workflow_not_found when the bound workflow disappeared', async () => {
    const ctx = createContext(createState())
    ;(ctx.getWorkflowUpdatedAt as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = (await executeWorkflowTool(ctx, 'workflow_patch', {
      baseVersion: 'anything',
      graph: graphFixture,
    })) as { updated: boolean; reason: string }
    expect(result.updated).toBe(false)
    expect(result.reason).toBe('workflow_not_found')
    expect(ctx.updateWorkflow).not.toHaveBeenCalled()
  })

  it('throws when the editor is not bound to a saved workflow', async () => {
    const ctx = createContext(createState({ workflowId: null }))
    await expect(
      executeWorkflowTool(ctx, 'workflow_patch', {
        baseVersion: 'v1',
        graph: graphFixture,
      }),
    ).rejects.toThrow('workflow_generate')
  })
})

describe('tool registry', () => {
  it('exposes schemas matching the spark_workflow MCP contract and marks readonly tools', () => {
    const schemas = getWorkflowToolSchemas()
    expect(schemas.map((schema) => schema.name)).toEqual([
      'workflow_get_graph',
      'workflow_validate',
      'workflow_generate',
      'workflow_patch',
    ])
    for (const schema of schemas) {
      expect(schema.description.length).toBeGreaterThan(0)
      expect(schema.inputSchema).toBeTypeOf('object')
    }
    expect(READONLY_WORKFLOW_TOOL_NAMES.has('workflow_get_graph')).toBe(true)
    expect(READONLY_WORKFLOW_TOOL_NAMES.has('workflow_generate')).toBe(false)
  })

  it('rejects unknown tool names', async () => {
    const ctx = createContext(createState())
    await expect(executeWorkflowTool(ctx, 'workflow_delete_everything', {})).rejects.toThrow(
      '未知工作流工具',
    )
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})
