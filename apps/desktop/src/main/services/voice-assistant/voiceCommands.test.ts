import { describe, expect, it } from 'vitest'
import {
  buildSessionSelectionSpeech,
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
    expect(
      parseVoiceCommand('第2个', { awaitingSessionSelection: true }),
    ).toEqual({ kind: 'select-session', index: 2, name: null })
    expect(
      parseVoiceCommand('三', { awaitingSessionSelection: true }),
    ).toEqual({ kind: 'select-session', index: 3, name: null })
  })

  it('选择态下短文本按名称匹配', () => {
    expect(
      parseVoiceCommand('语音会话', { awaitingSessionSelection: true }),
    ).toEqual({ kind: 'select-session', index: null, name: '语音会话' })
  })

  it('切换会话列表命令需显式开启（M1 不拦截）', () => {
    expect(parseVoiceCommand('切换会话')).toBeNull()
    expect(
      parseVoiceCommand('列出会话', { enableSessionCommands: true })?.kind,
    ).toBe('switch-session')
  })

  it('切换工作区命令需显式开启并提取名称', () => {
    expect(parseVoiceCommand('切换到我的项目工作区')).toBeNull()
    expect(
      parseVoiceCommand('切换到我的项目工作区', { enableSessionCommands: true }),
    ).toEqual({ kind: 'switch-workspace', name: '我的项目' })
  })

  it('空文本与超长文本不命中', () => {
    expect(parseVoiceCommand('')).toBeNull()
    expect(parseVoiceCommand('新开会话'.padEnd(80, '啊'))).toBeNull()
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
