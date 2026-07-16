import { describe, expect, it } from 'vitest'
import { CODEX_PERMISSION_MODE_OPTIONS } from './permission-options'

describe('Codex permission copy', () => {
  it('describes the real sandbox behavior for every platform entry point', () => {
    expect(CODEX_PERMISSION_MODE_OPTIONS).toEqual([
      expect.objectContaining({
        value: 'codex-default',
        label: '请求批准',
        description: expect.stringContaining('workspace-write'),
      }),
      expect.objectContaining({
        value: 'codex-auto-review',
        label: '替我批准',
        description: expect.stringContaining('自动审查'),
      }),
      expect.objectContaining({
        value: 'codex-full-access',
        label: '完全访问',
        description: expect.stringMatching(/Git|\.git/),
        tone: 'danger',
      }),
    ])
  })
})
