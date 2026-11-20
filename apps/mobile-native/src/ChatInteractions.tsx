import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { BridgeInteractions } from '../../mobile/src/utils/chat-interactions'
import {
  buildApprovalCardViews,
  buildQuestionAnswerPayload,
  buildQuestionCardViews,
  buildQuestionSkipPayload,
  emptyQuestionDraft,
  questionDraftKey,
} from '../../mobile/src/utils/interaction-view'
import type { QuestionDraft } from '../../mobile/src/utils/interaction-view'
import type { Relay, Target } from './relay'
import { Action, useUi } from './ui'

const empty: BridgeInteractions = { approvals: [], questions: [] }
const decisions = [
  ['deny', '拒绝'],
  ['allow-session', '会话内允许'],
  ['allow-once', '允许一次'],
] as const

export function ChatInteractions({
  relay,
  deviceId,
  sessionId,
  online,
  running,
}: Target & {
  relay: Relay
  online: boolean
  running: boolean
}) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const { ui, colors } = appearance
  const [snapshot, setSnapshot] = useState(empty)
  const [issue, setIssue] = useState('')
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({})
  const [busy, setBusy] = useState<string[]>([])
  const pending = useRef(new Set<string>())
  const settled = useRef(new Set<string>())
  const active = useRef(false)
  const target = { deviceId, sessionId }

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    if (!online) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const result = await relay.interactions({ deviceId, sessionId })
        if (stopped) return
        const approvals = result.approvals.filter(
          (entry) => !settled.current.has(`approval:${entry.requestId}`),
        )
        const questions = result.questions.filter(
          (entry) => !settled.current.has(`question:${entry.questionId}`),
        )
        setSnapshot({ approvals, questions })
        const draftKeys = new Set(
          questions.flatMap((entry) =>
            entry.questions.map((_, index) => questionDraftKey(entry.questionId, index)),
          ),
        )
        setDrafts((old) =>
          Object.fromEntries(Object.entries(old).filter(([key]) => draftKeys.has(key))),
        )
      } catch {
        // Older desktops may lack this endpoint. Keep the last snapshot during intermittent failure.
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), running ? 1500 : 4500)
      }
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [deviceId, online, relay, running, sessionId])

  const submit = async (key: string, action: () => Promise<boolean>) => {
    if (!online || pending.current.has(key) || settled.current.has(key)) return
    pending.current.add(key)
    setBusy([...pending.current])
    setIssue('')
    try {
      const applied = await action()
      settled.current.add(key)
      if (!active.current) return
      setSnapshot((old) => ({
        approvals: old.approvals.filter((item) => `approval:${item.requestId}` !== key),
        questions: old.questions.filter((item) => `question:${item.questionId}` !== key),
      }))
      if (!applied) setIssue('这条请求已处理或过期')
    } catch {
      if (active.current) setIssue('处理结果未确认，请检查电脑端状态')
    } finally {
      pending.current.delete(key)
      if (active.current) setBusy([...pending.current])
    }
  }

  const updateDraft = (key: string, change: (old: QuestionDraft) => QuestionDraft) => {
    setDrafts((old) => ({ ...old, [key]: change(old[key] ?? emptyQuestionDraft()) }))
  }

  if (!snapshot.approvals.length && !snapshot.questions.length) {
    return issue ? (
      <Text style={ui.error} accessibilityLiveRegion="polite">
        {issue}
      </Text>
    ) : null
  }
  return (
    <ScrollView
      style={styles.deck}
      contentContainerStyle={styles.stack}
      keyboardShouldPersistTaps="handled"
    >
      {!!issue && (
        <Text style={ui.error} accessibilityLiveRegion="polite">
          {issue}
        </Text>
      )}
      {buildApprovalCardViews(snapshot.approvals).map((card) => {
        const key = `approval:${card.requestId}`
        return (
          <View key={key} style={[styles.card, card.caution && { borderColor: colors.error }]}>
            <Text style={ui.section}>{card.actionLabel}</Text>
            <Text style={card.caution ? ui.error : ui.muted}>
              {card.toolName} · {card.riskLabel}
            </Text>
            {card.hasPreview && (
              <Text selectable style={ui.body}>
                {card.preview}
              </Text>
            )}
            <View style={styles.actions}>
              {decisions.map(([decision, label]) => (
                <Action
                  key={decision}
                  label={label}
                  disabled={!online || busy.includes(key)}
                  primary={decision === 'allow-once'}
                  onPress={() =>
                    void submit(key, () => relay.resolveApproval(target, card.requestId, decision))
                  }
                />
              ))}
            </View>
          </View>
        )
      })}
      {buildQuestionCardViews(snapshot.questions, drafts).map((card) => {
        const key = `question:${card.questionId}`
        const source = snapshot.questions.find((entry) => entry.questionId === card.questionId)
        if (!source) return null
        const disabled = !online || busy.includes(key)
        const answer = (skip: boolean) => {
          const build = skip ? buildQuestionSkipPayload : buildQuestionAnswerPayload
          void submit(key, () =>
            relay.answerQuestion(
              target,
              card.questionId,
              build(source.questions, drafts, card.questionId),
            ),
          )
        }
        return (
          <View key={key} style={styles.card}>
            {card.items.map((item) => {
              const draftKey = questionDraftKey(card.questionId, item.index)
              const prompt = source.questions[item.index]
              return (
                <View key={draftKey} style={styles.stack}>
                  {!!item.header && <Text style={ui.section}>{item.header}</Text>}
                  <Text selectable style={ui.body}>
                    {item.question}
                  </Text>
                  {item.kind === 'text' ? (
                    <TextInput
                      style={ui.input}
                      placeholder={item.placeholder}
                      accessibilityLabel={item.question}
                      value={item.text}
                      maxLength={2000}
                      multiline={item.multiline}
                      editable={!disabled}
                      onChangeText={(text) => updateDraft(draftKey, (old) => ({ ...old, text }))}
                    />
                  ) : (
                    <>
                      {item.options.map((option, index) => (
                        <Pressable
                          key={index}
                          style={[
                            styles.option,
                            option.selected && { backgroundColor: colors.tint },
                          ]}
                          accessibilityRole={item.multiSelect ? 'checkbox' : 'radio'}
                          accessibilityState={{ checked: option.selected, disabled }}
                          disabled={disabled}
                          onPress={() =>
                            updateDraft(draftKey, (old) => {
                              const original = prompt?.options?.[index]
                              const value = original?.value ?? option.label
                              const selected = old.selectedLabels.includes(option.label)
                              if (!item.multiSelect)
                                return {
                                  ...old,
                                  selectedLabels: [option.label],
                                  selectedValues: [value],
                                  otherText: original?.allowsFreeText ? old.otherText : '',
                                }
                              return {
                                ...old,
                                selectedLabels: selected
                                  ? old.selectedLabels.filter((label) => label !== option.label)
                                  : [...old.selectedLabels, option.label],
                                selectedValues: selected
                                  ? old.selectedValues.filter(
                                      (_, i) => old.selectedLabels[i] !== option.label,
                                    )
                                  : [...old.selectedValues, value],
                              }
                            })
                          }
                        >
                          <Text style={ui.body}>{option.label}</Text>
                          {!!option.description && (
                            <Text style={ui.muted}>{option.description}</Text>
                          )}
                        </Pressable>
                      ))}
                      <TextInput
                        style={ui.input}
                        accessibilityLabel={item.otherLabel}
                        placeholder={item.otherPlaceholder}
                        value={item.otherText}
                        editable={!disabled}
                        onChangeText={(otherText) =>
                          updateDraft(draftKey, (old) =>
                            item.multiSelect
                              ? { ...old, otherText }
                              : {
                                  ...old,
                                  otherText,
                                  selectedLabels: [item.otherLabel],
                                  selectedValues: [item.otherLabel],
                                },
                          )
                        }
                      />
                    </>
                  )}
                </View>
              )
            })}
            <View style={styles.actions}>
              {card.allowSkip && (
                <Action label="跳过" disabled={disabled} onPress={() => answer(true)} />
              )}
              <Action
                label="提交回答"
                primary
                disabled={disabled || !card.canSubmit}
                onPress={() => answer(false)}
              />
            </View>
          </View>
        )
      })}
    </ScrollView>
  )
}

function createStyles({ colors, ui }: ReturnType<typeof useUi>) {
  return StyleSheet.create({
    deck: { flexGrow: 0, flexShrink: 1, maxHeight: '50%', backgroundColor: colors.paper },
    stack: { gap: 8 },
    card: {
      gap: 8,
      padding: 12,
      marginHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
    },
    actions: { ...ui.row, flexWrap: 'wrap', justifyContent: 'flex-end' },
    option: { padding: 10, minHeight: 44, borderRadius: 8, backgroundColor: colors.background },
  })
}
