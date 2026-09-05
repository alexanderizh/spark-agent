import { describe, expect, it } from 'vitest'
import type { SessionPermissionMode } from '@spark/protocol'
import {
  getAgentAdapterFromSession,
  getPermissionModeFromSession,
  isCodexPermissionMode,
  isSparkPermissionMode,
  normalizeAgentAdapter,
  normalizePermissionMode,
  resolveEngineKind,
} from '../../../services/session/engine-kinds.js'

/**
 * engine-kinds 归一化模块单测（P1-W1-D4）。
 * 锁定：resolveEngineKind 穷尽映射、normalizePermissionMode 查表行为
 * （含与旧 startsWith 嗅探的已知差异边界——非法 'codex-*' 脏字符串）。
 */

describe('resolveEngineKind', () => {
  it('4 值 adapter 穷尽映射到 3 值引擎', () => {
    expect(resolveEngineKind('claude')).toBe('claude-sdk')
    expect(resolveEngineKind('claude-sdk')).toBe('claude-sdk')
    expect(resolveEngineKind('codex')).toBe('codex')
    expect(resolveEngineKind('spark')).toBe('spark')
  })
})

describe('isCodexPermissionMode', () => {
  it('codex 侧 3 个合法模式为 true', () => {
    for (const mode of ['codex-default', 'codex-auto-review', 'codex-full-access']) {
      expect(isCodexPermissionMode(mode)).toBe(true)
    }
  })

  it('claude/spark 侧模式、空值与非法值为 false', () => {
    expect(isCodexPermissionMode('claude-ask')).toBe(false)
    expect(isCodexPermissionMode('claude-bypass')).toBe(false)
    expect(isCodexPermissionMode('spark-default')).toBe(false)
    expect(isCodexPermissionMode(null)).toBe(false)
    expect(isCodexPermissionMode(undefined)).toBe(false)
    expect(isCodexPermissionMode('')).toBe(false)
    expect(isCodexPermissionMode('codex-unknown-dirty')).toBe(false)
  })
})

describe('isSparkPermissionMode', () => {
  it('spark 侧 4 个合法模式为 true，其他侧为 false', () => {
    for (const mode of ['spark-default', 'spark-accept-edits', 'spark-plan', 'spark-bypass']) {
      expect(isSparkPermissionMode(mode)).toBe(true)
    }
    expect(isSparkPermissionMode('claude-ask')).toBe(false)
    expect(isSparkPermissionMode('codex-default')).toBe(false)
    expect(isSparkPermissionMode(null)).toBe(false)
    expect(isSparkPermissionMode('spark-unknown-dirty')).toBe(false)
  })
})

describe('normalizePermissionMode', () => {
  it('12 个合法模式原样返回', () => {
    const modes: SessionPermissionMode[] = [
      'claude-ask',
      'claude-auto-edits',
      'claude-plan',
      'claude-auto',
      'claude-bypass',
      'codex-default',
      'codex-auto-review',
      'codex-full-access',
      'spark-default',
      'spark-accept-edits',
      'spark-plan',
      'spark-bypass',
    ]
    for (const mode of modes) {
      expect(normalizePermissionMode(mode)).toBe(mode)
    }
  })

  it('空值/未知值回落 claude-ask（系统默认侧）', () => {
    expect(normalizePermissionMode(null)).toBe('claude-ask')
    expect(normalizePermissionMode(undefined)).toBe('claude-ask')
    expect(normalizePermissionMode('acceptEdits')).toBe('claude-ask')
  })

  it('非法 codex-* 脏字符串回落 claude-ask（查表化的已知差异，旧实现会回落 codex-default）', () => {
    expect(normalizePermissionMode('codex-unknown-dirty')).toBe('claude-ask')
  })

  it('非法 spark-* 脏字符串回落 claude-ask', () => {
    expect(normalizePermissionMode('spark-unknown-dirty')).toBe('claude-ask')
  })
})

describe('normalizeAgentAdapter', () => {
  it('合法值归并、未知值回落 claude-sdk', () => {
    expect(normalizeAgentAdapter('claude')).toBe('claude-sdk')
    expect(normalizeAgentAdapter('claude-sdk')).toBe('claude-sdk')
    expect(normalizeAgentAdapter('codex')).toBe('codex')
    expect(normalizeAgentAdapter('spark')).toBe('spark')
    expect(normalizeAgentAdapter(null)).toBe('claude-sdk')
    expect(normalizeAgentAdapter('garbage')).toBe('claude-sdk')
  })
})

describe('getAgentAdapterFromSession / getPermissionModeFromSession（迁移回归锁定）', () => {
  it('adapter 解析优先级：显式值 > legacy chat_mode > 渠道 spark 开关 > providerType 推断', () => {
    expect(getAgentAdapterFromSession('claude-sdk', null, 'anthropic')).toBe('claude-sdk')
    expect(getAgentAdapterFromSession('claude', null, 'anthropic')).toBe('claude-sdk')
    expect(getAgentAdapterFromSession('codex', null, 'openai')).toBe('codex')
    expect(getAgentAdapterFromSession('spark', null, 'openai')).toBe('spark')
    expect(getAgentAdapterFromSession(null, 'codex', 'openai')).toBe('codex')
    expect(getAgentAdapterFromSession(null, 'spark', 'openai')).toBe('spark')
    expect(getAgentAdapterFromSession(null, null, 'anthropic')).toBe('claude-sdk')
    expect(getAgentAdapterFromSession(null, null, 'openai')).toBe('codex')
  })

  it('渠道开关：显式 adapter 与 legacy chat_mode 未定时，useSparkExecutor 优先于 providerType 推断', () => {
    expect(getAgentAdapterFromSession(null, null, 'anthropic', true)).toBe('spark')
    expect(getAgentAdapterFromSession(null, null, 'openai', true)).toBe('spark')
    expect(getAgentAdapterFromSession(null, null, 'openai', false)).toBe('codex')
    expect(getAgentAdapterFromSession(null, null, 'openai', null)).toBe('codex')
  })

  it('渠道开关不越过显式 adapter / legacy chat_mode', () => {
    expect(getAgentAdapterFromSession('claude-sdk', null, 'openai', true)).toBe('claude-sdk')
    expect(getAgentAdapterFromSession(null, 'codex', 'anthropic', true)).toBe('codex')
  })

  it('权限模式按 adapter 侧回落', () => {
    expect(getPermissionModeFromSession(null, 'codex')).toBe('codex-default')
    expect(getPermissionModeFromSession(null, 'claude-sdk')).toBe('claude-ask')
    expect(getPermissionModeFromSession(null, 'spark')).toBe('spark-default')
    expect(getPermissionModeFromSession('claude-auto', 'codex')).toBe('claude-auto')
    expect(getPermissionModeFromSession('spark-accept-edits', 'spark')).toBe('spark-accept-edits')
  })
})
