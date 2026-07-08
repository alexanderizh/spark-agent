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
    isDefault: false,
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
    // 团队模式核心引导：host 是编排者，优先按专长分配，不应独自执行（防回退）
    expect(prompt).toContain('ORCHESTRATE')
    expect(prompt).toContain('Match by expertise')
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

  it('host perspective: references team_round_advance / team_conclude (显式轮次状态机，替代旧 CONVERGE 劝诫)', () => {
    const host = agent('code-agent', '编码 Agent')
    const members = [agent('rust-coder', 'Rust Coder')]
    const prompt = buildTeamRosterPrompt(host, members, config)
    expect(prompt).toContain('team_round_advance')
    expect(prompt).toContain('team_conclude')
    expect(prompt).not.toContain('CONVERGE to an answer')
  })

  it('host perspective: documents team_thread_read for reading back the group chat', () => {
    const host = agent('code-agent', '编码 Agent')
    const members = [agent('rust-coder', 'Rust Coder')]
    const prompt = buildTeamRosterPrompt(host, members, config)
    expect(prompt).toContain('mcp__spark_team__team_thread_read')
    // 关键使用时机：成员说发过了但没看到内容 / 消息被省略
    expect(prompt).toContain('messageId')
  })

  it('member perspective: describes role + peer messaging + thread snippet', () => {
    const host = agent('code-agent', 'Host')
    const me = agent('rust-coder', 'Rust Coder', 'Rust 专项')
    const reviewer = agent('reviewer', 'Reviewer', '代码审查')
    const prompt = buildTeamRosterPrompt(host, [me, reviewer], config, {
      perspective: 'member',
      viewingMember: me,
      enablePeerMessaging: true,
      threadSnippet: '[R0] reviewer: looks good',
    })
    expect(prompt).toContain('a MEMBER of Host')
    // others 花名册含 reviewer，不含自己（id: 形式）
    expect(prompt).toContain('id: reviewer')
    expect(prompt).not.toContain('id: rust-coder')
	    expect(prompt).toContain('agent_message')
	    expect(prompt).toContain('Do NOT immediately ping back')
	    expect(prompt).toContain('[Collaboration Playbook]')
	    expect(prompt).toContain('MODE 1')
	    expect(prompt).toContain('MODE 2')
	    expect(prompt).toContain('in this very turn')
	    expect(prompt).toContain('MODE 3')
	    expect(prompt).toContain('MODE 4')
	    expect(prompt).toContain('mode: "note"')
	    expect(prompt).toContain('[Discussion So Far]')
	    expect(prompt).toContain('[R0] reviewer: looks good')
	  })

	  it('host perspective: tells host not to relay peer consultations when peer messaging is on', () => {
	    const host = agent('code-agent', 'Host')
	    const reviewer = agent('reviewer', 'Reviewer', '代码审查')
	    const prompt = buildTeamRosterPrompt(host, [reviewer], {
	      ...config,
	      enablePeerMessaging: true,
	    })
	    expect(prompt).toContain('Members may consult each other before replying to you')
	    expect(prompt).toContain('Do NOT act as a relay between members')
	  })

  it('member perspective: enablePeerMessaging=false omits agent_message guidance', () => {
    const host = agent('code-agent', 'Host')
    const me = agent('rust-coder', 'Rust Coder')
    const prompt = buildTeamRosterPrompt(host, [me, agent('reviewer', 'Reviewer')], config, {
      perspective: 'member',
      viewingMember: me,
      enablePeerMessaging: false,
      threadSnippet: '[R0] reviewer: scoped note',
    })
    expect(prompt).toContain('a MEMBER of Host')
    expect(prompt).toContain('[Discussion So Far]')
    expect(prompt).toContain('[R0] reviewer: scoped note')
    expect(prompt).not.toContain('agent_message')
  })

  it('member perspective: injects the group-chat reading manual (team_thread_read) even with peer messaging off', () => {
    const host = agent('code-agent', 'Host')
    const me = agent('rust-coder', 'Rust Coder')
    const prompt = buildTeamRosterPrompt(host, [me, agent('reviewer', 'Reviewer')], config, {
      perspective: 'member',
      viewingMember: me,
      enablePeerMessaging: false,
      threadSnippet: '[R0] reviewer: scoped note',
    })
    // 手册无条件注入：peer 关着也要让成员知道快照是截断预览、全文怎么拿
    expect(prompt).toContain('[Reading the group chat]')
    expect(prompt).toContain('TRUNCATED preview')
    expect(prompt).toContain('mcp__spark_team__team_thread_read')
    expect(prompt).toContain('BEFORE concluding a teammate "did not answer"')
  })
})
