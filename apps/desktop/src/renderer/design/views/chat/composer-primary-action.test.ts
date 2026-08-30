import { describe, expect, it } from 'vitest'
import {
  resolveComposerPrimaryAction,
  resolveComposerPrimaryActionTitle,
} from './composer-primary-action'

describe('composer primary action', () => {
  it('sends a new turn when the session is running and the draft is submittable', () => {
    expect(resolveComposerPrimaryAction(true, true)).toBe('send')
  })

  it('stops the active turn when the session is running and the draft is empty', () => {
    expect(resolveComposerPrimaryAction(true, false)).toBe('stop')
  })

  it('keeps the idle composer in send mode', () => {
    expect(resolveComposerPrimaryAction(false, true)).toBe('send')
    expect(resolveComposerPrimaryAction(false, false)).toBe('send')
  })

  it('describes queued sends separately from stopping the active turn', () => {
    expect(resolveComposerPrimaryActionTitle('send', true, false, false)).toBe('发送并排队')
    expect(resolveComposerPrimaryActionTitle('stop', true, false, false)).toBe('停止会话')
  })
})
