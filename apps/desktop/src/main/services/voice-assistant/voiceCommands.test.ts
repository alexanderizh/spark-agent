import { describe, expect, it } from 'vitest'
import {
  buildCandidateSelectionSpeech,
  buildSessionSelectionSpeech,
  matchCandidateIndexByName,
  parseVoiceCommand,
} from './voiceCommands.js'

describe('parseVoiceCommand', () => {
  it('新开会话祈使句命中', () => {
    expect(parseVoiceCommand('新开会话')?.kind).toBe('new-session')
    expect(parseVoiceCommand('新开一个会话')?.kind).toBe('new-session')
    expect(parseVoiceCommand('新建会话。')?.kind).toBe('new-session')
    expect(parseVoiceCommand('换个会话吧')?.kind).toBe('new-session')
    expect(parseVoiceCommand('开个新对话！')?.kind).toBe('new-session')
  })

  it('普通对话不误命中命令', () => {
    expect(parseVoiceCommand('帮我看看这个报错是什么原因')).toBeNull()
    expect(parseVoiceCommand('新开一个分支然后提交代码')).toBeNull()
    expect(parseVoiceCommand('换一种方式实现这个功能')).toBeNull()
    expect(parseVoiceCommand('会话列表导出功能怎么用')).toBeNull()
  })

  it('停止类命令命中', () => {
    expect(parseVoiceCommand('算了')?.kind).toBe('stop-listening')
    expect(parseVoiceCommand('不用了。')?.kind).toBe('stop-listening')
  })

  it('选择态下数字序号命中（含中文数字）', () => {
    expect(parseVoiceCommand('第2个', { awaitingSessionSelection: true })).toEqual({
      kind: 'select-session',
      index: 2,
      name: null,
    })
    expect(parseVoiceCommand('三', { awaitingSessionSelection: true })).toEqual({
      kind: 'select-session',
      index: 3,
      name: null,
    })
  })

  it('选择态下短文本按名称匹配', () => {
    expect(parseVoiceCommand('语音会话', { awaitingSessionSelection: true })).toEqual({
      kind: 'select-session',
      index: null,
      name: '语音会话',
    })
  })

  it('切换会话列表命令需显式开启（M1 不拦截）', () => {
    expect(parseVoiceCommand('切换会话')).toBeNull()
    expect(parseVoiceCommand('列出会话', { enableSessionCommands: true })?.kind).toBe(
      'switch-session',
    )
  })

  it('切换工作区命令需显式开启并提取名称', () => {
    expect(parseVoiceCommand('切换到我的项目工作区')).toBeNull()
    expect(parseVoiceCommand('切换到我的项目工作区', { enableSessionCommands: true })).toEqual({
      kind: 'switch-workspace',
      name: '我的项目',
    })
  })

  it('空文本与超长文本不命中', () => {
    expect(parseVoiceCommand('')).toBeNull()
    expect(parseVoiceCommand('新开会话'.padEnd(80, '啊'))).toBeNull()
  })
})

