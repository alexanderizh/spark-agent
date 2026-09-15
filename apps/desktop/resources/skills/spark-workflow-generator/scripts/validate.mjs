#!/usr/bin/env node
/**
 * spark-workflow-generator · validate.mjs
 * Spark L3 WorkflowGraph 离线结构校验器（三层校验，错误码对齐 Spark preflight 命名）。
 *
 * 用法：node validate.mjs <workflow.json> [--json]
 *   输入支持两种形态：① 模板外壳 { name, graph: {nodes, edges} }；② 裸 graph {nodes, edges}
 *   --json 输出机器可读报告；缺省输出人类可读报告
 *   退出码：0 = 无 error；1 = 存在 error；2 = 输入不可解析
 *
 * 能力边界（诚实声明）：本脚本只校验「结构层」。依赖层（agentId/skillIds/MCP 是否存在于目标环境）
 * 需要 Spark 运行时 DB，由导入后的官方 preflight 兜底（13 error + 5 warning，
 * 见 references/schema-freeze.md §5）。
 *
 * Ground truth: spark-agent 0.11.68 (97a5c7a4)
 */

const NODE_KINDS = new Set([
  'input', 'plan', 'route', 'agent', 'subagent', 'skill', 'tool', 'mcp',
  'approval', 'verify', 'review', 'artifact', 'loop',
])
const CONDITION_OPS = new Set(['exists', 'equals', 'not_equals', 'truthy', 'falsy'])
const BINDING_FIELDS = ['agentId', 'skillIds', 'toolIds', 'mcpServerIds', 'ruleIds', 'toolServerId', 'modelId', 'providerProfileId']
const MAX_ITERATIONS_HARD_LIMIT = 50

const errors = []
const warnings = []
const err = (code, params = {}) => errors.push({ code, ...params })
const warn = (code, params = {}) => warnings.push({ code, ...params })

function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v) }
function isStr(v) { return typeof v === 'string' && v.trim().length > 0 }

// ─── Layer 1: 格式 ───────────────────────────────────────────────────────────

function checkNodeShape(node, scope) {
  if (!isObj(node)) { err('invalid_node_shape', { scope }); return false }
  if (!isStr(node.id)) err('missing_node_id', { scope })
  if (!isStr(node.title)) warn('missing_node_title', { scope, nodeId: node.id })
  if (!NODE_KINDS.has(node.kind)) {
    err('unsupported_node_kind', { nodeId: node.id, params: { kind: String(node.kind ?? 'unknown'), scope } })
  }
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
    err('invalid_node_position', { nodeId: node.id, scope })
  }
  if (node.config != null && !isObj(node.config)) err('invalid_node_config', { nodeId: node.id, scope })
  return true
}

function checkIdsUnique(items, idField, code, scope) {
  const seen = new Set()
  for (const item of items) {
    if (!isObj(item) || !isStr(item[idField])) continue
    if (seen.has(item[idField])) err(code, { params: { id: item[idField], scope } })
    seen.add(item[idField])
  }
  return seen
}

// ─── Layer 2: 连接 ───────────────────────────────────────────────────────────

function checkEdges(graph, scope, nodeIds, outputKeys) {
  checkIdsUnique(graph.edges, 'id', 'duplicate_edge_id', scope)
  for (const edge of graph.edges) {
    if (!isObj(edge)) { err('invalid_edge_shape', { scope }); continue }
    if (!nodeIds.has(edge.from)) err('edge_endpoint_missing', { edgeId: edge.id, params: { end: 'from', nodeId: String(edge.from), scope } })
    if (!nodeIds.has(edge.to)) err('edge_endpoint_missing', { edgeId: edge.id, params: { end: 'to', nodeId: String(edge.to), scope } })
    if (isStr(edge.from) && edge.from === edge.to) err('self_loop', { edgeId: edge.id, nodeId: edge.from, scope })
    if (edge.condition != null) {
      const c = edge.condition
      if (!isObj(c) || !CONDITION_OPS.has(c.op)) {
        err('invalid_condition', { edgeId: edge.id, params: { op: String(c?.op ?? 'unknown'), scope } })
      } else {
        if (!isStr(c.key)) err('invalid_condition', { edgeId: edge.id, params: { reason: 'missing_key', scope } })
        else if (!outputKeys.has(c.key)) err('invalid_condition_reference', { edgeId: edge.id, params: { key: c.key, scope } })
        if ((c.op === 'equals' || c.op === 'not_equals') && c.value === undefined) {
          err('invalid_condition', { edgeId: edge.id, params: { reason: 'missing_value', scope } })
        }
      }
    }
  }
}

function checkAcyclic(graph, scope) {
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]))
  const outgoing = new Map()
  for (const e of graph.edges) {
    if (!isObj(e) || !indegree.has(e.from) || !indegree.has(e.to)) continue
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to])
    indegree.set(e.to, indegree.get(e.to) + 1)
  }
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let visited = 0
  while (queue.length > 0) {
    const id = queue.shift()
    visited++
    for (const next of outgoing.get(id) ?? []) {
      const d = indegree.get(next) - 1
      indegree.set(next, d)
      if (d === 0) queue.push(next)
    }
  }
  if (visited !== graph.nodes.length) {
    const cycleNodes = graph.nodes.filter((n) => indegree.get(n.id) > 0).map((n) => n.id)
    err('graph_cycle', { params: { scope, nodes: cycleNodes.join(',') } })
  }
}

