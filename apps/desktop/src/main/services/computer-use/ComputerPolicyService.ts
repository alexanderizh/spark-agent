import type {
  ComputerActionEnvelope,
  ComputerAppIdentity,
  ComputerPolicyDecision,
  ComputerRiskLevel,
  ComputerTaskContract,
} from '@spark/protocol'
import { ComputerPolicyDecisionSchema } from '@spark/protocol'

const EFFECT_RISK: Record<ComputerActionEnvelope['policyContext']['effect'], ComputerRiskLevel> = {
  read_only: 'L0',
  reversible_local: 'L1',
  external_write: 'L2',
  high_impact: 'L3',
  restricted: 'L4',
}

const RISK_VALUE: Record<ComputerRiskLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
}

const ACTION_BASELINE_RISK: Record<ComputerActionEnvelope['action']['type'], ComputerRiskLevel> = {
  observe: 'L0',
  move: 'L0',
  scroll: 'L0',
  wait_for: 'L0',
  focus_window: 'L1',
  select_text: 'L1',
  set_value: 'L1',
  type_text: 'L1',
  invoke_element: 'L1',
  click: 'L1',
  drag: 'L1',
  keypress: 'L1',
  app_command: 'L1',
}

export class ComputerPolicyService {
  evaluate(
    envelope: ComputerActionEnvelope,
    _taskContract: ComputerTaskContract,
    observedApp: ComputerAppIdentity = {
      id: envelope.targetAppId,
      name: envelope.targetAppId,
    },
  ): ComputerPolicyDecision {
    if (observedApp.id !== envelope.targetAppId) {
      return decision(envelope.actionId, 'L1', 'deny', 'focus_mismatch', false)
    }
    let riskLevel = maxRisk(
      EFFECT_RISK[envelope.policyContext.effect],
      actionBaselineRisk(envelope.action),
    )
    if (envelope.policyContext.target.kind === 'unknown') {
      riskLevel = maxRisk(riskLevel, 'L2')
    }
    if (isSensitiveTextWrite(envelope.action)) {
      riskLevel = maxRisk(
        riskLevel,
        envelope.policyContext.dataClasses.includes('credential') ? 'L4' : 'L2',
      )
    }
    if (
      isLocalTextWrite(envelope.action) &&
      envelope.policyContext.dataClasses.some((dataClass) => dataClass !== 'public')
    ) {
      riskLevel = maxRisk(riskLevel, 'L2')
    }

    return decision(
      envelope.actionId,
      riskLevel,
      'allow',
      riskLevel === 'L0' ? 'read_only_action' : 'within_task_scope',
      false,
    )
  }
}

function isLocalTextWrite(action: ComputerActionEnvelope['action']): boolean {
  return (
    action.type === 'type_text' ||
    action.type === 'set_value' ||
    (action.type === 'app_command' && action.command.name === 'prefill_composer')
  )
}

function isSensitiveTextWrite(action: ComputerActionEnvelope['action']): boolean {
  if (action.type === 'type_text' || action.type === 'set_value') return action.sensitive === true
  return (
    action.type === 'app_command' &&
    action.command.name === 'prefill_composer' &&
    action.command.sensitive === true
  )
}

function actionBaselineRisk(action: ComputerActionEnvelope['action']): ComputerRiskLevel {
  if (action.type === 'invoke_element' && action.action != null && action.action !== 'invoke') {
    return 'L1'
  }
  return ACTION_BASELINE_RISK[action.type]
}

function maxRisk(left: ComputerRiskLevel, right: ComputerRiskLevel): ComputerRiskLevel {
  return RISK_VALUE[left] >= RISK_VALUE[right] ? left : right
}

function decision(
  actionId: string,
  riskLevel: ComputerRiskLevel,
  value: ComputerPolicyDecision['decision'],
  reasonCode: ComputerPolicyDecision['reasonCode'],
  requiresUserPresence: boolean,
): ComputerPolicyDecision {
  return ComputerPolicyDecisionSchema.parse({
    actionId,
    riskLevel,
    decision: value,
    reasonCode,
    requiresUserPresence,
  })
}
