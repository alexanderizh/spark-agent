import { describe, expect, it } from 'vitest'
import type { WorkflowNodeKind } from '@spark/protocol'
import { WORKFLOW_TEMPLATES } from './workflow-templates'

const VALID_KINDS: ReadonlySet<string> = new Set<WorkflowNodeKind>([
  'input',
  'plan',
  'agent',
  'subagent',
  'skill',
  'tool',
  'mcp',
  'approval',
  'verify',
  'review',
  'artifact',
  'loop',
])

/** 三色 DFS 判环：确认模板是无回边的 DAG（executor 基于拓扑排序，不支持回边）。 */
function isDag(nodes: { id: string }[], edges: { from: string; to: string }[]): boolean {
  const adj = new Map<string, string[]>()
  for (const node of nodes) adj.set(node.id, [])
  for (const edge of edges) (adj.get(edge.from) ?? []).push(edge.to)
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>(nodes.map((node) => [node.id, WHITE]))
  let hasCycle = false
  const visit = (id: string): void => {
    if (hasCycle) return
    const c = color.get(id)
    if (c === GRAY) {
      hasCycle = true
      return
    }
    if (c === BLACK) return
    color.set(id, GRAY)
    for (const next of adj.get(id) ?? []) visit(next)
    color.set(id, BLACK)
  }
  for (const node of nodes) {
    if (color.get(node.id) === WHITE) visit(node.id)
  }
  return !hasCycle
}

describe('workflow-templates', () => {
  it('模板 id 全局唯一', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('至少提供 8 个模板，覆盖各类编排能力', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(8)
  })

  it('全部 12 类节点至少在一个模板里出现', () => {
    const usedKinds = new Set<string>()
    for (const template of WORKFLOW_TEMPLATES) {
      for (const node of template.graph.nodes) usedKinds.add(node.kind)
    }
    for (const kind of VALID_KINDS) {
      expect(usedKinds.has(kind), `kind ${kind} 未被任何模板使用`).toBe(true)
    }
  })

  for (const template of WORKFLOW_TEMPLATES) {
    describe(`模板「${template.name}」(${template.id})`, () => {
      const nodeIds = new Set(template.graph.nodes.map((n) => n.id))

      it('节点 id 唯一', () => {
        const ids = template.graph.nodes.map((n) => n.id)
        expect(ids.length).toBe(new Set(ids).size)
      })

      it('节点 kind 合法且坐标为有限数字', () => {
        for (const node of template.graph.nodes) {
          expect(VALID_KINDS.has(node.kind), `非法 kind: ${node.kind}`).toBe(true)
          expect(typeof node.x).toBe('number')
          expect(typeof node.y).toBe('number')
          expect(Number.isFinite(node.x)).toBe(true)
          expect(Number.isFinite(node.y)).toBe(true)
        }
      })

      it('边 id 唯一、from/to 指向存在节点且非自环', () => {
        const edgeIds = template.graph.edges.map((e) => e.id)
        expect(edgeIds.length).toBe(new Set(edgeIds).size)
        for (const edge of template.graph.edges) {
          expect(nodeIds.has(edge.from), `边 ${edge.id} from 指向不存在的节点: ${edge.from}`).toBe(true)
          expect(nodeIds.has(edge.to), `边 ${edge.id} to 指向不存在的节点: ${edge.to}`).toBe(true)
          expect(edge.from === edge.to, `边 ${edge.id} 是自环`).toBe(false)
        }
      })

      it('条件边的 key 引用图中某个节点的 outputKey', () => {
        const outputKeys = new Set(
          template.graph.nodes
            .map((n) => n.config.outputKey)
            .filter((k): k is string => typeof k === 'string' && k.length > 0),
        )
        for (const edge of template.graph.edges) {
          if (edge.condition == null) continue
          expect(
            outputKeys.has(edge.condition.key),
            `边 ${edge.id} 的条件 key "${edge.condition.key}" 未对应任何节点的 outputKey`,
          ).toBe(true)
        }
      })

      it('是 DAG（无回边，executor 可拓扑排序）', () => {
        expect(isDag(template.graph.nodes, template.graph.edges)).toBe(true)
      })

      it('至少包含一个 input 起点节点', () => {
        expect(template.graph.nodes.some((n) => n.kind === 'input')).toBe(true)
      })
    })
  }
})