function checkReachability(graph, scope) {
  const isRoot = scope === '主图'
  const inputs = graph.nodes.filter((n) => n.kind === 'input')
  // 子图（loop body）无 input 属官方设计（官方模板 body 仅含工作节点），仅主图要求 input
  if (inputs.length === 0 && isRoot) { warn('missing_input', { scope }); return }
  const adj = new Map()
  for (const e of graph.edges) {
    if (!isObj(e)) continue
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
  }
  // 起点：主图用 input；子图用入度 0 节点
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]))
  for (const e of graph.edges) {
    if (isObj(e) && indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to) + 1)
  }
  const roots = inputs.length > 0
    ? inputs.map((n) => n.id)
    : [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const reached = new Set()
  const stack = [...roots]
  while (stack.length > 0) {
    const id = stack.pop()
    if (reached.has(id)) continue
    reached.add(id)
    stack.push(...(adj.get(id) ?? []))
  }
  for (const n of graph.nodes) {
    if (!reached.has(n.id)) warn('unreachable_node', { nodeId: n.id, scope })
  }
  // dead_end 仅主图检查：loop body 的末端节点（如裁决节点）无出边属官方设计
  if (isRoot) {
    const hasOut = new Set(graph.edges.map((e) => e?.from))
    for (const n of graph.nodes) {
      if (n.kind !== 'artifact' && !hasOut.has(n.id) && reached.has(n.id)) {
        warn('dead_end_node', { nodeId: n.id, scope })
      }
    }
  }
}

// ─── Layer 3: 逻辑 ───────────────────────────────────────────────────────────

function checkBranchMerge(graph, scope) {
  // 官方执行器陷阱：带条件的分支边不得汇合到同一节点（collectWorkflowInactiveNodeIds 用 .some 判定）
  const conditionalIn = new Map()
  for (const e of graph.edges) {
    if (!isObj(e) || e.condition == null) continue
    conditionalIn.set(e.to, [...(conditionalIn.get(e.to) ?? []), e.id])
  }
  for (const [nodeId, edgeIds] of conditionalIn) {
    if (edgeIds.length >= 2) {
      err('branch_merge', { nodeId, params: { scope, edges: edgeIds.join(','), hint: '条件分支必须各自独立终点，不得汇合（executor .some 判定会整体跳过汇合节点）' } })
    }
  }
}

function checkRouteNodes(graph, scope) {
  for (const n of graph.nodes) {
    if (n.kind !== 'route') continue
    const opts = n.config?.routeOptions
    if (!Array.isArray(opts) || opts.length === 0 || opts.some((o) => !isObj(o) || !isStr(o.value))) {
      err('route_options_missing', { nodeId: n.id, scope })
      continue
    }
    const values = new Set(opts.map((o) => o.value))
    const outEdges = graph.edges.filter((e) => isObj(e) && e.from === n.id)
    for (const e of outEdges) {
      if (e.condition == null) { warn('route_edge_unconditional', { edgeId: e.id, nodeId: n.id, scope }); continue }
      if (e.condition.op === 'equals' && !values.has(e.condition.value)) {
        err('route_option_mismatch', { edgeId: e.id, nodeId: n.id, params: { value: String(e.condition.value), scope } })
      }
    }
  }
}

function checkLoopNodes(graph, scope, outerIds) {
  for (const n of graph.nodes) {
    if (n.kind !== 'loop') continue
    const body = n.config?.body
    if (!isObj(body) || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
      err('invalid_loop_body', { nodeId: n.id, params: { scope, reason: 'not_a_graph' } })
      continue
    }
    if (body.nodes.some((b) => isObj(b) && b.kind === 'loop')) {
      err('invalid_loop_body', { nodeId: n.id, params: { scope, reason: 'nested_loop' } })
    }
    for (const b of body.nodes) {
      if (isObj(b) && isStr(b.id) && outerIds.has(b.id)) {
        err('invalid_loop_body', { nodeId: b.id, params: { scope, reason: 'duplicate_node_id' } })
      }
    }
    const mi = n.config?.maxIterations
    if (mi != null && (!Number.isFinite(mi) || mi > MAX_ITERATIONS_HARD_LIMIT)) {
      warn('max_iterations_exceeds_limit', { nodeId: n.id, params: { limit: MAX_ITERATIONS_HARD_LIMIT, scope } })
    }
    const bc = n.config?.breakCondition
    if (bc != null) {
      const bodyKeys = new Set(body.nodes.map((b) => b?.config?.outputKey).filter(isStr))
      if (isStr(bc.key) && !bodyKeys.has(bc.key)) {
        warn('break_condition_key_unresolved', { nodeId: n.id, params: { key: bc.key, scope } })
      }
    }
    validateGraph(body, `${scope} › ${n.title ?? n.id} 循环体`, new Set([...outerIds, ...graph.nodes.map((x) => x.id)]))
  }
}

