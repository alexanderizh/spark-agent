import type {
  BridgeInteractions,
  BridgeQuestionOption,
  BridgeQuestionPrompt,
} from '../../mobile/src/utils/chat-interactions'

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

function text(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function flag(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function readPrompt(value: unknown): BridgeQuestionPrompt | undefined {
  const item = record(value)
  if (!item || typeof item.question !== 'string') return undefined
  const { type } = item
  const options: BridgeQuestionOption[] | undefined = Array.isArray(item.options)
    ? item.options.flatMap((value: unknown) => {
        const option = record(value)
        if (!option || typeof option.label !== 'string') return []
        return [
          {
            label: option.label,
            description: text(option.description),
            value: text(option.value),
            allowsFreeText: flag(option.allowsFreeText),
            freeTextPlaceholder: text(option.freeTextPlaceholder),
          },
        ]
      })
    : undefined
  return {
    id: text(item.id),
    question: item.question,
    header: text(item.header) ?? '',
    type: type === 'single_choice' || type === 'multi_choice' || type === 'text' ? type : undefined,
    required: flag(item.required),
    placeholder: text(item.placeholder),
    multiline: flag(item.multiline),
    allowSkip: flag(item.allowSkip),
    allowOther: flag(item.allowOther),
    otherOptionLabel: text(item.otherOptionLabel),
    otherPlaceholder: text(item.otherPlaceholder),
    multiSelect: flag(item.multiSelect),
    options,
  }
}

export function readInteractions(value: unknown, sessionId: string): BridgeInteractions {
  const body = record(value)
  if (!Array.isArray(body?.approvals) || !Array.isArray(body.questions)) {
    throw new Error('挂起交互格式异常')
  }
  const approvals = body.approvals.flatMap((value: unknown): BridgeInteractions['approvals'] => {
    const item = record(value)
    if (
      !item ||
      item.sessionId !== sessionId ||
      typeof item.requestId !== 'string' ||
      !item.requestId
    )
      return []
    const { riskLevel } = item
    return [
      {
        sessionId,
        requestId: item.requestId,
        toolName: text(item.toolName) || '工具',
        action: text(item.action) || '请求授权',
        riskLevel: riskLevel === 'low' || riskLevel === 'medium' ? riskLevel : 'high',
        toolInput: record(item.toolInput) ?? {},
        defaultToNo: flag(item.defaultToNo),
        createdAt: text(item.createdAt) || '',
      },
    ]
  })
  const questions = body.questions.flatMap((value: unknown): BridgeInteractions['questions'] => {
    const item = record(value)
    if (
      !item ||
      item.sessionId !== sessionId ||
      typeof item.questionId !== 'string' ||
      !item.questionId ||
      !Array.isArray(item.questions) ||
      !item.questions.length
    )
      return []
    const prompts = item.questions.map(readPrompt)
    // Preserve original prompt indexes or reject the whole card.
    if (prompts.some((prompt) => prompt == null)) return []
    return [
      {
        sessionId,
        questionId: item.questionId,
        questions: prompts.filter((prompt) => prompt != null),
        createdAt: text(item.createdAt) || '',
      },
    ]
  })
  return { approvals, questions }
}
