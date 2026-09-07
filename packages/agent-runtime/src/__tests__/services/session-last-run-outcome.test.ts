import { describe, expect, it } from 'vitest'
import {
  getLastRunOutcomeFromMetadata,
  toLastRunOutcome,
} from '../../services/session/session-pure-utils.js'

describe('session last-run-outcome metadata', () => {
  it('maps terminal stream statuses to persistent outcomes, transient ones to null', () => {
    expect(toLastRunOutcome('completed')).toBe('completed')
    expect(toLastRunOutcome('cancelled')).toBe('cancelled')
    expect(toLastRunOutcome('error')).toBe('error')
    // 瞬态/非结果状态不写结果（保持原值）。
    expect(toLastRunOutcome('idle')).toBeNull()
    expect(toLastRunOutcome('running')).toBeNull()
    expect(toLastRunOutcome('waiting_user')).toBeNull()
    expect(toLastRunOutcome(null)).toBeNull()
    expect(toLastRunOutcome(undefined)).toBeNull()
  })

  it('reads a valid lastRunOutcome from session metadata', () => {
    expect(getLastRunOutcomeFromMetadata('{"lastRunOutcome":"completed"}')).toBe('completed')
    expect(getLastRunOutcomeFromMetadata('{"lastRunOutcome":"cancelled"}')).toBe('cancelled')
    expect(getLastRunOutcomeFromMetadata('{"lastRunOutcome":"error"}')).toBe('error')
    expect(getLastRunOutcomeFromMetadata('{"debugMode":true}')).toBeNull()
  })

  it('rejects illegal values and corrupted metadata without throwing', () => {
    expect(getLastRunOutcomeFromMetadata('{"lastRunOutcome":"running"}')).toBeNull()
    expect(getLastRunOutcomeFromMetadata('{"lastRunOutcome":42}')).toBeNull()
    expect(getLastRunOutcomeFromMetadata('broken json')).toBeNull()
    expect(getLastRunOutcomeFromMetadata(null)).toBeNull()
    expect(getLastRunOutcomeFromMetadata('')).toBeNull()
    expect(getLastRunOutcomeFromMetadata(undefined)).toBeNull()
  })
})
