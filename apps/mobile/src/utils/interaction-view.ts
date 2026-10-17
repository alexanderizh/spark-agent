/**
 * 挂起交互（权限审批卡 + 用户问答卡）的视图构建。
 *
 * 桌面端审批/问答走实时推送弹卡，移动端只有轮询 + REST 应答：
 *   - 审批卡：工具入参提取一句可读预览（命令/文件路径优先），风险分级标签
 *   - 问答卡：单选/多选/文本 + 「其他」自由输入，本地草稿驱动选中态
 *   - 应答：与桌面端渲染端 UserQuestionDock 完全同构的 answers 载荷
 *     （{ answers: [{ index, id, question, type, skipped, answer, … }], questionCount,
 *       answeredCount }），引擎侧 normalizeAskUserQuestionAnswers 才能正确归一。
 *
 * 全部纯函数，smoke 脚本可直接对 dist 产物回归。
 */

import type {
  BridgeApprovalItem,
  BridgeQuestionItem,
  BridgeQuestionOption,
  BridgeQuestionPrompt,
} from '../api/bridge'

// ─── 权限审批卡 ───────────────────────────────────────────────────────────────

/** 权限动作 → 中文标签（与 PermissionService 的 action 分类对齐） */
export const APPROVAL_ACTION_LABELS: Record<string, string> = {
  file_read: '读取文件',
  file_write: '写入文件',
  command_exec: '执行命令',
  command_dangerous: '执行高危命令',
  git_push: '推送 Git',
  network_known: '访问白名单网络',
  network_unknown: '访问未知网络',
  mcp_tool: '调用 MCP 工具',
  secret_read: '读取密钥',
}

const RISK_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
}

