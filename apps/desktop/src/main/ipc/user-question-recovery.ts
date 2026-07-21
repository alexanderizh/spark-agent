import type { AgentEvent, SessionAttachment, UserQuestionRequest } from '@spark/protocol'

function printableAnswer(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(printableAnswer).filter(Boolean).join(', ')
  if (value == null || typeof value !== 'object') return ''

  const item = value as Record<string, unknown>
  for (const key of ['answer', 'text', 'otherText', 'selectedLabel', 'selectedValue']) {
    const answer = printableAnswer(item[key])
    if (answer.length > 0) return answer
  }
  for (const key of ['selectedLabels', 'selectedValues', 'values']) {
    const answer = printableAnswer(item[key])
    if (answer.length > 0) return answer
  }
  if (item.skipped === true) return '用户选择跳过'
  return ''
}

function answerForQuestion(answers: Record<string, unknown>, index: number): string {
  const list = Array.isArray(answers.answers) ? answers.answers : []
  return printableAnswer(list[index]) || '（用户未提供具体答案）'
}

/** Build a normal user turn when the original SDK control stream can no longer accept the reply. */
export function buildDetachedQuestionContinuationMessage(
  request: UserQuestionRequest,
  answers: Record<string, unknown>,
): string {
  const pairs = request.questions.flatMap((question, index) => [
    `${index + 1}. 问题：${question.question}`,
    `   用户回答：${answerForQuestion(answers, index)}`,
  ])
  return [
    '[结构化问答续接]',
    '上一轮 Agent 提问后，SDK 控制流已经关闭。以下是原问题与用户刚提交的回答。',
    '请把这些回答视为对上一轮问题的正式回复，从中断处继续原任务；不要重复提问。',
    '',
    ...pairs,
  ].join('\n')
}

export function recoverDetachedQuestionAttachments(
  events: AgentEvent[],
  sourceTurnId?: string,
): SessionAttachment[] | undefined {
  const byNewest = [...events].sort((a, b) => b.seq - a.seq)
  const sourceEvents =
    sourceTurnId != null ? byNewest.filter((event) => event.turnId === sourceTurnId) : []
  const exact = recoverAttachmentsFromEvents(sourceEvents)
  if (exact != null) return exact
  return recoverAttachmentsFromEvents(byNewest)
}

function recoverAttachmentsFromEvents(events: AgentEvent[]): SessionAttachment[] | undefined {
  for (const event of events) {
    if (event.type === 'user_message') {
      const attachments = normalizeAttachments(event.attachments)
      if (attachments != null) return attachments
    }
    if (event.type === 'turn_prompt_snapshot') {
      const attachments = parseAttachmentLedger(event.userMessage)
      if (attachments != null) return attachments
    }
  }
  return undefined
}

function normalizeAttachments(
  attachments:
    | Array<{
        type: 'image' | 'file' | 'directory'
        path: string
      }>
    | undefined,
): SessionAttachment[] | undefined {
  if (attachments == null || attachments.length === 0) return undefined
  const seen = new Set<string>()
  const normalized: SessionAttachment[] = []
  for (const attachment of attachments) {
    const path = attachment.path.trim()
    if (path.length === 0 || seen.has(path)) continue
    seen.add(path)
    normalized.push({ type: attachment.type, path })
  }
  return normalized.length > 0 ? normalized : undefined
}

function parseAttachmentLedger(userMessage: string): SessionAttachment[] | undefined {
  const attachments: SessionAttachment[] = []
  const seen = new Set<string>()
  for (const line of userMessage.split(/\r?\n/)) {
    const match = line.match(/^\d+\.\s+(image|file|directory):\s+.+\s+\((.+)\)$/)
    if (match == null) continue
    const type = match[1] as SessionAttachment['type']
    const path = match[2]?.trim() ?? ''
    if (path.length === 0 || seen.has(path)) continue
    seen.add(path)
    attachments.push({ type, path })
  }
  return attachments.length > 0 ? attachments : undefined
}
