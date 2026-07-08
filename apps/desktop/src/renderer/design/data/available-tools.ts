import { WORKFLOW_RESTRICTABLE_TOOLS, type WorkflowToolGroup } from '@spark/protocol'

export type CodingAgentToolGroup = WorkflowToolGroup | '扩展' | '诊断' | '浏览器'

export type CodingAgentTool = {
  name: string
  group: CodingAgentToolGroup
  status: 'built-in' | 'extension'
}

// 内置工具沿用 @spark/protocol 里工作流节点「工具」选择器同一份目录（真实 SDK 工具名），
// 避免这里的展示名和后端实际生效的工具名再次分叉。
export const CODING_AGENT_TOOLS: CodingAgentTool[] = [
  ...WORKFLOW_RESTRICTABLE_TOOLS.map((tool) => ({ name: tool.name, group: tool.group, status: 'built-in' as const })),
  { name: 'mcp_tools', group: '扩展', status: 'extension' },
  { name: 'lsp_diagnostics', group: '诊断', status: 'extension' },
  { name: 'browser', group: '浏览器', status: 'extension' },
]
