import type { UserQuestionRequest } from '@spark/protocol'

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
