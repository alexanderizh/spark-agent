import { describe, expect, it } from 'vitest'
import type { CanvasWorkflowDefinition } from '@spark/protocol'
import { buildCanvasWorkflowExport, parseCanvasWorkflowImport } from './canvasWorkflowTransfer'

const workflow: CanvasWorkflowDefinition = {
  id: 'workflow-1',
  projectId: null,
  name: '社媒套图',
  description: '生成三张社媒图片',
  scope: 'library',
  status: 'published',
  version: 2,
  tags: ['社媒'],
  package: {
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: 'generate',
          kind: 'canvas_operation',
          label: '生成',
          position: { x: 0, y: 0 },
          config: { operation: 'text_to_image' },
        },
      ],
      edges: [],
    },
    contract: { inputs: [], outputs: [], exposedParams: [] },
    dependencies: { modelCapabilities: ['text_to_image'], canvasNodeKinds: ['operation'] },
  },
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
}

describe('canvas workflow transfer format', () => {
  it('round-trips a versioned export without local identity or scope', () => {
    const exported = buildCanvasWorkflowExport(workflow, '2026-07-23T12:00:00.000Z')
    const imported = parseCanvasWorkflowImport(JSON.stringify(exported))

    expect(exported).not.toHaveProperty('workflow.id')
    expect(exported).not.toHaveProperty('workflow.scope')
    expect(imported).toEqual({
      name: workflow.name,
      description: workflow.description,
      tags: workflow.tags,
      package: workflow.package,
    })
  })

  it('rejects unsupported export versions', () => {
    const exported = buildCanvasWorkflowExport(workflow, '2026-07-23T12:00:00.000Z')
    expect(() =>
      parseCanvasWorkflowImport(JSON.stringify({ ...exported, exportVersion: 2 })),
    ).toThrow(/版本/)
  })

  it('rejects a corrupted workflow package', () => {
    const exported = buildCanvasWorkflowExport(workflow, '2026-07-23T12:00:00.000Z')
    expect(() =>
      parseCanvasWorkflowImport(
        JSON.stringify({ ...exported, workflow: { ...exported.workflow, package: {} } }),
      ),
    ).toThrow(/定义/)
  })
})
