import type { ComputerActionEnvelope, ComputerTaskContract } from '@spark/protocol'
import { describe, expect, it } from 'vitest'
import { ComputerPolicyService } from './ComputerPolicyService.js'

const taskContract: ComputerTaskContract = {
  objective: 'Edit the approved document',
  successCriteria: [
    {
      kind: 'accessibility',
      selector: { elementId: 'document-editor' },
      assertion: { operator: 'text_contains', expected: 'Approved' },
    },
  ],
  allowedApps: [{ kind: 'app_id', value: 'com.spark.Editor' }],
  allowedDomains: [],
  allowedDataClasses: ['public', 'internal'],
  forbiddenActions: [],
  maxSteps: 20,
  maxRuntimeMs: 60_000,
  maxConsecutiveNoops: 3,
  userPresence: 'required',
}

function envelope(overrides: Partial<ComputerActionEnvelope> = {}): ComputerActionEnvelope {
  return {
    computerSessionId: 'computer-session-1',
    actionId: 'action-1',
    actuatorLeaseId: 'lease-1',
    observedFrameId: 'frame-1',
    observedTreeVersion: 'tree-1',
    targetAppId: 'com.spark.Editor',
    targetWindowId: 'window-1',
    action: { type: 'scroll', deltaX: 0, deltaY: 200 },
    policyContext: {
      effect: 'read_only',
      target: { kind: 'element', id: 'document-editor' },
      dataClasses: [],
    },
    intent: 'Read more of the approved document',
    ...overrides,
  }
}

