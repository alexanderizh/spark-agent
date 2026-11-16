import { describe, expect, it } from 'vitest'
import { applyRefinedVoiceText } from './useComposerVoice'

describe('applyRefinedVoiceText', () => {
  it('replaces the streamed transcript suffix with the whole-clip refinement', () => {
    expect(applyRefinedVoiceText('先写的内容 hello world', 'hello world', 'Hello, world.')).toBe(
      '先写的内容 Hello, world.',
    )
  })

  it('appends refined text when streaming produced no final segment', () => {
    expect(applyRefinedVoiceText('已有草稿', '', '这是整段精修结果。')).toBe(
      '已有草稿 这是整段精修结果。',
    )
  })

  it('keeps user-edited text when the streamed suffix no longer matches', () => {
    expect(applyRefinedVoiceText('hello edited', 'hello', 'Hello.')).toBe('hello edited')
  })

  it('does not append an empty refinement', () => {
    expect(applyRefinedVoiceText('已有草稿', '', '')).toBe('已有草稿')
  })
})