/** 工具入参 → 可读预览（命令/文件路径等高频字段优先，缺失时截断 JSON） */
export function describeApprovalInput(toolInput: Record<string, unknown>): string {
  const preferredKeys = [
    'command',
    'cmd',
    'file_path',
    'filePath',
    'path',
    'notebook_path',
    'url',
    'query',
    'pattern',
    'prompt',
  ]
  for (const key of preferredKeys) {
    const value = toolInput[key]
    if (typeof value === 'string' && value.trim()) return collapseWhitespace(value.trim())
  }
  let json: string
  try {
    json = JSON.stringify(toolInput) ?? ''
  } catch {
    json = ''
  }
  // 空入参（{} / 序列化失败）返回空串：调用方按「无预览」隐藏预览框
  if (json === '' || json === '{}') return ''
  return json.length > 160 ? `${json.slice(0, 160)}…` : json
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface ApprovalCardView {
  requestId: string
  toolName: string
  /** 动作中文标签（未知 action 原样展示） */
  actionLabel: string
  riskLabel: string
  riskLevel: 'low' | 'medium' | 'high'
  /** 入参预览（单行折叠） */
  preview: string
  hasPreview: boolean
  /** 高危询问：卡片描红 + 文案提示 */
  caution: boolean
}

export function buildApprovalCardViews(approvals: BridgeApprovalItem[]): ApprovalCardView[] {
  return [...approvals]
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .map((approval) => {
      const preview = describeApprovalInput(
        approval.toolInput != null && typeof approval.toolInput === 'object'
          ? approval.toolInput
          : {},
      )
      return {
        requestId: approval.requestId,
        toolName: approval.toolName,
        actionLabel: APPROVAL_ACTION_LABELS[approval.action] ?? approval.action,
        riskLabel: RISK_LABELS[approval.riskLevel] ?? approval.riskLevel,
        riskLevel: approval.riskLevel,
        preview,
        hasPreview: preview.length > 0,
        caution: approval.defaultToNo === true || approval.riskLevel === 'high',
      }
    })
}

// ─── 用户问答卡 ───────────────────────────────────────────────────────────────

/** 单题草稿（cardKey = `${questionId}#${index}`；values 与 labels 平行，存 option.value ?? label） */
export interface QuestionDraft {
  selectedLabels: string[]
  selectedValues: string[]
  otherText: string
  text: string
  skipped: boolean
}

export function emptyQuestionDraft(): QuestionDraft {
  return { selectedLabels: [], selectedValues: [], otherText: '', text: '', skipped: false }
}

function resolvedQuestionType(
  question: BridgeQuestionPrompt,
): 'single_choice' | 'multi_choice' | 'text' {
  if (question.type != null) return question.type
  return question.multiSelect === true ? 'multi_choice' : 'single_choice'
}

function isChoiceQuestion(question: BridgeQuestionPrompt): boolean {
  return resolvedQuestionType(question) !== 'text'
}

function isMultiChoice(question: BridgeQuestionPrompt): boolean {
  return resolvedQuestionType(question) === 'multi_choice'
}

export function getOtherOptionLabel(question: BridgeQuestionPrompt): string {
  return question.otherOptionLabel?.trim() || '其他'
}

function getOtherPlaceholder(question: BridgeQuestionPrompt): string {
  return question.otherPlaceholder?.trim() || '请输入其他内容'
}

/** 单题视图（题干 + 选项选中态 + 「其他」自由输入；与桌面端 UserQuestionDock 同构） */
export interface QuestionItemView {
  index: number
  header: string
  question: string
  kind: 'choice' | 'text'
  multiSelect: boolean
  options: { label: string; description: string; selected: boolean }[]
  /** 选择题固定带「其他」自由输入行（与桌面端一致，不受 allowOther 开关约束） */
  otherLabel: string
  otherPlaceholder: string
  otherText: string
  text: string
  placeholder: string
  multiline: boolean
}

/** 一次 AskUserQuestion 请求 = 一张问答卡（与桌面端一次提交全部题目同语义） */
export interface QuestionCardView {
  questionId: string
  items: QuestionItemView[]
  canSubmit: boolean
  allowSkip: boolean
  /** 应答提交中（页面层按 submittingKeys 附加；防重复提交） */
  busy?: boolean
}

/** 与桌面端 UserQuestionDock.isQuestionAnswered 同口径（不含 optional 捷径；skip 载荷据此保留已答题） */
export function isQuestionAnswered(question: BridgeQuestionPrompt, draft: QuestionDraft): boolean {
  if (draft.skipped) return true
  if (isChoiceQuestion(question)) {
    if (isMultiChoice(question)) {
      return draft.selectedLabels.length > 0 || draft.otherText.trim().length > 0
    }
    if (draft.selectedLabels[0] === getOtherOptionLabel(question)) {
      return draft.otherText.trim().length > 0
    }
    return draft.selectedLabels.length > 0 || draft.otherText.trim().length > 0
  }
  return draft.text.trim().length > 0
}

/** 与桌面端 UserQuestionDock.isQuestionReadyForSubmit 同口径（isOptionalUserQuestion 含 allowSkip 捷径） */
export function isQuestionReady(question: BridgeQuestionPrompt, draft: QuestionDraft): boolean {
  if (draft.skipped) return true
  if (question.required === false || question.allowSkip === true) return true
  return isQuestionAnswered(question, draft)
}

function buildItemView(
  question: BridgeQuestionPrompt,
  draft: QuestionDraft,
  index: number,
): QuestionItemView {
  const choice = isChoiceQuestion(question)
  const options: QuestionItemView['options'] = choice
    ? (question.options ?? []).map((option: BridgeQuestionOption) => ({
        label: option.label,
        description: option.description ?? '',
        selected:
          isMultiChoice(question) && draft.skipped !== true
            ? draft.selectedLabels.includes(option.label)
            : draft.selectedLabels[0] === option.label,
      }))
    : []
  return {
    index,
    header: question.header,
    question: question.question,
    kind: choice ? 'choice' : 'text',
    multiSelect: isMultiChoice(question),
    options,
    otherLabel: getOtherOptionLabel(question),
    otherPlaceholder: getOtherPlaceholder(question),
    otherText: draft.otherText,
    text: draft.text,
    placeholder: question.placeholder?.trim() || '请输入你的回答',
    multiline: question.multiline === true,
  }
}

export function buildQuestionCardViews(
  items: BridgeQuestionItem[],
  drafts: Record<string, QuestionDraft>,
): QuestionCardView[] {
  return [...items]
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .map((item) => {
      const views: QuestionItemView[] = []
      let canSubmit = true
      item.questions.forEach((question, index) => {
        const draft = drafts[questionDraftKey(item.questionId, index)] ?? emptyQuestionDraft()
        views.push(buildItemView(question, draft, index))
        if (!isQuestionReady(question, draft)) canSubmit = false
      })
      return {
        questionId: item.questionId,
        items: views,
        canSubmit,
        // 桌面端跳过按钮常显、仅显式 allowSkip === false 的题禁用；卡级聚合取「存在可跳过的题」
        allowSkip: item.questions.some((question) => question.allowSkip !== false),
      }
    })
}

export function questionDraftKey(questionId: string, index: number): string {
  return `${questionId}#${index}`
}

/**
 * 构造与桌面端渲染端完全同构的应答载荷（UserQuestionDock.buildQuestionAnswer 镜像）。
 * drafts 以 questionDraftKey(questionId, index) 为键；引擎侧按 question 文本/index
 * 归一为 SDK 答案映射，形状不一致会答非所问。
 */
export function buildQuestionAnswerPayload(
  questions: BridgeQuestionPrompt[],
  drafts: Record<string, QuestionDraft>,
  questionId: string,
): Record<string, unknown> {
  const answers = questions.map((question, index) => {
    const draft = drafts[questionDraftKey(questionId, index)] ?? emptyQuestionDraft()
    return buildSingleAnswer(question, draft, index)
  })
  return {
    answers,
    questionCount: questions.length,
    answeredCount: answers.filter((answer) => answer.skipped !== true).length,
  }
}

function buildSingleAnswer(
  question: BridgeQuestionPrompt,
  draft: QuestionDraft,
  index: number,
): Record<string, unknown> {
  const type = resolvedQuestionType(question)
  const isSkipped = draft.skipped === true
  const otherText = draft.otherText.trim()
  const text = draft.text.trim()

  let answerValue: string
  let optionLabel: string | undefined
  let optionValue: string | undefined
  if (isSkipped) {
    answerValue = '用户选择跳过'
  } else if (type === 'multi_choice') {
    // answer 含「其他」追加项；optionLabel/optionValue 只含预置选项（与桌面端 buildQuestionAnswer 一致）
    answerValue = [...draft.selectedLabels, ...(otherText ? [otherText] : [])]
      .filter(Boolean)
      .join(' | ')
    if (draft.selectedLabels.length > 0) {
      optionLabel = draft.selectedLabels.join(' | ')
    }
    if (draft.selectedValues.length > 0) {
      optionValue = draft.selectedValues.map((value) => String(value)).join(' | ')
    }
  } else if (type === 'single_choice') {
    // answer 的选项部分优先取 value（?? 链），optionLabel/optionValue 仅在真实选中时展开
    // （与桌面端 buildQuestionAnswer 三支同构；value 与 label 不同时 answer 必须取 value）
    const selected = draft.selectedValues[0] ?? draft.selectedLabels[0] ?? ''
    if (selected === getOtherOptionLabel(question)) {
      answerValue = otherText
    } else if (otherText && selected) {
      answerValue = `${selected} | ${otherText}`
    } else {
      answerValue = otherText || selected
    }
    optionLabel = draft.selectedLabels[0] || undefined
    optionValue = draft.selectedValues[0] || undefined
  } else {
    answerValue = text
  }

  return {
    index,
    id: question.id ?? `question-${index + 1}`,
    header: question.header,
    question: question.question,
    type,
    skipped: isSkipped,
    answer: answerValue,
    ...(optionLabel != null ? { optionLabel } : {}),
    ...(optionValue != null && optionValue !== '' ? { optionValue } : {}),
    ...(otherText ? { otherText } : {}),
    ...(text ? { text } : {}),
  }
}

/**
 * 跳过整卡（与桌面端 handleSkip 同语义）：已作答的题保留真实答案，
 * 未作答的题按 skipped 草稿产出；顶层带 skipped + reason。
 */
export function buildQuestionSkipPayload(
  questions: BridgeQuestionPrompt[],
  drafts: Record<string, QuestionDraft>,
  questionId: string,
): Record<string, unknown> {
  const answers = questions.map((question, index) => {
    const draft = drafts[questionDraftKey(questionId, index)] ?? emptyQuestionDraft()
    if (isQuestionAnswered(question, draft)) return buildSingleAnswer(question, draft, index)
    return {
      index,
      id: question.id ?? `question-${index + 1}`,
      header: question.header,
      question: question.question,
      type: resolvedQuestionType(question),
      skipped: true,
      answer: '用户选择跳过',
    }
  })
  return {
    skipped: true,
    reason: '用户选择跳过这些问题。',
    answers,
    questionCount: questions.length,
    answeredCount: answers.filter((answer) => answer.skipped !== true).length,
  }
}
