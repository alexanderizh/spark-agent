import { describe, expect, it } from 'vitest'
import { createSubmitGate } from './submit-gate'

describe('submit gate', () => {
  it('rejects a second synchronous entry until the first dispatch releases it', () => {
    const gate = createSubmitGate()

    expect(gate.tryEnter()).toBe(true)
    expect(gate.tryEnter()).toBe(false)

    gate.leave()

    expect(gate.tryEnter()).toBe(true)
  })
})
