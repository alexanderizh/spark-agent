import { describe, expect, it } from 'vitest'
import { SessionQuestionGate } from './session-question-gate.js'

describe('SessionQuestionGate', () => {
  it('stays blocked until every overlapping question is released', () => {
    const gate = new SessionQuestionGate()
    const releaseFirst = gate.enter('session-1')
    const releaseSecond = gate.enter('session-1')

    releaseFirst()
    releaseFirst()
    expect(gate.isBlocked('session-1')).toBe(true)

    releaseSecond()
    expect(gate.isBlocked('session-1')).toBe(false)
  })

  it('keeps sessions isolated and can be cleared during shutdown', () => {
    const gate = new SessionQuestionGate()
    gate.enter('session-1')
    gate.enter('session-2')

    expect(gate.isBlocked('session-1')).toBe(true)
    expect(gate.isBlocked('session-2')).toBe(true)

    gate.clear()
    expect(gate.isBlocked('session-1')).toBe(false)
    expect(gate.isBlocked('session-2')).toBe(false)
  })
})
