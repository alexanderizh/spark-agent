import { Text, useInput } from 'ink'
import { useState, type ReactElement } from 'react'

import type { ReasoningEffort } from '../../llm/types.js'
import type { TerminalCapabilities, TuiTheme } from '../theme.js'
import { PickerFrame, PickerRow } from './picker-layout.js'

export const EFFORT_OPTIONS: readonly {
  readonly value: ReasoningEffort
  readonly label: string
  readonly hint: string
}[] = [
  { value: 'low', label: 'low', hint: '轻量思考' },
  { value: 'medium', label: 'medium', hint: '均衡思考' },
  { value: 'high', label: 'high', hint: '深入思考 · 默认' },
  { value: 'max', label: 'max', hint: '最大思考预算' },
  { value: 'off', label: 'off', hint: '关闭思考' },
]

/** The engine-wide default: explicit high instead of channel-dependent defaults. */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'high'

export interface EffortPickerProps {
  readonly theme: TuiTheme
  readonly capabilities?: TerminalCapabilities | undefined
  readonly current: ReasoningEffort
  onPick(effort: ReasoningEffort): void
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
      const option = EFFORT_OPTIONS[index]
      if (index < EFFORT_OPTIONS.length && option) props.onPick(option.value)
      return
    }
    if (key.return) {
      const option = EFFORT_OPTIONS[selected]
      if (option) props.onPick(option.value)
    }
  })

  return (
    <PickerFrame
      title="推理强度"
      titleSuffix=" · 对下一个 turn 生效"
      footer="↑↓/数字 选择 · enter 应用 · esc 关闭"
      theme={props.theme}
    >
      {EFFORT_OPTIONS.map((option, index) => (
        <PickerRow
          key={option.label}
          selected={selected === index}
          theme={props.theme}
          capabilities={props.capabilities}
        >
          {selected === index ? '❯' : ' '} {index + 1} {option.label}
          <Text color={props.theme.dim}> — {option.hint}</Text>
          {option.value === props.current ? <Text color={props.theme.ok}> ✓当前</Text> : null}
        </PickerRow>
      ))}
    </PickerFrame>
  )
}
