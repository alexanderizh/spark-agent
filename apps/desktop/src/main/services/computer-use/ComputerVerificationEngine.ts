import type {
  ComputerElementRef,
  ComputerObservation,
  NativeWindowDescriptor,
  VerificationSpec,
} from '@spark/protocol'

export interface ComputerVerificationResult {
  passed: boolean
  reason:
    | 'assertion_passed'
    | 'assertion_failed'
    | 'unsupported_evidence'
    | 'model_visual_assertion'
  snapshotId: string
}

export class ComputerVerificationEngine {
  verify(
    criteria: VerificationSpec[],
    observation: ComputerObservation,
    evidence: {
      windows?: NativeWindowDescriptor[]
      visualText?: string
      modelVisualApproval?: boolean
    } = {},
  ): { passed: boolean; results: ComputerVerificationResult[] } {
    const results = criteria.map((criterion) => verifyCriterion(criterion, observation, evidence))
    return { passed: results.length > 0 && results.every((result) => result.passed), results }
  }
}

function verifyCriterion(
  criterion: VerificationSpec,
  observation: ComputerObservation,
  evidence: {
    windows?: NativeWindowDescriptor[]
    visualText?: string
    modelVisualApproval?: boolean
  },
): ComputerVerificationResult {
  let passed: boolean | null = null
  if (criterion.kind === 'accessibility') {
    passed = verifyElementAssertion(
      observation.elements.filter((element) => selectorMatches(criterion.selector, element)),
      criterion.assertion,
    )
  } else if (criterion.kind === 'visual') {
    const currentText =
      evidence.visualText ??
      (observation.tree.mode === 'full'
        ? `${observation.tree.text}\n${accessibleText(observation.elements)}`
        : null)
    if (criterion.assertion.operator === 'text_present') {
      passed = currentText?.includes(criterion.assertion.expected) ?? null
    } else if (criterion.assertion.operator === 'text_absent') {
      passed = currentText == null ? null : !currentText.includes(criterion.assertion.expected)
    }
    const hasAccessibilityEvidence =
      !observation.treeVersion.startsWith('visual-') &&
      (observation.elements.length > 0 ||
        !['', '[]', '{"changed":[],"removed":[]}'].includes(observation.tree.text.trim()))
    if (passed !== true && evidence.modelVisualApproval === true && !hasAccessibilityEvidence) {
      return {
        passed: true,
        reason: 'model_visual_assertion',
        snapshotId: observation.screenshot.snapshotId,
      }
    }
  } else if (criterion.kind === 'application_state') {
    const appMatches = observation.foreground.app.id === criterion.appId
    switch (criterion.assertion.operator) {
      case 'running':
      case 'frontmost':
      case 'window_exists': {
        if (typeof criterion.assertion.expected !== 'boolean') break
        if (criterion.assertion.operator === 'frontmost') {
          passed = appMatches === criterion.assertion.expected
          break
        }
        if (evidence.windows == null) break
        const matchingWindowExists = evidence.windows.some(
          (window) => window.app.id === criterion.appId,
        )
        if (criterion.assertion.operator === 'running') {
          // A window proves the process is running, but no window cannot prove process absence.
          passed = criterion.assertion.expected
            ? matchingWindowExists
            : matchingWindowExists
              ? false
              : null
        } else {
          passed = matchingWindowExists === criterion.assertion.expected
        }
        break
      }
      case 'window_title_contains':
        if (typeof criterion.assertion.expected !== 'string') break
        passed =
          evidence.windows?.some(
            (window) =>
              window.app.id === criterion.appId &&
              window.window.title.includes(criterion.assertion.expected as string),
          ) ??
          (appMatches && observation.foreground.window.title.includes(criterion.assertion.expected))
        break
    }
  }
  return {
    passed: passed === true,
    reason:
      passed == null ? 'unsupported_evidence' : passed ? 'assertion_passed' : 'assertion_failed',
    snapshotId: observation.screenshot.snapshotId,
  }
}

function accessibleText(elements: ComputerElementRef[]): string {
  return elements.map((element) => `${element.name}\n${element.value ?? ''}`).join('\n')
}

function selectorMatches(
  selector: Extract<VerificationSpec, { kind: 'accessibility' }>['selector'],
  element: ComputerElementRef,
): boolean {
  return (
    (selector.elementId == null || selector.elementId === element.id) &&
    (selector.role == null || selector.role === element.role) &&
    (selector.name == null || selector.name === element.name)
  )
}

function verifyElementAssertion(
  elements: ComputerElementRef[],
  assertion: Extract<VerificationSpec, { kind: 'accessibility' }>['assertion'],
): boolean {
  const first = elements[0]
  switch (assertion.operator) {
    case 'exists':
      return (first != null) === assertion.expected
    case 'visible':
      return (
        (first != null && first.bounds.width > 0 && first.bounds.height > 0) === assertion.expected
      )
    case 'enabled':
      return (first?.enabled ?? false) === assertion.expected
    case 'focused':
      return (first?.focused ?? false) === assertion.expected
    case 'value_equals':
      return first?.value === assertion.expected
    case 'text_contains':
      return first != null && `${first.name}\n${first.value ?? ''}`.includes(assertion.expected)
  }
}
