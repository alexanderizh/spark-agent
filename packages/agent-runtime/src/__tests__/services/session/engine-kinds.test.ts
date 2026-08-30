import { describe, expect, it } from 'vitest'
import type { SessionPermissionMode } from '@spark/protocol'
import {
  getAgentAdapterFromSession,
  getPermissionModeFromSession,
  isCodexPermissionMode,
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
  it('3 值 adapter 穷尽映射到 2 值引擎', () => {
    expect(resolveEngineKind('claude')).toBe('claude-sdk')
    expect(resolveEngineKind('claude-sdk')).toBe('claude-sdk')
    expect(resolveEngineKind('codex')).toBe('codex')
  })
})

describe('isCodexPermissionMode', () => {
  it('codex 侧 3 个合法模式为 true', () => {
    for (const mode of ['codex-default', 'codex-auto-review', 'codex-full-access']) {
      expect(isCodexPermissionMode(mode)).toBe(true)
    }
  })

  it('claude 侧模式、空值与非法值为 false', () => {
    expect(isCodexPermissionMode('claude-ask')).toBe(false)
    expect(isCodexPermissionMode('claude-bypass')).toBe(false)
    expect(isCodexPermissionMode(null)).toBe(false)
    expect(isCodexPermissionMode(undefined)).toBe(false)
    expect(isCodexPermissionMode('')).toBe(false)
    expect(isCodexPermissionMode('codex-unknown-dirty')).toBe(false)
  })
})

describe('normalizePermissionMode', () => {
  it('8 个合法模式原样返回', () => {
    const modes: SessionPermissionMode[] = [
      'claude-ask',
      'claude-auto-edits',
      'claude-plan',
      'claude-auto',
      'claude-bypass',
      'codex-default',
      'codex-auto-review',
      'codex-full-access',
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
})

describe('normalizeAgentAdapter', () => {
  it('合法值归并、未知值回落 claude-sdk', () => {
    expect(normalizeAgentAdapter('claude')).toBe('claude-sdk')
    expect(normalizeAgentAdapter('claude-sdk')).toBe('claude-sdk')
    expect(normalizeAgentAdapter('codex')).toBe('codex')
    expect(normalizeAgentAdapter(null)).toBe('claude-sdk')
    expect(normalizeAgentAdapter('garbage')).toBe('claude-sdk')
  })
})

describe('getAgentAdapterFromSession / getPermissionModeFromSession（迁移回归锁定）', () => {
  it('adapter 解析优先级：显式值 > legacy chat_mode > providerType 推断', () => {
    expect(getAgentAdapterFromSession('claude-sdk', null, 'anthropic')).toBe('claude-sdk')
    expect(getAgentAdapterFromSession('claude', null, 'anthropic')).toBe('claude-sdk')
    expect(getAgentAdapterFromSession('codex', null, 'openai')).toBe('codex')
    expect(getAgentAdapterFromSession(null, 'codex', 'openai')).toBe('codex')
    expect(getAgentAdapterFromSession(null, null, 'anthropic')).toBe('claude-sdk')
    expect(getAgentAdapterFromSession(null, null, 'openai')).toBe('codex')
  })

  it('权限模式按 adapter 侧回落', () => {
    expect(getPermissionModeFromSession(null, 'codex')).toBe('codex-default')
    expect(getPermissionModeFromSession(null, 'claude-sdk')).toBe('claude-ask')
    expect(getPermissionModeFromSession('claude-auto', 'codex')).toBe('claude-auto')
  })
})
