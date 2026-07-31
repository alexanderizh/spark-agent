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
  private readonly dynamicallyObservedApps = new Map<string, Set<string>>()

  evaluate(
    envelope: ComputerActionEnvelope,
    taskContract: ComputerTaskContract,
    observedApp: ComputerAppIdentity = {
      id: envelope.targetAppId,
      name: envelope.targetAppId,
    },
  ): ComputerPolicyDecision {
    if (observedApp.id !== envelope.targetAppId) {
      return decision(envelope.actionId, 'L1', 'deny', 'app_not_allowed', false)
    }
    const dynamicAppKey = appIdentityKey(observedApp)
    const previouslyObserved = this.dynamicallyObservedApps
      .get(envelope.computerSessionId)
      ?.has(dynamicAppKey)
    const newlyObservedApp =
      !previouslyObserved &&
      !taskContract.allowedApps.some((rule) => appRuleMatches(rule, observedApp))

    if (
      envelope.policyContext.target.kind === 'domain' &&
      !taskContract.allowedDomains.some((rule) =>
        domainMatches(envelope.policyContext.target.id, rule),
      )
    ) {
      return decision(envelope.actionId, 'L1', 'deny', 'domain_not_allowed', false)
    }

    if (taskContract.forbiddenActions.includes(envelope.action.type)) {
      return decision(envelope.actionId, 'L1', 'deny', 'action_not_allowed', false)
    }

    const allowedDataClasses = new Set(taskContract.allowedDataClasses)
    if (envelope.policyContext.dataClasses.some((item) => !allowedDataClasses.has(item))) {
      return decision(envelope.actionId, 'L2', 'deny', 'sensitive_input_blocked', false)
    }

    let riskLevel = maxRisk(
      EFFECT_RISK[envelope.policyContext.effect],
      actionBaselineRisk(envelope.action),
    )
    if (envelope.policyContext.target.kind === 'unknown') {
      riskLevel = maxRisk(riskLevel, 'L2')
    }
    if (newlyObservedApp) {
      // A task may legitimately open a new application after its initial window inventory.
      // Elevate only its first action; subsequent navigation in that live identity stays
      // low-friction, while committing actions remain governed by their effect/data risk.
      riskLevel = maxRisk(riskLevel, 'L2')
    }
    if (
      (envelope.action.type === 'type_text' || envelope.action.type === 'set_value') &&
      envelope.action.sensitive === true
    ) {
      riskLevel = maxRisk(
        riskLevel,
        envelope.policyContext.dataClasses.includes('credential') ? 'L4' : 'L2',
      )
    }
    if (
      (envelope.action.type === 'type_text' || envelope.action.type === 'set_value') &&
      envelope.policyContext.dataClasses.some((dataClass) => dataClass !== 'public')
    ) {
      riskLevel = maxRisk(riskLevel, 'L2')
    }

    if (riskLevel === 'L4') {
      return decision(envelope.actionId, riskLevel, 'require_handoff', 'handoff_required', true)
    }
    if ((riskLevel === 'L2' || riskLevel === 'L3') && taskContract.userPresence === 'unattended') {
      return decision(envelope.actionId, riskLevel, 'require_handoff', 'handoff_required', true)
    }
    if (riskLevel === 'L2' || riskLevel === 'L3') {
      return decision(envelope.actionId, riskLevel, 'require_approval', 'approval_required', true)
    }
    return decision(
      envelope.actionId,
      riskLevel,
      'allow',
      riskLevel === 'L0' ? 'read_only_action' : 'within_task_scope',
      false,
    )
  }

  markAppObservedByExecutedAction(computerSessionId: string, app: ComputerAppIdentity): void {
    const apps = this.dynamicallyObservedApps.get(computerSessionId) ?? new Set<string>()
    apps.add(appIdentityKey(app))
    while (apps.size > 200) {
      const oldest = apps.values().next().value
      if (oldest == null) break
      apps.delete(oldest)
    }
    this.dynamicallyObservedApps.delete(computerSessionId)
    this.dynamicallyObservedApps.set(computerSessionId, apps)
    while (this.dynamicallyObservedApps.size > 1_000) {
      const oldest = this.dynamicallyObservedApps.keys().next().value
      if (oldest == null) break
      this.dynamicallyObservedApps.delete(oldest)
    }
  }
}

function appIdentityKey(app: ComputerAppIdentity): string {
  return [app.id, app.bundleId ?? '', app.executableIdentity ?? '', app.signingIdentity ?? ''].join(
    '\u0000',
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

function domainMatches(hostInput: string, ruleInput: string): boolean {
  const host = hostInput.toLowerCase()
  const rule = ruleInput.toLowerCase()
  if (!rule.startsWith('*.')) return host === rule
  const suffix = rule.slice(2)
  return host !== suffix && host.endsWith(`.${suffix}`)
}

function appRuleMatches(
  rule: ComputerTaskContract['allowedApps'][number],
  app: ComputerAppIdentity,
): boolean {
  switch (rule.kind) {
    case 'app_id':
      return app.id === rule.value
    case 'bundle_id':
      return app.bundleId === rule.value
    case 'executable_identity':
      return app.executableIdentity === rule.value
    case 'signing_identity':
      return app.signingIdentity === rule.value
  }
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
