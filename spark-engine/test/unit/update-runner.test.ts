import { describe, expect, it } from 'vitest'

import { describeUpdateOutcome } from '../../src/tui/update-runner.js'

describe('describeUpdateOutcome', () => {
  it('marks an applied update as success and tells the user to restart', () => {
    const outcome = describeUpdateOutcome(0, false, 'Updated spark 0.2.0 -> 0.3.0 at /x\n')
    expect(outcome.tone).toBe('ok')
    expect(outcome.lines).toContain('Updated spark 0.2.0 -> 0.3.0 at /x')
    expect(outcome.lines.at(-1)).toContain('重新运行 spark')
  })

  it('keeps check-only availability informational without the restart hint', () => {
    const outcome = describeUpdateOutcome(0, true, 'Update available: 0.2.0 -> 0.3.0\n')
    expect(outcome.tone).toBe('info')
    expect(outcome.lines).toEqual(['Update available: 0.2.0 -> 0.3.0'])
    expect(outcome.lines.join('\n')).not.toContain('重新运行')
  })

  it('passes nothing-to-do reports through as info with a default line', () => {
    const quiet = describeUpdateOutcome(1, false, '')
    expect(quiet.tone).toBe('info')
    expect(quiet.lines).toEqual(['已是最新版本。'])

    const gated = describeUpdateOutcome(1, true, 'The latest release 0.4.0-rc.1 is a prerelease…')
    expect(gated.lines).toEqual(['The latest release 0.4.0-rc.1 is a prerelease…'])
  })

  it('reports a held lock distinctly', () => {
    const outcome = describeUpdateOutcome(4, false, '')
    expect(outcome.tone).toBe('error')
    expect(outcome.lines[0]).toContain('另一次更新')
  })

  it('surfaces raw failure output and never fabricates details', () => {
    const outcome = describeUpdateOutcome(3, false, 'spark update failed: checksum mismatch')
    expect(outcome.tone).toBe('error')
    expect(outcome.lines).toEqual(['spark update failed: checksum mismatch'])

    const silent = describeUpdateOutcome(3, false, '')
    expect(silent.lines).toEqual(['更新失败。'])
  })
})
