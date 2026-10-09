import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_READONLY_ALLOWED_TOOL_IDS,
  WORKFLOW_READONLY_DISALLOWED_TOOLS,
  createWorkflowAtomicMember,
  memberDisallowedToolsFromConfig,
} from '../session-workflow-helpers.js'
import type { AgentItem } from '@spark/storage'
import type { NormalizedWorkflowNode } from '../workflow-executor.js'

function node(
  kind: NormalizedWorkflowNode['kind'],
  config: Record<string, unknown> = {},
): NormalizedWorkflowNode {
  return { id: `n-${kind}`, kind, title: `节点-${kind}`, config }
}

const hostAgent: AgentItem = {
  id: 'host',
  name: 'Host',
  description: '',
  builtIn: false,
  enabled: true,
  isDefault: false,
  providerProfileId: 'provider',
  modelId: 'model',
  agentAdapter: 'claude-sdk',
  permissionMode: 'claude-plan',
  reasoningEffort: 'high',
  prompt: '',
  ruleIds: [],
  skillIds: [],
  disabledSkillIds: [],
  mcpServerIds: [],
  hookConfig: {},
  workflowId: null,
  metadata: {},
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
}

describe('readonly atomic worker question policy', () => {
  it('keeps AskUserQuestion out of the readonly allow-list and in the disallow-list', () => {
    // 实测修复：route worker 曾用 AskUserQuestion 自行发起审批问询，用户拒绝后
    // 拒绝意图无法终止 run（route 只认 routeOptions 白名单，被判非法输出重试并
    // 再次弹窗）。人工审批职责专属 approval 节点，只读 worker 一律不授予问询。
    expect(WORKFLOW_READONLY_DISALLOWED_TOOLS).toContain('AskUserQuestion')
    expect(WORKFLOW_READONLY_ALLOWED_TOOL_IDS).not.toContain('AskUserQuestion')
  })

  it('filters AskUserQuestion even when a readonly node explicitly configures it', () => {
    for (const kind of ['input', 'route', 'plan', 'review', 'artifact'] as const) {
      const member = createWorkflowAtomicMember(
        node(kind, { toolIds: ['Read', 'AskUserQuestion'] }),
        hostAgent,
      )
      expect(member.metadata?.toolIds).toContain('Read')
      expect(member.metadata?.toolIds).not.toContain('AskUserQuestion')
    }
  })

  it('resolves readonly workers with AskUserQuestion on the disallowed side', () => {
    const member = createWorkflowAtomicMember(node('route'), hostAgent)
    expect(memberDisallowedToolsFromConfig(member)).toContain('AskUserQuestion')
  })
})
