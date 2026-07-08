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
    runtimeHint: 'LLM 结构化解析为目标/约束/交付物 JSON；execution=static 时透传原文。',
  },
  plan: {
    kind: 'plan',
    label: '计划节点',
    icon: <Icons.Layers size={14} />,
    accent: '--primary',
    defaultPrompt: '拆解任务，给出可执行步骤。',
    hint: 'EnterPlanMode：先规划再动手',
    runtimeLabel: '只读派发',
    runtimeHint: '会用只读工具集（禁写/执行）派发单轮 LLM 产出计划文本；execution=static 时回落静态回显。',
  },
  agent: {
    kind: 'agent',
    label: '执行节点',
    icon: <Icons.Bot size={14} />,
    accent: '--primary',
    defaultPrompt: '按计划完成实现，并记录关键决策。',
    hint: '主 Agent 执行阶段',
    runtimeLabel: '真实派发',
    runtimeHint: '绑定真实 Agent 后进入实际 worker 执行链路；未绑定或绑定不可用时回退宿主 Agent（当前会话）。',
  },
  subagent: {
    kind: 'subagent',
    label: '子代理派发',
    icon: <Icons.Branch size={14} />,
    accent: '--warning',
    defaultPrompt: '并行/串行派发子代理处理独立子任务。',
    hint: 'Task / 并行子代理',
    runtimeLabel: '真实派发',
    runtimeHint: '生成临时 workflow worker 复用派发引擎执行；parallelism>=2 时同节点 N 路并发派发，结果按分支拼接。',
  },
  skill: {
    kind: 'skill',
    label: 'Skill',
    icon: <Icons.Skills size={14} />,
    accent: '--primary',
    defaultPrompt: '加载并应用所选 Skill 的方法与约束。',
    hint: '调用 Skill 提供的方法',
    runtimeLabel: '真实执行',
    runtimeHint: '会生成只挂所选 Skill 的临时 worker 派发单轮执行；execution=static 时回落静态回显。',
  },
  tool: {
    kind: 'tool',
    label: '工具',
    icon: <Icons.Wrench size={14} />,
    accent: '--primary',
    defaultPrompt: '调用所需工具，记录输入、输出和异常。',
    hint: '调用内置工具',
    runtimeLabel: '真实执行',
    runtimeHint: '会生成临时 worker 并把能力收窄到所选工具（toolIds 白名单）派发执行；execution=static 时回落静态回显。',
  },
  mcp: {
    kind: 'mcp',
    label: 'MCP',
    icon: <Icons.MCP size={14} />,
    accent: '--primary',
    defaultPrompt: '使用所选 MCP 服务完成外部能力调用。',
    hint: '外部 MCP 服务',
    runtimeLabel: '真实执行',
    runtimeHint: '会生成只挂所选 MCP 服务的临时 worker 派发单轮执行；execution=static 时回落静态回显。',
  },
  approval: {
    kind: 'approval',
    label: '审批',
    icon: <Icons.Shield size={14} />,
    accent: '--warning',
    defaultPrompt: '在继续前等待用户确认关键计划或高风险动作。',
    hint: '人在回路：用户确认',
    runtimeLabel: '审批节点',
    runtimeHint: '运行时暂停并向用户请求批准或拒绝；批准时可附带修改意见，随审批结果经 outputKey 流向下游节点。',
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
    runtimeLabel: '只读派发',
    runtimeHint: '会用只读工具集（禁写/执行）派发单轮 LLM 产出复核文本；execution=static 时回落静态回显。',
  },
  artifact: {
    kind: 'artifact',
    label: '产物',
    icon: <Icons.File size={14} />,
    accent: '--success',
    defaultPrompt: '整理最终交付物、变更摘要和后续建议。',
    hint: '终点：交付制品',
    runtimeLabel: '真实执行',
    runtimeHint: '会派发单轮产出最终文本；配了 exportPath（工作区相对路径）时写入该文件；execution=static 时回落静态回显。',
  },
  loop: {
    kind: 'loop',
    label: '循环',
    icon: <Icons.Refresh size={14} />,
    accent: '--warning',
    defaultPrompt: '重复执行循环体，直到满足退出条件或达到最大迭代次数。',
    hint: '迭代子图：重复优化',
    runtimeLabel: '递归执行',
    runtimeHint: '作为原子节点递归执行 config.body 子图；默认最多 5 轮，硬上限 50，v1 不支持嵌套 loop。',
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
  'loop',
]

export function getNodeKindMeta(kind: WorkflowNodeKind | string): NodeKindMeta {
  return (NODE_KIND_META as Record<string, NodeKindMeta>)[kind] ?? NODE_KIND_META.agent
}
