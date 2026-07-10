import React, { useState } from 'react'
import { Input as LobeInput, TextArea as LobeTextArea } from '@lobehub/ui'
import type { UserQuestionOption, UserQuestionPrompt } from '@spark/protocol'
import { Icons } from '../../Icons'
import type { UserQuestionData } from './UserQuestionUtils'

type UserQuestionDraft = {
  selectedLabel?: string
  selectedValue?: unknown
  selectedLabels?: string[]
  selectedValues?: unknown[]
  otherText?: string
  text?: string
  skipped?: boolean
}

function UserQuestionWizard({
  data,
  onAnswer,
  onCancel,
  currentIndex,
  onCurrentIndexChange,
}: {
  data: UserQuestionData
  onAnswer: (answers: Record<string, unknown>) => void
  onCancel: () => void
  currentIndex: number
  onCurrentIndexChange: React.Dispatch<React.SetStateAction<number>>
}) {
  const [drafts, setDrafts] = useState<Record<number, UserQuestionDraft>>({})
  const [submitted, setSubmitted] = useState(false)
  const currentQuestion = data.questions[currentIndex]
  const currentDraft = drafts[currentIndex] ?? {}

  if (currentQuestion == null) return null

  const total = data.questions.length
  const answeredCount = data.questions.filter((question, index) =>
    isQuestionAnswered(question, drafts[index]),
  ).length
  const canGoBack = currentIndex > 0
  const canGoNext = currentIndex < total - 1
  const canSubmit = data.questions.every((question, index) =>
    isQuestionReadyForSubmit(question, drafts[index]),
  )
  const choiceOptions = getChoiceOptions(currentQuestion)
  const otherLabel = getOtherOptionLabel(currentQuestion)
  const otherInputPlaceholder = getOtherPlaceholder(currentQuestion)

  const updateDraft = (patch: Partial<UserQuestionDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [currentIndex]: {
        ...prev[currentIndex],
        ...patch,
      },
    }))
  }

  const handleSelectOption = (option: UserQuestionOption) => {
    if (isMultiChoiceQuestion(currentQuestion)) {
      const prevLabels = currentDraft.selectedLabels ?? []
      const prevValues = currentDraft.selectedValues ?? []
      const alreadySelected = prevLabels.includes(option.label)
      const nextLabels = alreadySelected
        ? prevLabels.filter((label) => label !== option.label)
        : [...prevLabels, option.label]
      const nextValues = alreadySelected
        ? prevValues.filter((value) => value !== (option.value ?? option.label))
        : [...prevValues, option.value ?? option.label]
      updateDraft({
        skipped: false,
        selectedLabels: nextLabels,
        selectedValues: nextValues,
        text: '',
      })
      return
    }

    updateDraft({
      skipped: false,
      selectedLabel: option.label,
      selectedValue: option.value ?? option.label,
      ...(option.allowsFreeText ? {} : { otherText: '' }),
      text: '',
    })
    if (!option.allowsFreeText && canGoNext) {
      onCurrentIndexChange((prev) => Math.min(prev + 1, total - 1))
    }
  }

  const handleTextChange = (value: string) => {
    updateDraft({ skipped: false, text: value })
  }

  const handleOtherTextChange = (value: string) => {
    if (isMultiChoiceQuestion(currentQuestion)) {
      updateDraft({ skipped: false, otherText: value, text: '' })
      return
    }
    updateDraft({
      skipped: false,
      selectedLabel: otherLabel,
      selectedValue: otherLabel,
      otherText: value,
      text: '',
    })
  }

  const handleSkip = () => {
    updateDraft({
      skipped: true,
      selectedLabel: '',
      selectedValue: '',
      otherText: '',
      text: '',
    })
    if (canGoNext) {
      onCurrentIndexChange((prev) => Math.min(prev + 1, total - 1))
    }
  }

  const handleSubmit = () => {
    if (submitted || !canSubmit) return
    setSubmitted(true)
    const answers: Record<string, unknown> = {
      answers: data.questions.map((question, index) =>
        buildQuestionAnswer(question, drafts[index], index),
      ),
      questionCount: total,
      answeredCount,
    }
    onAnswer(answers)
  }

  const handleCancel = () => {
    if (submitted) return
    onCancel()
  }

  return (
    <>
      <div className="user-question-body">
        <div className="question-item">
          {isMultiChoiceQuestion(currentQuestion) && (
            <span className="question-header" title="本题可选择多个选项">
              可多选
            </span>
          )}
          <div className="question-text">{currentQuestion.question}</div>

          {isChoiceQuestion(currentQuestion) ? (
            <>
              <div className="question-options">
                {choiceOptions.map((opt, optIndex) => {
                  const selected = isMultiChoiceQuestion(currentQuestion)
                    ? (currentDraft.selectedLabels ?? []).includes(opt.label)
                    : currentDraft.selectedLabel === opt.label
                  const tooltipText = opt.description
                    ? `${opt.label}\n${opt.description}`
                    : opt.label
                  return (
                    <button
                      key={`${opt.label}-${optIndex}`}
                      className={`question-option ${selected ? 'selected' : ''}`}
                      onClick={() => handleSelectOption(opt)}
                      disabled={submitted}
                      title={tooltipText}
                    >
                      <div className="option-label">{opt.label}</div>
                      {opt.description && <div className="option-desc">{opt.description}</div>}
                      {selected && (
                        <span className="question-option-check" aria-hidden="true">
                          <Icons.Check size={11} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="user-question-other">
                <div className="user-question-other-label">{otherLabel}</div>
                <div className="user-question-input-wrap">
                  <LobeInput
                    value={currentDraft.otherText ?? ''}
                    onChange={(e) => handleOtherTextChange(e.target.value)}
                    placeholder={otherInputPlaceholder}
                    disabled={submitted}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="user-question-input-wrap">
              {currentQuestion.multiline ? (
                <LobeTextArea
                  value={currentDraft.text ?? ''}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder={currentQuestion.placeholder ?? '请输入您的回答'}
                  disabled={submitted}
                  rows={5}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  autoFocus
                />
              ) : (
                <LobeInput
                  value={currentDraft.text ?? ''}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder={currentQuestion.placeholder ?? '请输入您的回答'}
                  disabled={submitted}
                  autoFocus
                />
              )}
            </div>
          )}

          {currentDraft.skipped && (
            <div className="question-skip-note">这一题已标记为跳过，您仍可返回修改。</div>
          )}
        </div>
      </div>

      <div className="user-question-footer">
        <div className="user-question-pagination">
          {data.questions.map((question, index) => (
            <button
              key={question.id ?? `${question.question}-${index}`}
              className={`user-question-dot ${index === currentIndex ? 'active' : ''} ${isQuestionAnswered(question, drafts[index]) ? 'done' : ''}`}
              onClick={() => onCurrentIndexChange(index)}
              disabled={submitted}
              title={`第 ${index + 1} 题`}
            >
              {index + 1}
            </button>
          ))}
        </div>

        <div className="user-question-actions">
          <button
            className="user-question-btn secondary"
            onClick={handleSkip}
            disabled={submitted || currentQuestion.allowSkip === false}
          >
            跳过
          </button>
          <button
            className="user-question-btn secondary"
            onClick={handleCancel}
            disabled={submitted}
          >
            取消
          </button>
          <button
            className="user-question-btn secondary"
            onClick={() => onCurrentIndexChange((prev) => Math.max(prev - 1, 0))}
            disabled={submitted || !canGoBack}
          >
            上一题
          </button>
          {canGoNext ? (
            <button
              className="user-question-btn primary"
              onClick={() => onCurrentIndexChange((prev) => Math.min(prev + 1, total - 1))}
              disabled={submitted}
            >
              下一题
            </button>
          ) : (
            <button
              className="user-question-btn primary"
              onClick={handleSubmit}
              disabled={submitted || !canSubmit}
            >
              {submitted ? <Icons.Spinner size={12} /> : null}
              提交答案
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function isChoiceQuestion(question: UserQuestionPrompt): boolean {
  const type = question.type ?? 'single_choice'
  return type === 'single_choice' || type === 'multi_choice'
}

function isMultiChoiceQuestion(question: UserQuestionPrompt): boolean {
  const type = question.type ?? (question.multiSelect === true ? 'multi_choice' : 'single_choice')
  return type === 'multi_choice'
}

function getOtherOptionLabel(question: UserQuestionPrompt): string {
  return question.otherOptionLabel?.trim() || '其他'
}

function getOtherPlaceholder(question: UserQuestionPrompt): string {
  return question.otherPlaceholder?.trim() || '请输入其他内容'
}

function getChoiceOptions(question: UserQuestionPrompt): UserQuestionOption[] {
  return question.options ?? []
}

function isQuestionAnswered(
  question: UserQuestionPrompt,
  draft: UserQuestionDraft | undefined,
): boolean {
  if (draft?.skipped) return true
  if (draft == null) return false
  if (isChoiceQuestion(question)) {
    if (isMultiChoiceQuestion(question)) {
      return (draft.selectedLabels?.length ?? 0) > 0 || (draft.otherText?.trim().length ?? 0) > 0
    }
    if (draft.selectedLabel === getOtherOptionLabel(question)) {
      return (draft.otherText?.trim().length ?? 0) > 0
    }
    return !!draft.selectedLabel || (draft.otherText?.trim().length ?? 0) > 0
  }
  return (draft.text?.trim().length ?? 0) > 0
}

function isQuestionReadyForSubmit(
  question: UserQuestionPrompt,
  draft: UserQuestionDraft | undefined,
): boolean {
  if (draft?.skipped) return true
  return isQuestionAnswered(question, draft)
}

function buildQuestionAnswer(
  question: UserQuestionPrompt,
  draft: UserQuestionDraft | undefined,
  index: number,
) {
  const isSkipped = draft?.skipped === true
  const otherText = draft?.otherText?.trim() ?? ''
  const text = draft?.text?.trim() ?? ''
  const answerValue = isChoiceQuestion(question)
    ? isMultiChoiceQuestion(question)
      ? (() => {
          const labels = draft?.selectedLabels ?? []
          const parts = [...labels]
          if (otherText) parts.push(otherText)
          return parts.filter(Boolean).join(' | ')
        })()
      : (() => {
          const selected = draft?.selectedValue ?? draft?.selectedLabel ?? ''
          if (selected === getOtherOptionLabel(question)) return otherText
          if (otherText && selected) return `${selected} | ${otherText}`
          return otherText || selected
        })()
    : text

  const resolvedType =
    question.type ??
    (isMultiChoiceQuestion(question)
      ? 'multi_choice'
      : isChoiceQuestion(question)
        ? 'single_choice'
        : 'text')

  return {
    index,
    id: question.id ?? `question-${index + 1}`,
    header: question.header,
    question: question.question,
    type: resolvedType,
    skipped: isSkipped,
    answer: isSkipped ? '' : answerValue,
    ...(isMultiChoiceQuestion(question)
      ? {
          ...(draft?.selectedLabels && draft.selectedLabels.length > 0
            ? { optionLabel: draft.selectedLabels.join(' | ') }
            : {}),
          ...(draft?.selectedValues && draft.selectedValues.length > 0
            ? { optionValue: draft.selectedValues.join(' | ') }
            : {}),
        }
      : {
          ...(draft?.selectedLabel ? { optionLabel: draft.selectedLabel } : {}),
          ...(draft?.selectedValue ? { optionValue: draft.selectedValue } : {}),
        }),
    ...(otherText ? { otherText } : {}),
    ...(text ? { text } : {}),
  }
}

/** Sticky reply panel for AskUserQuestion so users always have an in-context reply path */
export function UserQuestionDock(
  props: Omit<Parameters<typeof UserQuestionWizard>[0], 'currentIndex' | 'onCurrentIndexChange'>,
) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const total = props.data.questions.length

  return (
    <div className="user-question-dock">
      <div className="user-question-dock-head">
        <div className="user-question-dock-icon">
          <Icons.HelpCircle size={17} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="user-question-dock-title">Agent 正在等您回复</div>
          <div className="user-question-dock-subtitle">
            逐题作答，支持回退、跳过，以及输入自定义答案
          </div>
        </div>
        <div className="user-question-dock-badge">
          {Math.min(currentIndex + 1, total)} / {total}
        </div>
      </div>
      <div className="user-question-dock-panel">
        <UserQuestionWizard
          {...props}
          currentIndex={currentIndex}
          onCurrentIndexChange={setCurrentIndex}
        />
      </div>
    </div>
  )
}
