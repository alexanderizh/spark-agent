import { describe, expect, it } from 'vitest'
import {
  CODEX_PERMISSION_MODE_OPTIONS,
  SPARK_PERMISSION_MODE_OPTIONS,
  getPermissionModeOptions,
  getValidPermissionMode,
} from './permission-options'

describe('Codex permission copy', () => {
  it('describes the real sandbox behavior for every platform entry point', () => {
    expect(CODEX_PERMISSION_MODE_OPTIONS).toEqual([
      expect.objectContaining({
        value: 'codex-default',
        label: '按需批准',
        description: expect.stringMatching(/工作区内.*自动执行/),
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

describe('spark permission options', () => {
  it('registers exactly three spark engine modes', () => {
    expect(SPARK_PERMISSION_MODE_OPTIONS.map((option) => option.value)).toEqual([
      'spark-default',
      'spark-auto',
      'spark-bypass',
    ])
  })

  it('dispatches spark adapter to spark options; legacy values fall back to spark-default', () => {
    expect(getPermissionModeOptions('spark')).toBe(SPARK_PERMISSION_MODE_OPTIONS)
    expect(getValidPermissionMode('claude-ask', 'spark')).toBe('spark-default')
    expect(getValidPermissionMode('spark-auto', 'spark')).toBe('spark-auto')
    // 存量会话的旧档位不再出现在选项里，回退到手动审批。
    expect(getValidPermissionMode('spark-accept-edits', 'spark')).toBe('spark-default')
    expect(getValidPermissionMode('spark-plan', 'spark')).toBe('spark-default')
  })
})
