import { mergeManualOrderWithHidden, moveItem } from '../../mobile/src/utils/sidebar-order'
import { useRef, useState } from 'react'
import { Modal, ScrollView, Text, TextInput, View } from 'react-native'
import { Action, useUi } from './ui'

export type RowAction = {
  label: string
  prompt?: { initial: string } | { confirmation: string }
  run(value: string): Promise<void>
}

export function RowMenu({
  title,
  actions,
  online,
  close,
  refresh,
  more,
}: {
  title: string
  actions: RowAction[]
  online: boolean
  close(): void
  refresh(): void
  more?: { label: string; open(): void }
}) {
  const { ui, colors } = useUi()
  const [selected, setSelected] = useState<RowAction>()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [issue, setIssue] = useState('')
  const act = async (action: RowAction) => {
    if (!online || pending.current || issue) return
    pending.current = true
    setBusy(true)
    try {
      await action.run(value.trim())
      refresh()
      close()
    } catch {
      setIssue('操作结果未确认，请关闭菜单后刷新列表核对。')
      refresh()
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const prompt = selected?.prompt
  return (
    <Modal transparent animationType="fade" onRequestClose={() => !pending.current && close()}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0006' }}>
        <View
          style={{ backgroundColor: colors.paper, padding: 16, borderRadius: 16, maxHeight: '85%' }}
        >
          <Text accessibilityRole="header" style={ui.section}>
            {selected?.label ?? title}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
            {prompt && 'confirmation' in prompt && (
              <Text style={ui.body}>{prompt.confirmation}</Text>
            )}
            {prompt && 'initial' in prompt && (
              <TextInput
                style={ui.input}
                value={value}
                onChangeText={setValue}
                maxLength={100}
                editable={!busy && !issue}
                accessibilityLabel={selected?.label}
              />
            )}
            {selected ? (
              <Action
                label={busy ? '处理中…' : '确认'}
                primary
                disabled={
                  busy || !online || !!issue || (!!prompt && 'initial' in prompt && !value.trim())
                }
                onPress={() => void act(selected)}
              />
            ) : (
              actions.map((action) => (
                <Action
                  key={action.label}
                  label={action.label}
                  disabled={busy || !online || !!issue}
                  onPress={() => {
                    if (!action.prompt) void act(action)
                    else {
                      setValue('initial' in action.prompt ? action.prompt.initial : '')
                      setSelected(action)
                    }
                  }}
                />
              ))
            )}
            {!selected && more && (
              <Action
                label={more.label}
                disabled={busy || !online || !!issue}
                onPress={more.open}
              />
            )}
          </ScrollView>
          {!!issue && (
            <Text style={ui.error} accessibilityLiveRegion="polite">
              {issue}
            </Text>
          )}
          <Action label="关闭" disabled={busy} onPress={close} />
        </View>
      </View>
    </Modal>
  )
}

export function moveRowActions(
  id: string,
  section: string[],
  visible: string[],
  save: (ids: string[]) => Promise<void>,
): RowAction[] {
  const index = visible.indexOf(id)
  if (index < 0) return []
  const shown = new Set(visible)
  const hidden = new Set(section.filter((key) => !shown.has(key)))
  const move = (to: number) =>
    save(mergeManualOrderWithHidden(section, moveItem(visible, index, to), hidden))
  return [
    ...(index > 0 ? [{ label: '上移', run: () => move(index - 1) }] : []),
    ...(index < visible.length - 1 ? [{ label: '下移', run: () => move(index + 1) }] : []),
  ]
}
