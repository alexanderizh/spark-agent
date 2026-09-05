import type { ComputerAction, ComputerObservation, ComputerPolicyContext } from '@spark/protocol'

/**
 * Derives the policy context for an action envelope. Shared by the task
 * operator loop and the atomic agent tools so both decision paths are gated
 * by identical risk semantics.
 */
export function policyContextFor(
  action: ComputerAction,
  observation: ComputerObservation,
  intent: string,
): ComputerPolicyContext {
  const elementId =
    'elementId' in action && typeof action.elementId === 'string' ? action.elementId : null
  const readOnly =
    action.type === 'observe' ||
    action.type === 'move' ||
    action.type === 'scroll' ||
    action.type === 'wait_for'
  const appPrefill = action.type === 'app_command' && action.command.name === 'prefill_composer'
  const localWrite = action.type === 'type_text' || action.type === 'set_value' || appPrefill
  const committingIntent =
    /\b(send|submit|publish|post|purchase|buy|pay|delete|remove|confirm|book|order)\b|发送|提交|发布|购买|支付|删除|确认|预订|下单/iu.test(
      intent,
    )
  const reversibleLocal =
    localWrite ||
    action.type === 'app_command' ||
    action.type === 'focus_window' ||
    action.type === 'select_text' ||
    action.type === 'click' ||
    action.type === 'drag' ||
    action.type === 'keypress' ||
    (action.type === 'invoke_element' && action.action != null && action.action !== 'invoke')
  const sensitive =
    action.type === 'type_text' || action.type === 'set_value'
      ? action.sensitive === true
      : action.type === 'app_command' &&
        action.command.name === 'prefill_composer' &&
        action.command.sensitive === true
  return {
    effect: readOnly
      ? 'read_only'
      : committingIntent
        ? 'external_write'
        : reversibleLocal
          ? 'reversible_local'
          : 'external_write',
    target: elementId
      ? { kind: 'element', id: elementId }
      : { kind: 'window', id: observation.foreground.window.id },
    dataClasses: localWrite ? (sensitive ? ['credential'] : ['public']) : [],
  }
}