function checkToolNodes(graph, scope) {
  for (const n of graph.nodes) {
    const cfg = n.config ?? {}
    if (n.kind === 'mcp' || cfg.toolSource === 'mcp') {
      if (!isStr(cfg.toolName)) err('missing_required_tool', { nodeId: n.id, params: { reason: 'mcp_needs_toolName', scope } })
      if (cfg.toolSource === 'mcp' && cfg.toolServerId == null) warn('binding_required', { nodeId: n.id, params: { field: 'toolServerId', scope } })
    }
    if (cfg.toolSource === 'builtin' || cfg.toolSource === 'platform') {
      if (!isStr(cfg.toolName)) err('missing_required_tool', { nodeId: n.id, params: { reason: `${cfg.toolSource}_needs_toolName`, scope } })
    }
    if (n.kind === 'artifact' && isStr(cfg.exportPath)) {
      const p = cfg.exportPath
      if (p.includes('..') || p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.includes('\\')) {
        err('export_path_escape', { nodeId: n.id, params: { path: p, scope } })
      }
    }
    for (const field of BINDING_FIELDS) {
      const v = cfg[field]
      const filled = Array.isArray(v) ? v.length > 0 : (v != null && v !== '')
      if (filled) warn('hardcoded_binding', { nodeId: n.id, params: { field, scope, hint: '绑定字段应留空，导入后在检查器补齐（跨工作区失效）' } })
    }
  }
}

function checkGraphConventions(graph, scope) {
  const inputs = graph.nodes.filter((n) => n.kind === 'input')
  if (inputs.length > 1) warn('multiple_inputs', { params: { count: inputs.length, scope } })
  if (!graph.nodes.some((n) => n.kind === 'artifact')) warn('no_artifact', { params: { scope, hint: '官方惯例：每条分支链以 artifact 收尾' } })
  const keys = graph.nodes.map((n) => n?.config?.outputKey).filter(isStr)
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
  for (const k of new Set(dup)) warn('duplicate_output_key', { params: { key: k, scope } })
}

// ─── 主校验入口（递归处理 loop body） ────────────────────────────────────────

function validateGraph(graph, scope = '主图', outerIds = new Set()) {
  if (!isObj(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    err(scope === '主图' ? 'invalid_graph_shape' : 'invalid_loop_body', { params: { scope } })
    return
  }
  // L1
  for (const n of graph.nodes) checkNodeShape(n, scope)
  const nodeIds = checkIdsUnique(graph.nodes, 'id', 'duplicate_node_id', scope)
  for (const id of graph.nodes.map((n) => n?.id).filter(isStr)) {
    if (outerIds.has(id)) err('duplicate_node_id', { params: { id, scope, reason: 'conflicts_with_outer' } })
  }
  const outputKeys = new Set(graph.nodes.map((n) => n?.config?.outputKey).filter(isStr))
  // L2
  checkEdges(graph, scope, nodeIds, outputKeys)
  checkAcyclic(graph, scope)
  checkReachability(graph, scope)
  // L3
  checkBranchMerge(graph, scope)
  checkRouteNodes(graph, scope)
  checkLoopNodes(graph, scope, outerIds)
  checkToolNodes(graph, scope)
  if (scope === '主图') checkGraphConventions(graph, scope)
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error('用法: node validate.mjs <workflow.json> [--json]')
    process.exit(2)
  }
  let raw
  try {
    raw = JSON.parse(require('node:fs').readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`JSON 解析失败: ${e.message}`)
    process.exit(2)
  }
  // 支持模板外壳 {graph:{...}} 或裸 graph {nodes,edges}
  const graph = isObj(raw?.graph) ? raw.graph : raw
  validateGraph(graph)

  const ok = errors.length === 0
  if (asJson) {
    console.log(JSON.stringify({ ok, errors, warnings }, null, 2))
  } else {
    console.log(`\n校验结果: ${ok ? '✅ 通过' : '❌ 未通过'}  (errors=${errors.length}, warnings=${warnings.length})\n`)
    for (const e of errors) console.log(`  [ERROR] ${e.code}${e.nodeId ? ` @${e.nodeId}` : ''}${e.edgeId ? ` edge:${e.edgeId}` : ''}${e.params ? ` ${JSON.stringify(e.params)}` : ''}`)
    for (const w of warnings) console.log(`  [WARN ] ${w.code}${w.nodeId ? ` @${w.nodeId}` : ''}${w.params ? ` ${JSON.stringify(w.params)}` : ''}`)
    if (errors.length === 0) console.log('\n  提醒: 依赖层校验（Agent/Skill/MCP/Tool 绑定是否存在）由导入后 Spark preflight 兜底。')
  }
  process.exit(ok ? 0 : 1)
}

// ESM 下内联 require
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
main()