describe('ComputerPolicyService', () => {
  const policy = new ComputerPolicyService()

  it('allows read-only and reversible local actions within the task contract', () => {
    expect(policy.evaluate(envelope(), taskContract)).toMatchObject({
      riskLevel: 'L0',
      decision: 'allow',
      reasonCode: 'read_only_action',
      requiresUserPresence: false,
    })

    expect(
      policy.evaluate(
        envelope({
          policyContext: {
            effect: 'reversible_local',
            target: { kind: 'element', id: 'draft-body' },
            dataClasses: ['internal'],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({
      riskLevel: 'L1',
      decision: 'allow',
      reasonCode: 'within_task_scope',
    })

    expect(
      policy.evaluate(
        envelope({
          action: { type: 'app_command', command: { name: 'navigate', view: 'settings' } },
          policyContext: {
            effect: 'reversible_local',
            target: { kind: 'window', id: 'window-1' },
            dataClasses: [],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({ riskLevel: 'L1', decision: 'allow' })
  })

  it('allows external writes and high-impact actions without per-action approval', () => {
    expect(
      policy.evaluate(
        envelope({
          policyContext: {
            effect: 'external_write',
            target: { kind: 'recipient', id: 'recipient-alice' },
            dataClasses: ['internal'],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({ riskLevel: 'L2', decision: 'allow', requiresUserPresence: false })

    expect(
      policy.evaluate(
        envelope({
          policyContext: {
            effect: 'high_impact',
            target: { kind: 'system_setting', id: 'network-proxy' },
            dataClasses: [],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({
      riskLevel: 'L3',
      decision: 'allow',
      requiresUserPresence: false,
    })
  })

  it('allows unattended, restricted, and credential actions after task-level authorization', () => {
    const unattended = { ...taskContract, userPresence: 'unattended' } as const
    expect(
      policy.evaluate(
        envelope({
          policyContext: {
            effect: 'external_write',
            target: { kind: 'recipient', id: 'recipient-alice' },
            dataClasses: ['internal'],
          },
        }),
        unattended,
      ),
    ).toMatchObject({ riskLevel: 'L2', decision: 'allow', requiresUserPresence: false })

    expect(
      policy.evaluate(
        envelope({
          policyContext: {
            effect: 'restricted',
            target: { kind: 'account', id: 'primary-account' },
            dataClasses: [],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({ riskLevel: 'L4', decision: 'allow', requiresUserPresence: false })

    expect(
      policy.evaluate(
        envelope({
          action: { type: 'type_text', text: 'secret', sensitive: true },
          policyContext: {
            effect: 'reversible_local',
            target: { kind: 'account', id: 'primary-account' },
            dataClasses: ['credential'],
          },
        }),
        { ...taskContract, allowedDataClasses: [...taskContract.allowedDataClasses, 'credential'] },
      ),
    ).toMatchObject({ riskLevel: 'L4', decision: 'allow', requiresUserPresence: false })

    expect(
      policy.evaluate(
        envelope({
          action: {
            type: 'app_command',
            command: { name: 'prefill_composer', text: 'secret', sensitive: true },
          },
          policyContext: {
            effect: 'reversible_local',
            target: { kind: 'window', id: 'window-1' },
            dataClasses: ['credential'],
          },
        }),
        { ...taskContract, allowedDataClasses: [...taskContract.allowedDataClasses, 'credential'] },
      ),
    ).toMatchObject({ riskLevel: 'L4', decision: 'allow', requiresUserPresence: false })
  })

  it('allows every matching foreground application and ignores legacy scope restrictions', () => {
    expect(
      policy.evaluate(envelope({ targetAppId: 'com.unapproved.App' }), taskContract),
    ).toMatchObject({ decision: 'allow', reasonCode: 'read_only_action' })
    expect(
      policy.evaluate(
        envelope({ actionId: 'action-2', targetAppId: 'com.unapproved.App' }),
        taskContract,
      ),
    ).toMatchObject({ decision: 'allow', reasonCode: 'read_only_action' })

    expect(
      policy.evaluate(envelope({ targetAppId: 'com.unapproved.App' }), taskContract, {
        id: 'com.different.App',
        name: 'Different App',
      }),
    ).toMatchObject({ decision: 'deny', reasonCode: 'focus_mismatch' })

    expect(
      policy.evaluate(envelope(), { ...taskContract, forbiddenActions: ['scroll'] }),
    ).toMatchObject({ decision: 'allow' })

    expect(
      policy.evaluate(
        envelope({
          policyContext: {
            effect: 'reversible_local',
            target: { kind: 'element', id: 'health-record' },
            dataClasses: ['health'],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({ decision: 'allow' })
  })

  it('records an unknown target as elevated risk without blocking execution', () => {
    expect(
      policy.evaluate(
        envelope({
          policyContext: {
            effect: 'reversible_local',
            target: { kind: 'unknown', id: 'unclassified-target' },
            dataClasses: [],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({ riskLevel: 'L2', decision: 'allow' })
  })

  it('allows reversible pointer navigation while preserving elevated data risk', () => {
    expect(
      policy.evaluate(
        envelope({
          action: { type: 'click', point: { x: 0.5, y: 0.5 } },
          policyContext: {
            effect: 'reversible_local',
            target: { kind: 'element', id: 'submit-button' },
            dataClasses: [],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({ riskLevel: 'L1', decision: 'allow' })

    expect(
      policy.evaluate(
        envelope({
          action: { type: 'invoke_element', elementId: 'submit-button' },
          policyContext: {
            effect: 'read_only',
            target: { kind: 'element', id: 'submit-button' },
            dataClasses: [],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({ riskLevel: 'L1', decision: 'allow' })

    expect(
      policy.evaluate(
        envelope({
          action: { type: 'type_text', text: 'internal project details' },
          policyContext: {
            effect: 'reversible_local',
            target: { kind: 'element', id: 'message-body' },
            dataClasses: ['internal'],
          },
        }),
        taskContract,
      ),
    ).toMatchObject({ riskLevel: 'L2', decision: 'allow' })
  })

  it('allows only explicitly non-committing semantic navigation without per-action approval', () => {
    for (const action of ['focus', 'expand', 'collapse', 'select'] as const) {
      expect(
        policy.evaluate(
          envelope({
            action: { type: 'invoke_element', elementId: 'navigation-item', action },
            policyContext: {
              effect: 'reversible_local',
              target: { kind: 'element', id: 'navigation-item' },
              dataClasses: [],
            },
          }),
          taskContract,
        ),
      ).toMatchObject({ riskLevel: 'L1', decision: 'allow' })
    }
  })

  it('ignores legacy domain scopes for direct desktop execution', () => {
    const domainAction = envelope({
      policyContext: {
        effect: 'read_only',
        target: { kind: 'domain', id: 'api.example.com' },
        dataClasses: [],
      },
    })

    expect(policy.evaluate(domainAction, taskContract)).toMatchObject({
      decision: 'allow',
    })
    expect(
      policy.evaluate(domainAction, { ...taskContract, allowedDomains: ['*.example.com'] }),
    ).toMatchObject({ decision: 'allow' })
    expect(
      policy.evaluate(
        {
          ...domainAction,
          policyContext: {
            ...domainAction.policyContext,
            target: { kind: 'domain', id: 'example.com' },
          },
        },
        { ...taskContract, allowedDomains: ['*.example.com'] },
      ),
    ).toMatchObject({ decision: 'allow' })
  })

  it('ignores legacy application allowlist entries', () => {
    const signingContract: ComputerTaskContract = {
      ...taskContract,
      allowedApps: [{ kind: 'signing_identity', value: 'trusted-signer:editor' }],
    }

    expect(policy.evaluate(envelope(), signingContract)).toMatchObject({
      decision: 'allow',
      reasonCode: 'read_only_action',
    })
    expect(
      policy.evaluate(envelope(), signingContract, {
        id: 'com.spark.Editor',
        name: 'Spark Editor',
        signingIdentity: 'trusted-signer:editor',
      }),
    ).toMatchObject({ decision: 'allow' })
  })
})
