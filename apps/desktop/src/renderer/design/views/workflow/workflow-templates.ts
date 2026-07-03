import type { WorkflowGraph } from '@spark/protocol'

/**
 * 工作流模板：用户一键导入即可在画布上得到一份可运行（或稍作绑定即可运行）的工作流草稿。
 *
 * 数据格式直接复用 WorkflowGraph（顶层 x/y、from/to、可选 condition），
 * 导入时由 graphToReactFlow 转成 React Flow 节点/边，再经 workflow:create 落库为 draft。
 *
 * 绑定类字段（agentId / skillIds / toolIds / mcpServerIds）在模板里一律留空——
 * 这些 ID 是工作区相关的，写死会跨工作区失效。导入后由用户在检查器里补齐。
 *
 * 条件分支结构注意：分支节点必须有「互斥条件 + 各自独立终点」，不能合并回同一节点。
 * 原因：executor 的 collectWorkflowInactiveNodeIds 用 `.some` 判定——合并节点总有
 * 一条入边对应 inactive 分支，会整体被标 inactive 而不执行。
 */
export type WorkflowTemplate = {
  id: string
  name: string
  description: string
  tags: string[]
  /** 导入后用户需要补齐的绑定类字段，在 Picker 卡片上展示。 */
  needsBinding?: string
  graph: WorkflowGraph
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // 1. 标准研发流 —— 线性主流程，覆盖 input/plan/agent/verify/artifact
  {
    id: 'standard-dev',
    name: '标准研发流',
    description: '需求 → 计划 → 执行 → 验证 → 交付，最经典的线性主流程。',
    tags: ['线性', '基础'],
    needsBinding: '执行节点需绑定 Agent',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '需求输入', x: 80, y: 160, config: { prompt: '解析用户需求，提炼目标、约束和交付物，作为后续节点的输入。', outputKey: 'objective', retryCount: 1 } },
        { id: 'plan-1', kind: 'plan', title: '制定计划', x: 360, y: 160, config: { prompt: '基于目标拆解可执行的实施步骤。', outputKey: 'plan' } },
        { id: 'agent-1', kind: 'agent', title: '执行实现', x: 640, y: 160, config: { prompt: '按计划完成实现，记录关键决策与改动。', outputKey: 'implementation' } },
        { id: 'verify-1', kind: 'verify', title: '验证', x: 920, y: 160, config: { prompt: '运行验证命令确认实现正确。', outputKey: 'verification', verifyCommands: ['echo ok'] } },
        { id: 'artifact-1', kind: 'artifact', title: '交付产物', x: 1200, y: 160, config: { prompt: '整理交付物、变更摘要和后续建议。', outputKey: 'deliverable' } },
      ],
      edges: [
        { id: 'e-input-plan', from: 'input-1', to: 'plan-1' },
        { id: 'e-plan-agent', from: 'plan-1', to: 'agent-1' },
        { id: 'e-agent-verify', from: 'agent-1', to: 'verify-1' },
        { id: 'e-verify-artifact', from: 'verify-1', to: 'artifact-1' },
      ],
    },
  },

  // 2. 审批门禁流 —— approval 节点做门禁，拒绝则工作流直接失败停止
  {
    id: 'approval-gate',
    name: '审批门禁流',
    description: '在执行前插入人工审批节点；批准可附修改意见流向下游，拒绝则整个工作流终止。',
    tags: ['审批', '门禁'],
    needsBinding: '执行节点需绑定 Agent',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '需求输入', x: 80, y: 160, config: { prompt: '解析需求与交付物。', outputKey: 'objective', retryCount: 1 } },
        { id: 'plan-1', kind: 'plan', title: '制定计划', x: 340, y: 160, config: { prompt: '拆解实施步骤，供审批参考。', outputKey: 'plan' } },
        { id: 'approval-1', kind: 'approval', title: '计划审批', x: 600, y: 160, config: { prompt: '请审批以下计划是否进入执行；拒绝将终止工作流，批准可附修改意见。', outputKey: 'approval' } },
        { id: 'agent-1', kind: 'agent', title: '执行实现', x: 860, y: 160, config: { prompt: '按审批通过的计划完成实现。', outputKey: 'implementation' } },
        { id: 'verify-1', kind: 'verify', title: '验证', x: 1120, y: 160, config: { prompt: '运行验证命令。', outputKey: 'verification', verifyCommands: ['echo ok'] } },
        { id: 'artifact-1', kind: 'artifact', title: '交付产物', x: 1380, y: 160, config: { prompt: '整理交付物与变更摘要。', outputKey: 'deliverable' } },
      ],
      edges: [
        { id: 'e-input-plan', from: 'input-1', to: 'plan-1' },
        { id: 'e-plan-approval', from: 'plan-1', to: 'approval-1' },
        { id: 'e-approval-agent', from: 'approval-1', to: 'agent-1' },
        { id: 'e-agent-verify', from: 'agent-1', to: 'verify-1' },
        { id: 'e-verify-artifact', from: 'verify-1', to: 'artifact-1' },
      ],
    },
  },

  // 3. 并行草案评审 —— subagent.parallelism fan-out，3 路并发后汇总
  {
    id: 'parallel-drafts',
    name: '并行草案评审',
    description: 'subagent 节点并行派发 3 路独立草案，再由复核节点汇总对比，产出推荐方案。',
    tags: ['并行', '子代理'],
    needsBinding: '子代理节点需绑定 Agent',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '需求输入', x: 80, y: 160, config: { prompt: '解析目标与约束，供并行草案参考。', outputKey: 'objective', retryCount: 1 } },
        { id: 'subagent-1', kind: 'subagent', title: '并行草案', x: 360, y: 160, config: { prompt: '针对目标并行产出 3 路独立草案，分别采用不同角度或方案。结果会按分支拼接。', outputKey: 'drafts', parallelism: 3 } },
        { id: 'review-1', kind: 'review', title: '汇总复核', x: 640, y: 160, config: { prompt: '对比 3 路草案的优劣，给出推荐方案与理由。', outputKey: 'synthesis' } },
        { id: 'artifact-1', kind: 'artifact', title: '推荐方案', x: 920, y: 160, config: { prompt: '输出最终推荐方案。', outputKey: 'recommendation' } },
      ],
      edges: [
        { id: 'e-input-sub', from: 'input-1', to: 'subagent-1' },
        { id: 'e-sub-review', from: 'subagent-1', to: 'review-1' },
        { id: 'e-review-artifact', from: 'review-1', to: 'artifact-1' },
      ],
    },
  },

  // 4. 只读调研报告 —— review 只读派发链 + artifact exportPath 写盘
  {
    id: 'readonly-research',
    name: '只读调研报告',
    description: '两段只读复核串行：先调研再综合，最后把报告写入工作区文件（exportPath）。',
    tags: ['只读', '产物', '写盘'],
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '调研主题', x: 80, y: 160, config: { prompt: '解析调研主题、范围与交付物。', outputKey: 'topic', retryCount: 1 } },
        { id: 'review-1', kind: 'review', title: '资料调研', x: 360, y: 160, config: { prompt: '围绕主题做只读调研，汇总关键信息与来源。', outputKey: 'research' } },
        { id: 'review-2', kind: 'review', title: '综合分析', x: 640, y: 160, config: { prompt: '基于调研结果做综合分析，提炼结论、风险与建议。', outputKey: 'synthesis' } },
        { id: 'artifact-1', kind: 'artifact', title: '调研报告', x: 920, y: 160, config: { prompt: '整理为 Markdown 报告。', outputKey: 'report', exportPath: 'docs/research-report.md' } },
      ],
      edges: [
        { id: 'e-input-r1', from: 'input-1', to: 'review-1' },
        { id: 'e-r1-r2', from: 'review-1', to: 'review-2' },
        { id: 'e-r2-artifact', from: 'review-2', to: 'artifact-1' },
      ],
    },
  },

  // 5. Skill 应用流 —— skill 节点真实执行（导入后绑定 skillIds）
  {
    id: 'skill-application',
    name: 'Skill 应用流',
    description: '加载并应用所选 Skill 的方法与约束处理任务，再经复核产出交付物。',
    tags: ['Skill', '执行'],
    needsBinding: 'Skill 节点需绑定具体 Skill',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '需求输入', x: 80, y: 160, config: { prompt: '解析目标与交付物。', outputKey: 'objective', retryCount: 1 } },
        { id: 'skill-1', kind: 'skill', title: '应用 Skill', x: 360, y: 160, config: { prompt: '按所选 Skill 的方法与约束处理任务。', outputKey: 'skill_output' } },
        { id: 'review-1', kind: 'review', title: '复核', x: 640, y: 160, config: { prompt: '复核 Skill 产出的结果。', outputKey: 'review' } },
        { id: 'artifact-1', kind: 'artifact', title: '产物', x: 920, y: 160, config: { prompt: '整理最终交付物。', outputKey: 'deliverable' } },
      ],
      edges: [
        { id: 'e-input-skill', from: 'input-1', to: 'skill-1' },
        { id: 'e-skill-review', from: 'skill-1', to: 'review-1' },
        { id: 'e-review-artifact', from: 'review-1', to: 'artifact-1' },
      ],
    },
  },

  // 6. 工具调用流 —— tool 节点收窄 toolIds 白名单（导入后绑定）
  {
    id: 'tool-invocation',
    name: '工具调用流',
    description: '计划后调用受限工具集完成任务，再验证交付。tool 节点会把能力收窄到所选 toolIds。',
    tags: ['工具', '验证'],
    needsBinding: '工具节点需绑定具体工具；执行节点需绑定 Agent',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '需求输入', x: 80, y: 160, config: { prompt: '解析目标与交付物。', outputKey: 'objective', retryCount: 1 } },
        { id: 'plan-1', kind: 'plan', title: '制定计划', x: 340, y: 160, config: { prompt: '拆解需要调用哪些工具、按什么顺序。', outputKey: 'plan' } },
        { id: 'tool-1', kind: 'tool', title: '调用工具', x: 600, y: 160, config: { prompt: '调用所需工具完成任务，记录输入、输出与异常。', outputKey: 'tool_output' } },
        { id: 'verify-1', kind: 'verify', title: '验证', x: 860, y: 160, config: { prompt: '运行验证命令确认结果。', outputKey: 'verification', verifyCommands: ['echo ok'] } },
        { id: 'artifact-1', kind: 'artifact', title: '交付产物', x: 1120, y: 160, config: { prompt: '整理交付物。', outputKey: 'deliverable' } },
      ],
      edges: [
        { id: 'e-input-plan', from: 'input-1', to: 'plan-1' },
        { id: 'e-plan-tool', from: 'plan-1', to: 'tool-1' },
        { id: 'e-tool-verify', from: 'tool-1', to: 'verify-1' },
        { id: 'e-verify-artifact', from: 'verify-1', to: 'artifact-1' },
      ],
    },
  },

  // 7. MCP 外部能力流 —— mcp 节点只挂所选服务（导入后绑定）
  {
    id: 'mcp-integration',
    name: 'MCP 外部能力流',
    description: '通过所选 MCP 服务完成外部能力调用，再经复核产出交付物。',
    tags: ['MCP', '外部'],
    needsBinding: 'MCP 节点需绑定具体 MCP 服务',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '需求输入', x: 80, y: 160, config: { prompt: '解析目标与需要调用的外部能力。', outputKey: 'objective', retryCount: 1 } },
        { id: 'mcp-1', kind: 'mcp', title: 'MCP 调用', x: 360, y: 160, config: { prompt: '使用所选 MCP 服务完成外部能力调用，记录响应。', outputKey: 'mcp_output' } },
        { id: 'review-1', kind: 'review', title: '复核', x: 640, y: 160, config: { prompt: '复核 MCP 返回结果是否满足需求。', outputKey: 'review' } },
        { id: 'artifact-1', kind: 'artifact', title: '产物', x: 920, y: 160, config: { prompt: '整理最终交付物。', outputKey: 'deliverable' } },
      ],
      edges: [
        { id: 'e-input-mcp', from: 'input-1', to: 'mcp-1' },
        { id: 'e-mcp-review', from: 'mcp-1', to: 'review-1' },
        { id: 'e-review-artifact', from: 'review-1', to: 'artifact-1' },
      ],
    },
  },

  // 8. 条件路由流 —— plan 决策 equals，二分支独立终点
  {
    id: 'conditional-routing',
    name: '条件路由流',
    description: '计划节点判断复杂度严格输出 deep/quick，条件边 equals 路由到两条独立支线，各产各的交付物。',
    tags: ['条件分支', '路由'],
    needsBinding: '执行节点需绑定 Agent；条件依赖 plan 节点严格输出 deep 或 quick',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '需求输入', x: 80, y: 160, config: { prompt: '解析目标与交付物。', outputKey: 'objective', retryCount: 1 } },
        { id: 'plan-1', kind: 'plan', title: '决策路由', x: 360, y: 160, config: { prompt: "判断任务复杂度，严格只输出 'deep'（需要完整实现）或 'quick'（快速摘要）一个词，不要输出其他内容。", outputKey: 'route' } },
        { id: 'agent-1', kind: 'agent', title: '深度实现', x: 640, y: 60, config: { prompt: '按计划完成完整实现。', outputKey: 'implementation' } },
        { id: 'verify-1', kind: 'verify', title: '验证', x: 900, y: 60, config: { prompt: '运行验证命令。', outputKey: 'verification', verifyCommands: ['echo ok'] } },
        { id: 'artifact-deep', kind: 'artifact', title: '深度交付', x: 1160, y: 60, config: { prompt: '整理完整实现交付物。', outputKey: 'deliverable_deep' } },
        { id: 'review-1', kind: 'review', title: '快速摘要', x: 640, y: 320, config: { prompt: '产出快速摘要。', outputKey: 'summary' } },
        { id: 'artifact-quick', kind: 'artifact', title: '摘要交付', x: 900, y: 320, config: { prompt: '整理摘要交付物。', outputKey: 'deliverable_quick' } },
      ],
      edges: [
        { id: 'e-input-plan', from: 'input-1', to: 'plan-1' },
        { id: 'e-plan-agent', from: 'plan-1', to: 'agent-1', condition: { op: 'equals', key: 'route', value: 'deep' } },
        { id: 'e-agent-verify', from: 'agent-1', to: 'verify-1' },
        { id: 'e-verify-artifact-deep', from: 'verify-1', to: 'artifact-deep' },
        { id: 'e-plan-review', from: 'plan-1', to: 'review-1', condition: { op: 'equals', key: 'route', value: 'quick' } },
        { id: 'e-review-artifact-quick', from: 'review-1', to: 'artifact-quick' },
      ],
    },
  },

  // 9. 复核门禁流 —— review 决策 equals，通过则执行、驳回则产驳回报告
  {
    id: 'review-gate',
    name: '复核门禁流',
    description: '复核节点对计划严格输出 approve/reject，条件边 equals 路由：通过则执行交付，驳回则直接产出驳回报告。',
    tags: ['条件分支', '复核'],
    needsBinding: '执行节点需绑定 Agent；条件依赖 review 节点严格输出 approve 或 reject',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '需求输入', x: 80, y: 160, config: { prompt: '解析目标与交付物。', outputKey: 'objective', retryCount: 1 } },
        { id: 'plan-1', kind: 'plan', title: '制定计划', x: 340, y: 160, config: { prompt: '拆解实施步骤。', outputKey: 'plan' } },
        { id: 'review-1', kind: 'review', title: '复核决策', x: 600, y: 160, config: { prompt: "复核计划可行性，严格只输出 'approve'（通过）或 'reject'（驳回）一个词，不要输出其他内容。", outputKey: 'verdict' } },
        { id: 'agent-1', kind: 'agent', title: '执行实现', x: 860, y: 60, config: { prompt: '按通过的计划完成实现。', outputKey: 'implementation' } },
        { id: 'artifact-pass', kind: 'artifact', title: '通过交付', x: 1120, y: 60, config: { prompt: '整理交付物。', outputKey: 'deliverable_pass' } },
        { id: 'artifact-reject', kind: 'artifact', title: '驳回报告', x: 860, y: 320, config: { prompt: '说明计划被驳回的原因与改进建议。', outputKey: 'deliverable_reject' } },
      ],
      edges: [
        { id: 'e-input-plan', from: 'input-1', to: 'plan-1' },
        { id: 'e-plan-review', from: 'plan-1', to: 'review-1' },
        { id: 'e-review-agent', from: 'review-1', to: 'agent-1', condition: { op: 'equals', key: 'verdict', value: 'approve' } },
        { id: 'e-agent-artifact-pass', from: 'agent-1', to: 'artifact-pass' },
        { id: 'e-review-artifact-reject', from: 'review-1', to: 'artifact-reject', condition: { op: 'equals', key: 'verdict', value: 'reject' } },
      ],
    },
  },

  // 10. 调研决策流 —— review 调研后 equals 决策，推进或暂缓各产独立产物
  {
    id: 'research-to-decision',
    name: '调研决策流',
    description: '只读调研后由复核节点严格输出 go/hold 决策，条件边 equals 路由：推进则计划+执行+交付，暂缓则直接出暂缓报告。',
    tags: ['条件分支', '调研'],
    needsBinding: '执行节点需绑定 Agent；条件依赖 review 节点严格输出 go 或 hold',
    graph: {
      nodes: [
        { id: 'input-1', kind: 'input', title: '调研主题', x: 80, y: 160, config: { prompt: '解析需要调研决策的主题。', outputKey: 'topic', retryCount: 1 } },
        { id: 'review-1', kind: 'review', title: '调研决策', x: 340, y: 160, config: { prompt: "围绕主题做只读调研后给出决策建议，严格只输出 'go'（建议推进）或 'hold'（建议暂缓）一个词，不要输出其他内容。", outputKey: 'decision' } },
        { id: 'plan-1', kind: 'plan', title: '推进计划', x: 600, y: 60, config: { prompt: '制定推进计划。', outputKey: 'plan' } },
        { id: 'agent-1', kind: 'agent', title: '执行', x: 860, y: 60, config: { prompt: '按计划执行。', outputKey: 'implementation' } },
        { id: 'artifact-go', kind: 'artifact', title: '推进交付', x: 1120, y: 60, config: { prompt: '整理推进交付物。', outputKey: 'deliverable_go' } },
        { id: 'artifact-hold', kind: 'artifact', title: '暂缓报告', x: 600, y: 320, config: { prompt: '说明建议暂缓的理由与后续触发条件。', outputKey: 'deliverable_hold' } },
      ],
      edges: [
        { id: 'e-input-review', from: 'input-1', to: 'review-1' },
        { id: 'e-review-plan', from: 'review-1', to: 'plan-1', condition: { op: 'equals', key: 'decision', value: 'go' } },
        { id: 'e-plan-agent', from: 'plan-1', to: 'agent-1' },
        { id: 'e-agent-artifact-go', from: 'agent-1', to: 'artifact-go' },
        { id: 'e-review-artifact-hold', from: 'review-1', to: 'artifact-hold', condition: { op: 'equals', key: 'decision', value: 'hold' } },
      ],
    },
  },
]
