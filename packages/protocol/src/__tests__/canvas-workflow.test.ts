import { describe, expect, it } from 'vitest'
import { CanvasWorkflowIpcSchemaRegistry } from '../canvas-workflow.js'

const emptyPackage = {
  schemaVersion: 1 as const,
  graph: { nodes: [], edges: [] },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

describe('canvas workflow IPC validation', () => {
  it('accepts a project-scoped workflow with a project id', () => {
    const request = CanvasWorkflowIpcSchemaRegistry['canvas:workflow:create'].parse({
      name: '分镜到镜头图',
      scope: 'project',
      projectId: 'project-1',
      package: emptyPackage,
    })

    expect(request.scope).toBe('project')
    expect(request.projectId).toBe('project-1')
    expect(request.package.schemaVersion).toBe(1)
  })

  it('rejects a project workflow without project id', () => {
    expect(() =>
      CanvasWorkflowIpcSchemaRegistry['canvas:workflow:create'].parse({
        name: '缺少项目',
        scope: 'project',
        package: emptyPackage,
      }),
    ).toThrow(/projectId/)
  })

  it('rejects a personal-library workflow with project id', () => {
    expect(() =>
      CanvasWorkflowIpcSchemaRegistry['canvas:workflow:create'].parse({
        name: '个人模板',
        scope: 'library',
        projectId: 'project-1',
        package: emptyPackage,
      }),
    ).toThrow(/projectId/)
  })

  it('rejects unsupported package versions', () => {
    expect(() =>
      CanvasWorkflowIpcSchemaRegistry['canvas:workflow:create'].parse({
        name: '未来版本',
        scope: 'library',
        package: { ...emptyPackage, schemaVersion: 2 },
      }),
    ).toThrow(/schemaVersion/)
  })

  it('normalizes list filters and validates duplicate targets', () => {
    const list = CanvasWorkflowIpcSchemaRegistry['canvas:workflow:list'].parse({
      scope: 'project',
      projectId: 'project-1',
      query: '  镜头  ',
      limit: 30,
      offset: 60,
    })
    expect(list.query).toBe('镜头')
    expect(list.limit).toBe(30)
    expect(list.offset).toBe(60)

    expect(() =>
      CanvasWorkflowIpcSchemaRegistry['canvas:workflow:duplicate'].parse({
        id: 'workflow-1',
        targetScope: 'project',
      }),
    ).toThrow(/targetProjectId/)
  })

  it('only allows mutable user scopes at creation', () => {
    expect(() =>
      CanvasWorkflowIpcSchemaRegistry['canvas:workflow:create'].parse({
        name: '伪造内置模板',
        scope: 'builtin',
        package: emptyPackage,
      }),
    ).toThrow()
  })

  it('preserves canvas edge semantics in workflow packages', () => {
    const request = CanvasWorkflowIpcSchemaRegistry['canvas:workflow:create'].parse({
      name: '带产物连线的工作流',
      scope: 'library',
      package: {
        ...emptyPackage,
        graph: {
          nodes: [
            {
              id: 'operation',
              kind: 'canvas_operation',
              label: '生成',
              position: { x: 0, y: 0 },
              config: { operation: 'text_to_image' },
            },
            {
              id: 'output',
              kind: 'canvas_output',
              label: '产物',
              position: { x: 300, y: 0 },
              config: {},
            },
          ],
          edges: [
            {
              id: 'generated-edge',
              sourceNodeId: 'operation',
              targetNodeId: 'output',
              type: 'generated',
            },
          ],
        },
      },
    })

    expect(request.package.graph.edges[0]?.type).toBe('generated')
  })
})
