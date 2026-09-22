/**
 * 工作流 Agent 每轮上下文与熔断（E2-3，纯逻辑，供面板与测试复用）
 *
 * - 每轮消息前缀注入（对称画布 [画布绑定] 模式，反上下文腐化）：
 *   元信息 + 图摘要（≤30 节点完整压缩 JSON；>30 仅节点清单）+ 工具纪律声明；
 * - 修复熔断：同轮内 workflow_validate 连续失败 ≤3 次，超过后本轮拒绝
 *   校验调用，把熔断决定交还面板（设计稿 §3：计数在面板层做）。
 */
import type { WorkflowGraph } from '@spark/protocol'

/** 图摘要阈值：≤30 节点注入完整压缩 JSON，>30 降级为节点清单（设计稿 §3） */
const FULL_GRAPH_SUMMARY_NODE_LIMIT = 30

/** 只保留摘要所需的节点字段，避免把未知扩展字段塞进 prompt */
function compactNode(node: Record<string, unknown>): Record<string, unknown> {
  const config = node.config
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    ...(node.x != null ? { x: node.x } : {}),
    ...(node.y != null ? { y: node.y } : {}),
    ...(config != null && typeof config === 'object' ? { config } : {}),
  }
}

export function buildWorkflowGraphSummary(graph: WorkflowGraph): string {
  const nodes = Array.isArray(graph.nodes)
    ? (graph.nodes as unknown as Record<string, unknown>[])
    : []
  const edges = Array.isArray(graph.edges)
    ? (graph.edges as unknown as Record<string, unknown>[])
    : []
  if (nodes.length === 0) return '当前图为空（0 节点）。'
  if (nodes.length <= FULL_GRAPH_SUMMARY_NODE_LIMIT) {
    const compact = {
      nodes: nodes.map(compactNode),
      edges: edges.map((edge) => ({
        id: edge.id,
        // WorkflowEdge 的真实字段是 from/to（见 protocol WorkflowEdge 定义）；
        // 宽类型边界（Record<string, unknown>）下写错字段名不报编译错，只产出 undefined 被 stringify 丢弃。
        from: edge.from,
        to: edge.to,
        ...(edge.condition != null ? { condition: edge.condition } : {}),
      })),
    }
    return `当前图完整 JSON（${nodes.length} 节点 / ${edges.length} 连线）：\n${JSON.stringify(compact)}`
  }
  const lines = nodes.map((node) => {
    const config =
      node.config != null && typeof node.config === 'object'
        ? (node.config as Record<string, unknown>)
        : {}
    const outputKey = typeof config.outputKey === 'string' ? ` outputKey=${config.outputKey}` : ''
    return `- ${String(node.id)} [${String(node.kind)}] ${String(node.title ?? '')}${outputKey}`
  })
  return `当前图共 ${nodes.length} 节点（超过 ${FULL_GRAPH_SUMMARY_NODE_LIMIT}，仅列清单，连线 ${edges.length} 条）：\n${lines.join('\n')}\n需要完整连线细节时调用 workflow_get_graph。`
}

export function buildWorkflowTurnPrefix(
  state: { workflowId: string | null; name: string; graph: WorkflowGraph },
  extra?: { circuitBroken?: boolean },
): string {
  const scope =
    state.workflowId != null ? `workflowId: ${state.workflowId}` : 'workflowId: （未保存草稿）'
  const lines = [
    '[工作流绑定]',
    scope,
    `workflowName: ${state.name}`,
    buildWorkflowGraphSummary(state.graph),
    '',
    '每轮修改前先 workflow_get_graph 获取最新图与 baseVersion；提交一律整图 + baseVersion；落库前 workflow_validate 自检；乐观锁被拒（graph_changed_since_read）时必须重新读图，禁止凭记忆重试。',
  ]
  if (extra?.circuitBroken === true) {
    lines.push(
      '[熔断激活] 本轮 workflow_validate 已连续失败 3 次：校验工具已被暂停。请停止重试，向用户完整报告最后一份 diagnostics（逐条 path/message），给出修复建议，等待用户反馈。',
    )
  }
  return lines.join('\n')
}

export interface ValidateCircuit {
  /** 是否允许本轮继续调用校验/落库工具 */
  isTripped(): boolean
  /** 记录一次校验结果；成功清零计数 */
  record(ok: boolean): void
  /** 新 turn 开始时重置计数 */
  reset(): void
}

export function createValidateCircuit(limit = 3): ValidateCircuit {
  let consecutiveFailures = 0
  return {
    isTripped: () => consecutiveFailures >= limit,
    record: (ok: boolean) => {
      consecutiveFailures = ok ? 0 : consecutiveFailures + 1
    },
    reset: () => {
      consecutiveFailures = 0
    },
  }
}

/** 熔断激活时返回给 LLM 的统一响应（workflow:validate 通道结构） */
export function circuitBrokenResponse(limit = 3): {
  ok: boolean
  circuitBroken: boolean
  diagnostics: Array<{ severity: 'error'; source: 'schema'; code: string; message: string }>
} {
  return {
    ok: false,
    circuitBroken: true,
    diagnostics: [
      {
        severity: 'error',
        source: 'schema',
        code: 'validate_circuit_broken',
        message: `本轮 workflow_validate 已连续失败 ${limit} 次，校验已熔断。停止重试：向用户完整报告最后一次 diagnostics 并给出修复建议，等待用户反馈。`,
      },
    ],
  }
}
