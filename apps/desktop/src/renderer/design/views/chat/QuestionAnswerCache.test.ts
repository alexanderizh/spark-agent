import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserQuestionPrompt } from '@spark/protocol'

const questions: UserQuestionPrompt[] = [
  { id: 'q1', header: '开发节奏', question: '选择开发节奏', type: 'text' },
  { id: 'q2', header: '继续执行', question: '是否继续', type: 'text', allowSkip: true },
]

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('QuestionAnswerCache', () => {
  it('builds summaries for answered and skipped questions', async () => {
    const { buildQuestionAnswerSummaries } = await import('./QuestionAnswerCache')

    expect(
      buildQuestionAnswerSummaries(questions, {
        answers: [
          { question: questions[0]?.question, answer: '小步提交' },
          { question: questions[1]?.question, answer: '', skipped: true },
        ],
      }),
    ).toEqual([
      { question: '选择开发节奏', answer: '小步提交' },
      { question: '是否继续', answer: '', skipped: true },
    ])
  })

  it('restores persisted summaries after the module cache is recreated', async () => {
    const firstModule = await import('./QuestionAnswerCache')
    const cacheKey = firstModule.getQuestionAnswerCacheKey(questions, 'session-1')
    const summaries = [{ question: '选择开发节奏', answer: '小步提交' }]

    firstModule.persistQuestionAnswerSummaries(cacheKey, summaries)
    vi.resetModules()

    const reloadedModule = await import('./QuestionAnswerCache')
    expect(reloadedModule.readPersistedQuestionAnswerSummaries(cacheKey)).toEqual(summaries)
  })
})
