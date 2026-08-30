import { describe, expect, it } from 'vitest'
import { resolveCodexPermissionPolicy } from '../../sdk/codex-permission-policy.js'

describe('resolveCodexPermissionPolicy', () => {
  it.each([
    ['codex-default', false, 'workspace-write', 'on-request', undefined],
    ['codex-default', true, 'workspace-write', 'never', undefined],
    ['codex-auto-review', false, 'workspace-write', 'on-request', 'auto_review'],
    ['codex-auto-review', true, 'workspace-write', 'on-request', 'auto_review'],
    ['codex-full-access', false, 'danger-full-access', 'never', undefined],
    ['codex-full-access', true, 'danger-full-access', 'never', undefined],
  ] as const)(
    'maps %s unattended=%s',
    (mode, unattended, sandboxMode, approvalPolicy, approvalsReviewer) => {
      expect(resolveCodexPermissionPolicy(mode, unattended)).toEqual({
        sandboxMode,
        approvalPolicy,
        ...(approvalsReviewer == null ? {} : { approvalsReviewer }),
      })
    },
  )

  it('uses the safe default for a non-Codex legacy mode', () => {
    expect(resolveCodexPermissionPolicy('claude-bypass', false)).toEqual({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    })
  })
})
