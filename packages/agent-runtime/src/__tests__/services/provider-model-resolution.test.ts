import { describe, expect, it } from 'vitest'
import {
  getAgentAdapterFromSession,
  getPermissionModeFromSession,
  isSdkResumeSafe,
  makeSdkRuntimeSessionId,
} from '../../services/session.service.js'

describe('Provider/Model resolution regression', () => {
  // ── getAgentAdapterFromSession ──────────────────────────────────────────

  describe('getAgentAdapterFromSession', () => {
    it('returns claude-sdk for explicit claude-sdk value', () => {
      expect(getAgentAdapterFromSession('claude-sdk', null, 'anthropic')).toBe('claude-sdk')
    })

    it('returns codex for explicit codex value', () => {
      expect(getAgentAdapterFromSession('codex', null, 'openai')).toBe('codex')
    })

    it('normalizes legacy claude to claude-sdk', () => {
      expect(getAgentAdapterFromSession('claude', null, 'anthropic')).toBe('claude-sdk')
    })

    it('falls back to claude-sdk when provider is anthropic and no adapter set', () => {
      expect(getAgentAdapterFromSession(null, null, 'anthropic')).toBe('claude-sdk')
      expect(getAgentAdapterFromSession(undefined, undefined, 'anthropic')).toBe('claude-sdk')
    })

    it('falls back to codex when provider is openai and no adapter set', () => {
      expect(getAgentAdapterFromSession(null, null, 'openai')).toBe('codex')
      expect(getAgentAdapterFromSession(undefined, undefined, 'openai')).toBe('codex')
    })

    it('falls back to codex when provider type is null', () => {
      expect(getAgentAdapterFromSession(null, null, null)).toBe('codex')
    })

    it('resolves from legacy chat_mode when adapter is null', () => {
      // chat_mode can carry adapter info from older sessions
      expect(getAgentAdapterFromSession(null, 'claude-sdk', 'openai')).toBe('claude-sdk')
      expect(getAgentAdapterFromSession(null, 'codex', 'anthropic')).toBe('codex')
      expect(getAgentAdapterFromSession(null, 'claude', 'anthropic')).toBe('claude-sdk')
    })

    it('adapter value takes precedence over chat_mode', () => {
      expect(getAgentAdapterFromSession('codex', 'claude-sdk', 'anthropic')).toBe('codex')
    })

    it('ignores invalid adapter values and falls back', () => {
      expect(getAgentAdapterFromSession('invalid-adapter', null, 'anthropic')).toBe('claude-sdk')
      expect(getAgentAdapterFromSession('invalid-adapter', null, 'openai')).toBe('codex')
    })
  })

  // ── getPermissionModeFromSession ────────────────────────────────────────

  describe('getPermissionModeFromSession', () => {
    it('passes through all 8 valid permission modes', () => {
      const validModes = [
        'claude-ask',
        'claude-auto-edits',
        'claude-plan',
        'claude-auto',
        'claude-bypass',
        'codex-default',
        'codex-auto-review',
        'codex-full-access',
      ] as const

      for (const mode of validModes) {
        expect(getPermissionModeFromSession(mode, 'claude-sdk')).toBe(mode)
      }
    })

    it('defaults to claude-ask for claude-sdk adapter with null value', () => {
      expect(getPermissionModeFromSession(null, 'claude-sdk')).toBe('claude-ask')
      expect(getPermissionModeFromSession(undefined, 'claude-sdk')).toBe('claude-ask')
    })

    it('defaults to codex-default for codex adapter with null value', () => {
      expect(getPermissionModeFromSession(null, 'codex')).toBe('codex-default')
      expect(getPermissionModeFromSession(undefined, 'codex')).toBe('codex-default')
    })

    it('defaults to claude-ask for claude adapter with invalid value', () => {
      expect(getPermissionModeFromSession('invalid-mode', 'claude-sdk')).toBe('claude-ask')
    })

    it('defaults to codex-default for codex adapter with invalid value', () => {
      expect(getPermissionModeFromSession('invalid-mode', 'codex')).toBe('codex-default')
    })

    it('claude modes work regardless of adapter', () => {
      // A codex adapter with claude-ask mode should preserve claude-ask
      expect(getPermissionModeFromSession('claude-ask', 'codex')).toBe('claude-ask')
    })

    it('codex modes work regardless of adapter', () => {
      // A claude-sdk adapter with codex-default should preserve codex-default
      expect(getPermissionModeFromSession('codex-default', 'claude-sdk')).toBe('codex-default')
    })
  })

  // ── makeSdkRuntimeSessionId ────────────────────────────────────────────

  describe('makeSdkRuntimeSessionId', () => {
    it('produces stable IDs when no turnId is provided', () => {
      const id1 = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'claude-sdk')
      const id2 = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'claude-sdk')
      expect(id1).toBe(id2)
    })

    it('produces unique IDs per turn when turnId differs', () => {
      const stable = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'claude-sdk')
      const turn1 = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'claude-sdk', 'turn-1')
      const turn2 = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'claude-sdk', 'turn-2')
      expect(turn1).not.toBe(stable)
      expect(turn2).not.toBe(stable)
      expect(turn1).not.toBe(turn2)
    })

    it('changes when provider profile changes', () => {
      const id1 = makeSdkRuntimeSessionId('sess-1', 'provider-a', 'claude-sonnet-4-5', 'claude-sdk')
      const id2 = makeSdkRuntimeSessionId('sess-1', 'provider-b', 'claude-sonnet-4-5', 'claude-sdk')
      expect(id1).not.toBe(id2)
    })

    it('changes when model changes', () => {
      const id1 = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'claude-sdk')
      const id2 = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-opus-4', 'claude-sdk')
      expect(id1).not.toBe(id2)
    })

    it('changes when adapter changes', () => {
      const id1 = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'claude-sdk')
      const id2 = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'codex')
      expect(id1).not.toBe(id2)
    })

    it('produces valid UUID format', () => {
      const id = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'model-1', 'claude-sdk')
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })

    it('same-adapter provider switch produces different SDK session ID', () => {
      // Switching from one anthropic profile to another changes the SDK session
      const anthropicProfileA = makeSdkRuntimeSessionId('sess-1', 'anthropic-a', 'claude-sonnet-4-5', 'claude-sdk')
      const anthropicProfileB = makeSdkRuntimeSessionId('sess-1', 'anthropic-b', 'claude-sonnet-4-5', 'claude-sdk')
      expect(anthropicProfileA).not.toBe(anthropicProfileB)
    })
  })

  // ── isSdkResumeSafe ────────────────────────────────────────────────────

  describe('isSdkResumeSafe', () => {
    it('returns false when feature flag is off (current state)', () => {
      // ENABLE_CLAUDE_SDK_RESUME is currently false
      expect(
        isSdkResumeSafe({
          providerType: 'anthropic',
          model: 'claude-sonnet-4-5',
          agentAdapter: 'claude-sdk',
        }),
      ).toBe(false)
    })

    it('returns false for non-claude adapters', () => {
      expect(
        isSdkResumeSafe({
          providerType: 'anthropic',
          model: 'claude-sonnet-4-5',
          agentAdapter: 'codex',
        }),
      ).toBe(false)
    })

    it('returns false for non-anthropic provider types', () => {
      expect(
        isSdkResumeSafe({
          providerType: 'openai',
          model: 'gpt-4o',
          agentAdapter: 'claude-sdk',
        }),
      ).toBe(false)
    })

    it('returns false for non-claude models', () => {
      expect(
        isSdkResumeSafe({
          providerType: 'anthropic',
          model: 'glm-5',
          agentAdapter: 'claude-sdk',
        }),
      ).toBe(false)
    })

    it('returns false for non-standard API endpoints', () => {
      expect(
        isSdkResumeSafe({
          providerType: 'anthropic',
          apiEndpoint: 'https://proxy.example.com/v1',
          model: 'claude-sonnet-4-5',
          agentAdapter: 'claude-sdk',
        }),
      ).toBe(false)
    })
  })

  // ── Cross-adapter switch scenarios ─────────────────────────────────────

  describe('cross-adapter switch scenarios', () => {
    it('switching from claude-sdk to codex changes adapter and SDK session ID', () => {
      const claudeSession = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'claude-sdk')
      const codexSession = makeSdkRuntimeSessionId('sess-1', 'provider-1', 'claude-sonnet-4-5', 'codex')

      expect(claudeSession).not.toBe(codexSession)
    })

    it('switching provider type within same session changes default adapter resolution', () => {
      // Before: anthropic provider → claude-sdk adapter
      const anthropicAdapter = getAgentAdapterFromSession(null, null, 'anthropic')
      expect(anthropicAdapter).toBe('claude-sdk')

      // After: openai provider → codex adapter
      const openaiAdapter = getAgentAdapterFromSession(null, null, 'openai')
      expect(openaiAdapter).toBe('codex')

      expect(anthropicAdapter).not.toBe(openaiAdapter)
    })

    it('switching adapter changes default permission mode', () => {
      const claudeMode = getPermissionModeFromSession(null, 'claude-sdk')
      const codexMode = getPermissionModeFromSession(null, 'codex')

      expect(claudeMode).toBe('claude-ask')
      expect(codexMode).toBe('codex-default')
      expect(claudeMode).not.toBe(codexMode)
    })

    it('preserves explicit permission mode across adapter switch', () => {
      // User explicitly set claude-auto-edits, then switched to codex adapter
      // The explicit mode should be preserved
      const mode = getPermissionModeFromSession('claude-auto-edits', 'codex')
      expect(mode).toBe('claude-auto-edits')
    })
  })
})
