/**
 * buildTeamRosterPrompt 单元测试（Phase 5）
 *
 * 验证花名册 system prompt 段包含正确的成员 id/name 与链式深度限制。
 */
import { describe, it, expect } from 'vitest'
import { buildTeamRosterPrompt } from './session.service.js'
import type { AgentItem } from '@spark/storage'
import type { TeamModeConfig } from '@spark/protocol'

function agent(id: string, name: string, description = ''): AgentItem {
  return {
    id,
    name,
    description,
    builtIn: false,
    enabled: true,
    providerProfileId: null,
    modelId: null,
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-ask',
    reasoningEffort: 'medium',
    prompt: '',
    ruleIds: [],
    skillIds: [],
    disabledSkillIds: [],
    mcpServerIds: [],
    hookConfig: {},
    workflowId: null,
    metadata: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

const config: TeamModeConfig = {
  enabled: true,
  hostAgentId: 'code-agent',
  memberAgentIds: ['rust-coder', 'reviewer'],
  maxDepth: 2,
  allowNesting: true,
}

describe('buildTeamRosterPrompt', () => {
  it('lists each member id and name with the dispatch depth limit', () => {
    const host = agent('code-agent', '编码 Agent')
    const members = [agent('rust-coder', 'Rust Coder', 'Python→Rust 转译'), agent('reviewer', 'Reviewer', '代码审查')]
    const prompt = buildTeamRosterPrompt(host, members, config)

    expect(prompt).toContain('[Team Roster]')
    expect(prompt).toContain('id: rust-coder')
    expect(prompt).toContain('name: Rust Coder')
    expect(prompt).toContain('id: reviewer')
    expect(prompt).toContain('description: Python→Rust 转译')
    expect(prompt).toContain('mcp__spark_team__agent_dispatch')
    expect(prompt).toContain('at most 2 chained dispatch level(s)')
  })

  it('returns empty string when there are no members', () => {
    const host = agent('code-agent', '编码 Agent')
    expect(buildTeamRosterPrompt(host, [], config)).toBe('')
  })
})