describe('parseVoiceCommand M4（模型/项目/带名会话）', () => {
  it('切换模型列表与带名直选命中', () => {
    expect(parseVoiceCommand('切换模型', { enableSessionCommands: true })).toEqual({
      kind: 'switch-model',
      name: null,
    })
    expect(parseVoiceCommand('有哪些模型', { enableSessionCommands: true })?.kind).toBe(
      'switch-model',
    )
    expect(parseVoiceCommand('切换到gpt-4o模型', { enableSessionCommands: true })).toEqual({
      kind: 'switch-model',
      name: 'gpt-4o',
    })
    expect(parseVoiceCommand('用claude-sonnet-4-5模型', { enableSessionCommands: true })).toEqual({
      kind: 'switch-model',
      name: 'claude-sonnet-4-5',
    })
  })

  it('裸「换成 XX」仅含字母数字才命中（防拦截普通对话）', () => {
    expect(parseVoiceCommand('换成gpt4o', { enableSessionCommands: true })).toEqual({
      kind: 'switch-model',
      name: 'gpt4o',
    })
    expect(parseVoiceCommand('换成表格形式', { enableSessionCommands: true })).toBeNull()
  })

  it('切换项目命中列表语义（复用 switch-workspace）', () => {
    expect(parseVoiceCommand('切换项目', { enableSessionCommands: true })).toEqual({
      kind: 'switch-workspace',
      name: null,
    })
    expect(parseVoiceCommand('项目列表', { enableSessionCommands: true })?.kind).toBe(
      'switch-workspace',
    )
    expect(parseVoiceCommand('有哪些工作区', { enableSessionCommands: true })?.kind).toBe(
      'switch-workspace',
    )
  })

  it('模型/项目挂起选择态：序号与名称命中对应 select 命令', () => {
    expect(parseVoiceCommand('第2个', { awaitingModelSelection: true })).toEqual({
      kind: 'select-model',
      index: 2,
      name: null,
    })
    expect(parseVoiceCommand('sonnet', { awaitingModelSelection: true })).toEqual({
      kind: 'select-model',
      index: null,
      name: 'sonnet',
    })
    expect(parseVoiceCommand('第1个', { awaitingProjectSelection: true })).toEqual({
      kind: 'select-project',
      index: 1,
      name: null,
    })
    expect(parseVoiceCommand('个人项目', { awaitingProjectSelection: true })).toEqual({
      kind: 'select-project',
      index: null,
      name: '个人项目',
    })
  })

  it('会话带名直选：切换到 XX 的会话提取名称', () => {
    expect(parseVoiceCommand('切换到画布功能的会话', { enableSessionCommands: true })).toEqual({
      kind: 'switch-session',
      name: '画布功能',
    })
    expect(parseVoiceCommand('切个会话', { enableSessionCommands: true })).toEqual({
      kind: 'switch-session',
      name: null,
    })
  })

  it('挂起选择态逃生门：放弃选择回到聊天', () => {
    // 三类挂起态下「不切了/退出」命中 cancel-selection
    expect(parseVoiceCommand('不切了', { awaitingModelSelection: true })).toEqual({
      kind: 'cancel-selection',
    })
    expect(parseVoiceCommand('退出', { awaitingSessionSelection: true })).toEqual({
      kind: 'cancel-selection',
    })
    expect(parseVoiceCommand('先不换了。', { awaitingProjectSelection: true })).toEqual({
      kind: 'cancel-selection',
    })
    expect(parseVoiceCommand('继续聊', { awaitingModelSelection: true })?.kind).toBe(
      'cancel-selection',
    )
  })

  it('逃生门仅挂起态生效：非挂起态放行走聊天', () => {
    expect(parseVoiceCommand('退出')).toBeNull()
    expect(parseVoiceCommand('不切了', { enableSessionCommands: true })).toBeNull()
    expect(parseVoiceCommand('继续聊')).toBeNull()
  })

  it('停止类命令优先级高于逃生门（挂起态下「算了」仍关语音）', () => {
    expect(parseVoiceCommand('算了', { awaitingModelSelection: true })?.kind).toBe('stop-listening')
    expect(parseVoiceCommand('取消', { awaitingSessionSelection: true })?.kind).toBe(
      'stop-listening',
    )
  })

  it('礼貌前缀只作用于 M4 新意图：会话列表语义保持原样', () => {
    // 「帮我看看会话列表」不算命令的 M2 约定不破坏
    expect(parseVoiceCommand('帮我看看会话列表', { enableSessionCommands: true })).toBeNull()
    expect(parseVoiceCommand('帮我切换模型', { enableSessionCommands: true })?.kind).toBe(
      'switch-model',
    )
    expect(parseVoiceCommand('请切换项目', { enableSessionCommands: true })?.kind).toBe(
      'switch-workspace',
    )
  })
})

describe('buildCandidateSelectionSpeech', () => {
  it('念前五个候选并带序号', () => {
    const speech = buildCandidateSelectionSpeech('模型', ['a', 'b', 'c', 'd', 'e', 'f'])
    expect(speech).toContain('模型有：')
    expect(speech).toContain('1，a')
    expect(speech).toContain('5，e')
    expect(speech).not.toContain('f')
    expect(speech).toContain('请说序号或名称')
  })

  it('超长条目截断', () => {
    const speech = buildCandidateSelectionSpeech('项目', ['很长的项目名称'.repeat(5)])
    expect(speech).toContain('…')
    expect(speech).not.toContain('很长的项目名称'.repeat(5))
  })
})

describe('matchCandidateIndexByName', () => {
  it('双向包含与忽略大小写匹配', () => {
    expect(matchCandidateIndexByName(['会话A：语音助手开发', '会话B：画布功能'], '画布功能')).toBe(
      1,
    )
    expect(matchCandidateIndexByName(['GPT-4o', 'claude'], 'gpt')).toBe(0)
  })

  it('未命中与空白名称返回 null', () => {
    expect(matchCandidateIndexByName(['a', 'b'], 'c')).toBeNull()
    expect(matchCandidateIndexByName(['a'], ' ')).toBeNull()
  })
})

describe('buildSessionSelectionSpeech', () => {
  it('最多念五个会话并带序号', () => {
    const speech = buildSessionSelectionSpeech(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(speech).toContain('1，a')
    expect(speech).toContain('5，e')
    expect(speech).not.toContain('f')
    expect(speech).toContain('请说序号或会话名称')
  })
})
