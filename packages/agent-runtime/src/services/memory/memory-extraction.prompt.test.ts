import { describe, expect, it } from 'vitest'
import { buildExtractionPrompt } from './memory-extraction.prompt.js'

describe('buildExtractionPrompt', () => {
  const base = {
    userMessage: '你是一个架构师，你懂得所有技术栈的知识，记一下',
    assistantMessage: '好的，我会按架构师视角协助。',
    recentSummary: '',
    existingMemoriesSummary: '',
    workspaceId: 'ws-1',
    agentId: 'agent-architect',
  }

  it('prioritizes explicit remember instructions as memory-worthy unless blocked by hard gates', () => {
    const prompt = buildExtractionPrompt(base)

    expect(prompt).toContain('记一下')
    expect(prompt).toContain('记住')
    expect(prompt).toContain('必须至少抽取')
    expect(prompt).toContain('除非命中')
  })

  it('classifies assigned agent roles and work style as agent-scoped feedback by default', () => {
    const prompt = buildExtractionPrompt(base)

    expect(prompt).toContain('给当前助手/Agent 分配长期角色')
    expect(prompt).toContain('scope=agent')
    expect(prompt).toContain('type=feedback')
    expect(prompt).toContain('架构师')
  })

  it('treats recent context as pointer resolution only and forbids extracting from history alone', () => {
    const prompt = buildExtractionPrompt({
      ...base,
      userMessage: '对，就按刚才那个方式记一下',
      recentSummary: 'Earlier: 用户曾短暂要求输出 demo，不代表长期偏好。',
    })

    // 文案在指代扩窗改造中调整：RECENT_CONTEXT 与「只能用于理解本轮指代」
    // 之间插入了范围说明，断言改锚定后半句；同时断言新增的防猜测护栏。
    expect(prompt).toContain('只能用于理解本轮指代')
    expect(prompt).toContain('不能仅凭 RECENT_CONTEXT 生成新记忆')
    expect(prompt).toContain('不要凭猜测补全对象')
    expect(prompt).toContain('本轮')
  })
})
