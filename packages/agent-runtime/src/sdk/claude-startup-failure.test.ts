import { describe, expect, it } from 'vitest'
import {
  claudeStartupFailureErrorCode,
  describeClaudeStartupFailure,
  isSDKStartupFailureReason,
} from './claude-startup-failure.js'
import { mapSDKMessageToEvents } from './event-mapper.js'
import type { SDKResultMessage } from './types.js'

describe('claude startup failure diagnosis', () => {
  it('recognizes all 16 documented reasons', () => {
    const reasons = [
      'org_pin_api_key_conflict',
      'org_verify_failed',
      'org_pin_mismatch',
      'managed_settings_invalid',
      'remote_settings_required_unavailable',
      'gateway_signin_required',
      'gateway_access_denied',
      'proxy_invalid',
      'temp_dir_unusable',
      'cwd_unavailable',
      'shell_tool_missing',
      'session_held_by_background',
      'worktree_resume_refused',
      'worktree_unverified',
      'cli_version_too_old',
      'bypass_root',
    ] as const
    for (const reason of reasons) {
      expect(isSDKStartupFailureReason(reason)).toBe(true)
      const diagnosis = describeClaudeStartupFailure(reason)
      expect(diagnosis.title.length).toBeGreaterThan(0)
      expect(diagnosis.actionHint.length).toBeGreaterThan(0)
    }
  })

  it('rejects unknown values', () => {
    expect(isSDKStartupFailureReason('unknown')).toBe(false)
    expect(isSDKStartupFailureReason(undefined)).toBe(false)
    expect(isSDKStartupFailureReason(null)).toBe(false)
  })

  it('maps a startup-failure result to a structured agent_error', () => {
    const message = {
      type: 'result',
      subtype: 'error_during_execution',
      uuid: 'result-startup',
      session_id: 'sdk-session',
      duration_ms: 10,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      errors: ['startup failed'],
      startup_failure_reason: 'cli_version_too_old',
    } as SDKResultMessage
    const events = mapSDKMessageToEvents(message, {
      sessionId: 'session-1',
      turnId: 'turn-1',
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_error',
        code: 'CLAUDE_STARTUP_FAILED_CLI_VERSION_TOO_OLD',
        retryable: false,
        actionHint: expect.stringContaining('升级'),
      }),
    )
  })

  it('falls back to the default error path without a known reason', () => {
    const message = {
      type: 'result',
      subtype: 'error_during_execution',
      uuid: 'result-plain',
      session_id: 'sdk-session',
      duration_ms: 10,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      errors: ['boom'],
    } as SDKResultMessage
    const events = mapSDKMessageToEvents(message, {
      sessionId: 'session-1',
      turnId: 'turn-1',
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_error',
        code: 'ERROR_DURING_EXECUTION',
      }),
    )
  })

  it('builds stable error codes', () => {
    expect(claudeStartupFailureErrorCode('bypass_root')).toBe(
      'CLAUDE_STARTUP_FAILED_BYPASS_ROOT',
    )
  })
})
