import { Box, Text, useInput } from 'ink'
import { useMemo, useState, type ReactElement } from 'react'

import { shouldSwallowImeKeypress } from '../ime-guard.js'
import { SLASH_COMMANDS } from '../slash-commands.js'
import { glyphs, type TerminalCapabilities, type TuiTheme } from '../theme.js'

export interface InputEditorProps {
  readonly active: boolean
  readonly locked: boolean
  /** True while an agent turn is running; Esc then always means interrupt. */
  readonly running?: boolean
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
  readonly onSubmit: (value: string) => void
  readonly onEscape: () => void
  readonly onControlC: () => void
  /** Shift+Tab permission-mode cycling; absent = binding ignored. */
  readonly onCyclePermission?: () => void
  /** Ctrl+O live-thinking visibility toggle; absent = binding ignored. */
  readonly onToggleThinking?: () => void
}

export function InputEditor(props: InputEditorProps): ReactElement {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const characters = useMemo(() => Array.from(value), [value])

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        props.onControlC()
        return
      }
      if (key.escape) {
        // Interrupt takes priority while a turn runs; otherwise a non-empty
        // draft is cleared first so retyping never fights the transcript.
        if (!props.running && characters.length > 0) {
          setValue('')
          setCursor(0)
        } else {
          props.onEscape()
        }
        return
      }
      if (key.tab && key.shift) {
        props.onCyclePermission?.()
        return
      }
      if (key.ctrl && input === 'o') {
        props.onToggleThinking?.()
        return
      }
      if (key.ctrl && input === 'u') {
        setValue('')
        setCursor(0)
        return
      }
      if (key.ctrl && input === 'w') {
        removeWordBeforeCursor()
        return
      }
      const code = input.codePointAt(0)
      if (
        shouldSwallowImeKeypress({
          ...(key.return ? { name: 'return' } : {}),
          ...(code === undefined ? {} : { code }),
        })
      ) {
        return
      }
      if (key.return) {
        if (key.shift || key.meta) insert('\n')
        else if (characters[cursor - 1] === '\\') {
          // A trailing backslash turns Enter into a hard newline instead of
          // submitting; the backslash itself is consumed.
          setValue([...characters.slice(0, cursor - 1), '\n', ...characters.slice(cursor)].join(''))
        } else submit()
        return
      }
      if (key.tab && completions.length > 0) {
        // Tab adopts the first completion; typing further disambiguates.
        const adopted = completions[0] ?? ''
        if (!adopted) return
        setValue(`${adopted} `)
        setCursor(Array.from(adopted).length + 1)
        return
      }
      if (key.leftArrow) setCursor((position) => Math.max(0, position - 1))
      else if (key.rightArrow) setCursor((position) => Math.min(characters.length, position + 1))
      else if (key.home) setCursor(0)
      else if (key.end) setCursor(characters.length)
      else if (key.backspace) removeBeforeCursor()
      else if (key.delete) removeAtCursor()
      else if ((key.upArrow || key.downArrow) && value.length === 0)
        navigateHistory(key.upArrow ? 1 : -1)
      else if (input && !key.ctrl && !key.meta) insert(input)
    },
    { isActive: props.active && !props.locked },
  )

  const insert = (input: string): void => {
    const inserted = Array.from(input)
    setValue([...characters.slice(0, cursor), ...inserted, ...characters.slice(cursor)].join(''))
    setCursor(cursor + inserted.length)
  }

  const removeBeforeCursor = (): void => {
    if (cursor === 0) return
    setValue([...characters.slice(0, cursor - 1), ...characters.slice(cursor)].join(''))
    setCursor(cursor - 1)
  }

  const removeAtCursor = (): void => {
    if (cursor >= characters.length) return
    setValue([...characters.slice(0, cursor), ...characters.slice(cursor + 1)].join(''))
  }

  const removeWordBeforeCursor = (): void => {
    let position = cursor
    while (position > 0 && (characters[position - 1] ?? '').trim() === '') position -= 1
    while (position > 0 && (characters[position - 1] ?? '').trim() !== '') position -= 1
    if (position === cursor) return
    setValue([...characters.slice(0, position), ...characters.slice(cursor)].join(''))
    setCursor(position)
  }

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    setHistory((items) => [...items, value])
    setHistoryIndex(-1)
    setValue('')
    setCursor(0)
    props.onSubmit(value)
  }

  const navigateHistory = (direction: number): void => {
    if (history.length === 0) return
    const next = Math.min(history.length - 1, Math.max(-1, historyIndex + direction))
    setHistoryIndex(next)
    const selected = next < 0 ? '' : (history.at(-(next + 1)) ?? '')
    setValue(selected)
    setCursor(Array.from(selected).length)
  }

  const visible =
    value.split('\n').length >= 8
      ? `[粘贴 ${value.split('\n').length} 行 · 提交后按原文发送]`
      : value
  const visibleCharacters = Array.from(visible)
  const before = visibleCharacters.slice(0, Math.min(cursor, visibleCharacters.length)).join('')
  const current = visibleCharacters[Math.min(cursor, visibleCharacters.length)]
  const after = visibleCharacters
    .slice(Math.min(cursor, visibleCharacters.length) + (current ? 1 : 0))
    .join('')
  const completions = value.startsWith('/')
    ? SLASH_COMMANDS.map((command) => command.name).filter((command) => command.startsWith(value))
    : []

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="round"
        borderColor={props.locked ? props.theme.dim : props.theme.accent}
        paddingX={1}
      >
        <Text color={props.locked ? props.theme.dim : props.theme.accent}>
          {glyphs(props.capabilities).user}{' '}
        </Text>
        <Text>
          {props.locked ? '(输入已锁定)' : before}
          {!props.locked && <Text inverse>{current ?? ' '}</Text>}
          {!props.locked && after}
        </Text>
      </Box>
      {completions.length > 0 && <Text color={props.theme.dim}> {completions.join('  ')}</Text>}
    </Box>
  )
}
