import type { ReactNode } from 'react'
import type { WorkflowNodeKind } from '@spark/protocol'
import { Icons } from '../../Icons'

export type NodeKindMeta = {
  kind: WorkflowNodeKind
  label: string
  icon: ReactNode
  accent: string // CSS color token name without var()
  defaultPrompt: string
  hint: string
  runtimeLabel: string
  runtimeHint: string
}

export const NODE_KIND_META: Record<WorkflowNodeKind, NodeKindMeta> = {
  input: {
    kind: 'input',
    label: '需求输入',
    icon: <Icons.Hash size={14} />,
    accent: '--info',
    defaultPrompt: '读取用户需求，提炼目标、约束和交付物。',
    hint: '入口节点：解析用户消息',
    runtimeLabel: '原子输出',
    runtimeHint: '输出结构化输入内容，可作为下游节点的上游状态。',
  },
  plan: {
    kind: 'plan',
    label: '计划节点',
    icon: <Icons.Layers size={14} />,
    accent: '--primary',
    defaultPrompt: '拆解任务，给出可执行步骤。',
    hint: 'EnterPlanMode：先规划再动手',
    runtimeLabel: '原子输出',
    runtimeHint: '当前运行时会输出计划文本，不会单独切进 Plan mode。',
  },
  agent: {
    kind: 'agent',
    label: '执行节点',
    icon: <Icons.Bot size={14} />,
    accent: '--primary',
    defaultPrompt: '按计划完成实现，并记录关键决策。',
    hint: '主 Agent 执行阶段',
    runtimeLabel: '真实派发',
    runtimeHint: '绑定真实 Agent 后会进入实际 worker 执行链路。',
  },
  subagent: {
    kind: 'subagent',
    label: '子代理派发',
    icon: <Icons.Branch size={14} />,
    accent: '--warning',
    defaultPrompt: '并行/串行派发子代理处理独立子任务。',
    hint: 'Task / 并行子代理',
    runtimeLabel: '真实派发',
    runtimeHint: '会生成临时 workflow worker，并复用派发引擎执行。',
  },
  skill: {
    kind: 'skill',
    label: 'Skill',
    icon: <Icons.Skills size={14} />,
    accent: '--primary',
    defaultPrompt: '加载并应用所选 Skill 的方法与约束。',
    hint: '调用 Skill 提供的方法',
    runtimeLabel: '说明节点',
    runtimeHint: '当前仅输出结构化说明；要真正执行请改用 Agent/Subagent 节点。',
  },
  tool: {
    kind: 'tool',
    label: '工具',
    icon: <Icons.Wrench size={14} />,
    accent: '--primary',
    defaultPrompt: '调用所需工具，记录输入、输出和异常。',
    hint: '调用内置工具',
    runtimeLabel: '说明节点',
    runtimeHint: '当前仅输出结构化说明；要真正执行请改用 Agent/Subagent 节点。',
  },
  mcp: {
    kind: 'mcp',
    label: 'MCP',
    icon: <Icons.MCP size={14} />,
    accent: '--primary',
    defaultPrompt: '使用所选 MCP 服务完成外部能力调用。',
    hint: '外部 MCP 服务',
    runtimeLabel: '说明节点',
    runtimeHint: '当前仅输出结构化说明；要真正执行请改用 Agent/Subagent 节点。',
  },
  approval: {
    kind: 'approval',
    label: '审批',
    icon: <Icons.Shield size={14} />,
    accent: '--warning',
    defaultPrompt: '在继续前等待用户确认关键计划或高风险动作。',
    hint: '人在回路：用户确认',
    runtimeLabel: '审批节点',
    runtimeHint: '运行时会暂停并向用户请求批准或拒绝。',
  },
  verify: {
    kind: 'verify',
    label: '验证',
    icon: <Icons.Beaker size={14} />,
    accent: '--success',
    defaultPrompt: '运行验证命令并确认输出，证据先行。',
    hint: 'verification-before-completion',
    runtimeLabel: '校验执行',
    runtimeHint: '会在 workflow host 工作区执行 verifyCommands。',
  },
  review: {
    kind: 'review',
    label: '复核',
    icon: <Icons.Eye size={14} />,
    accent: '--success',
    defaultPrompt: '复核上一阶段结果，总结风险和结果。',
    hint: '复核 / 测试结果分析',
    runtimeLabel: '原子输出',
    runtimeHint: '当前运行时会输出复核文本，不会自动执行独立 review 流程。',
  },
  artifact: {
    kind: 'artifact',
    label: '产物',
    icon: <Icons.File size={14} />,
    accent: '--success',
    defaultPrompt: '整理最终交付物、变更摘要和后续建议。',
    hint: '终点：交付制品',
    runtimeLabel: '原子输出',
    runtimeHint: '用于沉淀最终文本产物，不会额外触发文件导出。',
  },
}

export const NODE_KIND_ORDER: WorkflowNodeKind[] = [
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
]

export function getNodeKindMeta(kind: WorkflowNodeKind | string): NodeKindMeta {
  return (NODE_KIND_META as Record<string, NodeKindMeta>)[kind] ?? NODE_KIND_META.agent
}
