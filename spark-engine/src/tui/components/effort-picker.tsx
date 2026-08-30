import { Box, Text, useInput } from 'ink'
import { useState, type ReactElement } from 'react'

import type { ReasoningEffort } from '../../llm/types.js'
import type { TuiTheme } from '../theme.js'

export const EFFORT_OPTIONS: readonly {
  readonly value: ReasoningEffort | undefined
  readonly label: string
  readonly hint: string
}[] = [
  { value: undefined, label: 'auto', hint: '协议默认强度' },
  { value: 'low', label: 'low', hint: '轻量思考' },
  { value: 'medium', label: 'medium', hint: '均衡思考' },
  { value: 'high', label: 'high', hint: '深入思考' },
  { value: 'max', label: 'max', hint: '最大思考预算' },
  { value: 'off', label: 'off', hint: '关闭思考' },
]

export interface EffortPickerProps {
  readonly theme: TuiTheme
  readonly current: ReasoningEffort | undefined
  onPick(effort: ReasoningEffort | undefined): void
  onClose(): void
}

/**
 * Interactive reasoning-effort selector opened by /effort — same interaction
 * model as the model and permission pickers (↑↓/digits + enter, esc closes).
 */
export function EffortPicker(props: EffortPickerProps): ReactElement {
  const initialIndex = Math.max(
    0,
    EFFORT_OPTIONS.findIndex((option) => option.value === props.current),
  )
  const [selected, setSelected] = useState(initialIndex)

  useInput((input, key) => {
    if (key.escape) {
      props.onClose()
      return
    }
    if (key.upArrow) {
      setSelected((value) => (value + EFFORT_OPTIONS.length - 1) % EFFORT_OPTIONS.length)
      return
    }
    if (key.downArrow) {
      setSelected((value) => (value + 1) % EFFORT_OPTIONS.length)
      return
    }
    if (/^[1-9]$/.test(input)) {
      const index = Number(input) - 1
      if (index < EFFORT_OPTIONS.length) props.onPick(EFFORT_OPTIONS[index]?.value)
      return
    }
    if (key.return) props.onPick(EFFORT_OPTIONS[selected]?.value)
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.theme.accent} paddingX={1}>
      <Text color={props.theme.accent}>推理强度(对下一个 turn 生效)</Text>
      {EFFORT_OPTIONS.map((option, index) => (
        <Text key={option.label}>
          {selected === index ? '❯' : ' '} {index + 1} {option.label}
          <Text color={props.theme.dim}> — {option.hint}</Text>
          {option.value === props.current ? <Text color={props.theme.ok}> ✓当前</Text> : null}
        </Text>
      ))}
      <Text color={props.theme.dim}>↑↓/数字 选择 · enter 应用 · esc 关闭</Text>
    </Box>
  )
}
