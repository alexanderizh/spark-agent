#!/usr/bin/env node
/**
 * 挂起交互（审批卡 + 问答卡）离线回归：
 *   - 审批入参预览提取（命令/文件路径优先，JSON 兜底截断）
 *   - 问答卡视图构建（单选/多选选中态、其他输入、就绪判定）
 *   - 应答载荷与桌面端 UserQuestionDock 同构（引擎归一依赖该形状）
 *   - 跳过载荷（未答题 skipped、已答题保留真实答案 + 顶层 reason）
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const iv = require(join(root, 'dist/utils/interaction-view.js'))

// ─── 审批预览 ─────────────────────────────────────────────────────────────────

assert.equal(iv.describeApprovalInput({ command: 'rm -rf /tmp/x', other: 1 }), 'rm -rf /tmp/x')
assert.equal(iv.describeApprovalInput({ file_path: '/a/b.txt' }), '/a/b.txt')
assert.equal(iv.describeApprovalInput({}), '')
const longJson = iv.describeApprovalInput({ data: 'x'.repeat(300) })
assert.ok(longJson.length <= 161 && longJson.endsWith('…'), '长 JSON 预览应截断')

const cards = iv.buildApprovalCardViews([
  {
    requestId: 'r2',
    sessionId: 's1',
    toolName: 'Bash',
    action: 'command_dangerous',
    riskLevel: 'high',
    toolInput: { command: 'sudo rm -rf /' },
    createdAt: '2026-10-16T01:00:00Z',
    defaultToNo: true,
  },
  {
    requestId: 'r1',
    sessionId: 's1',
    toolName: 'Write',
    action: 'file_write',
    riskLevel: 'medium',
    toolInput: { file_path: '/a/b.txt' },
    createdAt: '2026-10-16T00:00:00Z',
  },
])
assert.equal(cards.length, 2)
assert.equal(cards[0].requestId, 'r1', '按 createdAt 升序')
assert.equal(cards[0].actionLabel, '写入文件')
assert.equal(cards[0].preview, '/a/b.txt')
assert.equal(cards[0].caution, false)
assert.equal(cards[1].actionLabel, '执行高危命令')
assert.equal(cards[1].caution, true)

// ─── 问答视图 ─────────────────────────────────────────────────────────────────

const singleQuestion = {
  question: '用哪种方案？',
  header: '方案选择',
  type: 'single_choice',
  options: [
    { label: '方案A', description: '快' },
    { label: '方案B', description: '稳' },
  ],
  allowSkip: true,
}
const multiQuestion = {
  question: '带上哪些模块？',
  header: '范围',
  type: 'multi_choice',
  options: [{ label: '核心' }, { label: '文档' }],
  allowOther: true,
}
const textQuestion = {
  question: '补充说明',
  header: '备注',
  type: 'text',
  required: false,
  multiline: true,
  placeholder: '随便写点',
}

const item = {
  questionId: 'q1',
  sessionId: 's1',
  createdAt: '2026-10-16T00:00:00Z',
  questions: [singleQuestion, multiQuestion, textQuestion],
}
let views = iv.buildQuestionCardViews([item], {})
assert.equal(views.length, 1)
assert.equal(views[0].canSubmit, false, '未作答时不可提交')
assert.equal(views[0].allowSkip, true)
assert.equal(views[0].items[0].options[0].selected, false)
assert.equal(views[0].items[2].placeholder, '随便写点', '文本题透传 placeholder')

// 单选 + 其他输入
const key0 = iv.questionDraftKey('q1', 0)
const key1 = iv.questionDraftKey('q1', 1)
const key2 = iv.questionDraftKey('q1', 2)
let drafts = {
  [key0]: { ...iv.emptyQuestionDraft(), selectedLabels: ['方案B'], selectedValues: ['方案B'] },
  [key1]: { ...iv.emptyQuestionDraft(), selectedLabels: ['核心'], selectedValues: ['核心'] },
  [key2]: { ...iv.emptyQuestionDraft(), text: '没有补充' },
}
views = iv.buildQuestionCardViews([item], drafts)
assert.equal(views[0].canSubmit, true, '三题都已作答')
assert.equal(views[0].items[0].options[1].selected, true)

// 就绪判定：单选「其他」必须带文本
drafts = {
  [key0]: {
    ...iv.emptyQuestionDraft(),
    selectedLabels: ['其他'],
    selectedValues: ['其他'],
    otherText: '',
  },
}
assert.equal(
  iv.buildQuestionCardViews([item], drafts)[0].canSubmit,
  false,
  '选了其他但没输入文本 → 不可提交',
)

// ─── 应答载荷（与桌面端渲染端同构） ───────────────────────────────────────────

drafts = {
  [key0]: { ...iv.emptyQuestionDraft(), selectedLabels: ['方案A'], selectedValues: ['方案A'] },
  [key1]: {
    ...iv.emptyQuestionDraft(),
    selectedLabels: ['核心', '文档'],
    selectedValues: ['核心', '文档'],
    otherText: '示例',
  },
  [key2]: { ...iv.emptyQuestionDraft(), text: '好' },
}
const payload = iv.buildQuestionAnswerPayload(item.questions, drafts, 'q1')
assert.equal(payload.questionCount, 3)
assert.equal(payload.answeredCount, 3)
const [a0, a1, a2] = payload.answers
assert.deepEqual(
  { answer: a0.answer, optionLabel: a0.optionLabel, optionValue: a0.optionValue, type: a0.type },
  { answer: '方案A', optionLabel: '方案A', optionValue: '方案A', type: 'single_choice' },
)
assert.deepEqual(
  { answer: a1.answer, optionLabel: a1.optionLabel, optionValue: a1.optionValue, type: a1.type },
  {
    answer: '核心 | 文档 | 示例',
    // optionLabel/optionValue 只含预置选项（不含「其他」追加项），与桌面端 buildQuestionAnswer 一致
    optionLabel: '核心 | 文档',
    optionValue: '核心 | 文档',
    type: 'multi_choice',
  },
)
assert.deepEqual(
  { answer: a2.answer, text: a2.text, type: a2.type, skipped: a2.skipped },
  { answer: '好', text: '好', type: 'text', skipped: false },
)
assert.equal(a0.id, 'question-1')
assert.equal(a0.index, 0)
assert.equal(a0.header, '方案选择')

// 单选「其他」：答案取自由文本
drafts = {
  [key0]: {
    ...iv.emptyQuestionDraft(),
    selectedLabels: ['其他'],
    selectedValues: ['其他'],
    otherText: '自定义方案',
  },
}
const otherPayload = iv.buildQuestionAnswerPayload([singleQuestion], drafts, 'q1')
assert.equal(otherPayload.answers[0].answer, '自定义方案')
assert.equal(otherPayload.answers[0].otherText, '自定义方案')

// 跳过载荷：全部未作答 → 全部 skipped
const skipPayload = iv.buildQuestionSkipPayload(item.questions, {}, 'q1')
assert.equal(skipPayload.skipped, true)
assert.equal(skipPayload.answeredCount, 0)
assert.ok(String(skipPayload.reason).includes('跳过'))
for (const answer of skipPayload.answers) {
  assert.equal(answer.skipped, true)
  assert.equal(answer.answer, '用户选择跳过')
}

// 跳过载荷：已作答的题保留真实答案（与桌面端 handleSkip 同语义）
const skipDrafts = {
  [key0]: { ...iv.emptyQuestionDraft(), selectedLabels: ['方案A'], selectedValues: ['方案A'] },
}
const skipPayloadPartial = iv.buildQuestionSkipPayload(item.questions, skipDrafts, 'q1')
assert.equal(skipPayloadPartial.skipped, true)
assert.equal(skipPayloadPartial.answeredCount, 1)
assert.deepEqual(
  { answer: skipPayloadPartial.answers[0].answer, skipped: skipPayloadPartial.answers[0].skipped },
  { answer: '方案A', skipped: false },
)
assert.equal(skipPayloadPartial.answers[1].skipped, true)
assert.equal(skipPayloadPartial.answers[2].skipped, true)

console.log('✅ smoke-interactions: 审批预览 / 问答视图 / 应答与跳过载荷 全部通过')
