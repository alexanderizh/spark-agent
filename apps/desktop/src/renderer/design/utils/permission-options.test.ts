import { describe, expect, it } from 'vitest'
import {
  CODEX_PERMISSION_MODE_OPTIONS,
  SPARK_PERMISSION_MODE_OPTIONS,
  getPermissionModeOptions,
  getValidPermissionMode,
  mapPermissionModeAcrossAdapters,
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

describe('mapPermissionModeAcrossAdapters', () => {
  it('同引擎（含 claude ↔ claude-sdk）返回原值，不产生任何联动改写', () => {
    expect(mapPermissionModeAcrossAdapters('claude-bypass', 'claude')).toBe('claude-bypass')
    expect(mapPermissionModeAcrossAdapters('claude-bypass', 'claude-sdk')).toBe('claude-bypass')
    expect(mapPermissionModeAcrossAdapters('codex-auto-review', 'codex')).toBe('codex-auto-review')
    expect(mapPermissionModeAcrossAdapters('spark-auto', 'spark')).toBe('spark-auto')
  })

  it('跨引擎按档位语义等价映射，而不是重置回目标引擎默认档', () => {
    // 完全访问档
    expect(mapPermissionModeAcrossAdapters('claude-bypass', 'codex')).toBe('codex-full-access')
    expect(mapPermissionModeAcrossAdapters('codex-full-access', 'spark')).toBe('spark-bypass')
    expect(mapPermissionModeAcrossAdapters('spark-bypass', 'claude')).toBe('claude-bypass')
    // 手动/按需档
    expect(mapPermissionModeAcrossAdapters('claude-ask', 'codex')).toBe('codex-default')
    expect(mapPermissionModeAcrossAdapters('codex-default', 'spark')).toBe('spark-default')
    expect(mapPermissionModeAcrossAdapters('spark-default', 'claude')).toBe('claude-ask')
    // 自动编辑/审查档
    expect(mapPermissionModeAcrossAdapters('claude-auto-edits', 'codex')).toBe('codex-auto-review')
    expect(mapPermissionModeAcrossAdapters('codex-auto-review', 'spark')).toBe('spark-auto')
    expect(mapPermissionModeAcrossAdapters('spark-auto', 'claude')).toBe('claude-auto-edits')
  })

  it('目标引擎没有的档位就近降档（plan → 手动档、autoPolicy → 自动编辑档）', () => {
    expect(mapPermissionModeAcrossAdapters('claude-plan', 'codex')).toBe('codex-default')
    expect(mapPermissionModeAcrossAdapters('claude-plan', 'spark')).toBe('spark-default')
    expect(mapPermissionModeAcrossAdapters('claude-auto', 'codex')).toBe('codex-auto-review')
    expect(mapPermissionModeAcrossAdapters('claude-auto', 'spark')).toBe('spark-auto')
  })

  it('空值兜底回目标引擎默认档', () => {
    expect(mapPermissionModeAcrossAdapters(undefined, 'codex')).toBe('codex-default')
    expect(mapPermissionModeAcrossAdapters(undefined, 'spark')).toBe('spark-default')
    expect(mapPermissionModeAcrossAdapters(undefined, 'claude')).toBe('claude-ask')
  })
})
