import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useState, type ReactElement } from 'react'

import { shouldSwallowImeKeypress } from '../ime-guard.js'
import { SLASH_COMMANDS } from '../slash-commands.js'
import { glyphs, type TerminalCapabilities, type TuiTheme } from '../theme.js'
import { PickerRow } from './picker-layout.js'
import { isMouseInput } from './scroll-region.js'

/** One row of the slash-command completion menu. */
export interface CompletionEntry {
  readonly name: string
  readonly summary?: string
}

/** Menu rows stay on screen before the list starts scrolling. */
const COMPLETION_MAX_VISIBLE = 8

export interface InputEditorProps {
  readonly active: boolean
  readonly locked: boolean
  /** True while an agent turn is running; Esc then always means interrupt. */
  readonly running?: boolean
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
  /** Custom slash commands (full names, `/name`) offered alongside builtins. */
  readonly extraCommands?: readonly CompletionEntry[]
  readonly onSubmit: (value: string) => void
  readonly onEscape: () => void
  readonly onControlC: () => void
  /** Shift+Tab permission-mode cycling; absent = binding ignored. */
  readonly onCyclePermission?: () => void
  /** Ctrl+O live-thinking visibility toggle; absent = binding ignored. */
  readonly onToggleThinking?: () => void
}

interface VerticalCursorMove {
  readonly cursor: number
  readonly preferredColumn: number
}

/** Move between logical lines while retaining the requested horizontal column. */
function moveCursorVertically(
  characters: readonly string[],
  cursor: number,
  direction: -1 | 1,
  preferredColumn: number | undefined,
): VerticalCursorMove {
  let currentStart = cursor
  while (currentStart > 0 && characters[currentStart - 1] !== '\n') currentStart -= 1

  let currentEnd = cursor
  while (currentEnd < characters.length && characters[currentEnd] !== '\n') currentEnd += 1

  const targetColumn = preferredColumn ?? cursor - currentStart
  if (direction === -1) {
    if (currentStart === 0) return { cursor, preferredColumn: targetColumn }
    const previousEnd = currentStart - 1
    let previousStart = previousEnd
    while (previousStart > 0 && characters[previousStart - 1] !== '\n') previousStart -= 1
    return {
      cursor: Math.min(previousStart + targetColumn, previousEnd),
      preferredColumn: targetColumn,
    }
  }

  if (currentEnd === characters.length) return { cursor, preferredColumn: targetColumn }
  const nextStart = currentEnd + 1
  let nextEnd = nextStart
  while (nextEnd < characters.length && characters[nextEnd] !== '\n') nextEnd += 1
  return {
    cursor: Math.min(nextStart + targetColumn, nextEnd),
    preferredColumn: targetColumn,
  }
}

export function InputEditor(props: InputEditorProps): ReactElement {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  // Keep the intended horizontal column while moving across short lines.
  const [preferredColumn, setPreferredColumn] = useState<number | undefined>()
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [completionIndex, setCompletionIndex] = useState(0)
  const characters = useMemo(() => Array.from(value), [value])
  const symbols = glyphs(props.capabilities)

  const commandEntries = useMemo<readonly CompletionEntry[]>(
    () => [
      ...SLASH_COMMANDS.map((command) => ({ name: command.name, summary: command.summary })),
      ...(props.extraCommands ?? []),
    ],
    [props.extraCommands],
  )
  const completions = useMemo(
    () =>
      value.startsWith('/') ? commandEntries.filter((entry) => entry.name.startsWith(value)) : [],
    [commandEntries, value],
  )
  // Typing reshapes the candidate list; the highlight restarts from the top.
  useEffect(() => {
    setCompletionIndex(0)
  }, [value])
  const selectedCompletion = Math.min(completionIndex, completions.length - 1)

  useInput(
    (input, key) => {
      if (isMouseInput(input)) return
      if (key.ctrl && input === 'c') {
        props.onControlC()
        return
      }
      if (key.escape) {
        // Interrupt takes priority while a turn runs; otherwise a non-empty
        // draft is cleared first so retyping never fights the transcript.
        if (!props.running && characters.length > 0) {
          setHistoryIndex(-1)
          setValue('')
          setCursor(0)
          setPreferredColumn(undefined)
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
        setHistoryIndex(-1)
        setValue('')
        setCursor(0)
        setPreferredColumn(undefined)
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
      if (key.upArrow && completions.length > 0) {
        setCompletionIndex(
          (index) =>
            (Math.min(index, completions.length - 1) + completions.length - 1) % completions.length,
        )
        return
      }
      if (key.downArrow && completions.length > 0) {
        setCompletionIndex(
          (index) => (Math.min(index, completions.length - 1) + 1) % completions.length,
        )
        return
      }
      if (key.tab && completions.length > 0) {
        adoptCompletion(completions[selectedCompletion]?.name)
        return
      }
      if (key.return) {
        if (key.shift || key.meta) insert('\n')
        else if (characters[cursor - 1] === '\\') {
          // A trailing backslash turns Enter into a hard newline instead of
          // submitting; the backslash itself is consumed.
          setValue([...characters.slice(0, cursor - 1), '\n', ...characters.slice(cursor)].join(''))
          setPreferredColumn(undefined)
        } else if (completions.length > 0 && selectedCompletion >= 0) {
          // Menu open: Enter runs the highlighted command instead of the raw
          // partial text (which the dispatcher would reject as unknown).
          const adopted = completions[selectedCompletion]?.name
          if (adopted) submitValue(adopted)
        } else submit()
        return
      }
      if (key.leftArrow) {
        setPreferredColumn(undefined)
        setCursor((position) => Math.max(0, position - 1))
      } else if (key.rightArrow) {
        setPreferredColumn(undefined)
        setCursor((position) => Math.min(characters.length, position + 1))
      } else if (key.home) {
        setPreferredColumn(undefined)
        setCursor(0)
      } else if (key.end) {
        setPreferredColumn(undefined)
        setCursor(characters.length)
      } else if (key.backspace) removeBeforeCursor()
      else if (key.delete) removeAtCursor()
      else if (key.upArrow || key.downArrow) {
        if (value.length === 0 || historyIndex >= 0) {
          // Keep the existing history behavior for an empty draft.
          navigateHistory(key.upArrow ? 1 : -1)
        } else if (value.includes('\n')) {
          const moved = moveCursorVertically(
            characters,
            cursor,
            key.upArrow ? -1 : 1,
            preferredColumn,
          )
          setCursor(moved.cursor)
          setPreferredColumn(moved.preferredColumn)
        }
      } else if (input && !key.ctrl && !key.meta) insert(input)
    },
    { isActive: props.active && !props.locked },
  )

  const insert = (input: string): void => {
    setHistoryIndex(-1)
    const inserted = Array.from(input)
    setValue([...characters.slice(0, cursor), ...inserted, ...characters.slice(cursor)].join(''))
    setCursor(cursor + inserted.length)
    setPreferredColumn(undefined)
  }

  const removeBeforeCursor = (): void => {
    if (cursor === 0) return
    setHistoryIndex(-1)
    setValue([...characters.slice(0, cursor - 1), ...characters.slice(cursor)].join(''))
    setCursor(cursor - 1)
    setPreferredColumn(undefined)
  }

  const removeAtCursor = (): void => {
    setHistoryIndex(-1)
    if (cursor >= characters.length) return
    setValue([...characters.slice(0, cursor), ...characters.slice(cursor + 1)].join(''))
    setPreferredColumn(undefined)
  }

  const removeWordBeforeCursor = (): void => {
    setHistoryIndex(-1)
    let position = cursor
    while (position > 0 && (characters[position - 1] ?? '').trim() === '') position -= 1
    while (position > 0 && (characters[position - 1] ?? '').trim() !== '') position -= 1
    if (position === cursor) return
    setValue([...characters.slice(0, position), ...characters.slice(cursor)].join(''))
    setCursor(position)
    setPreferredColumn(undefined)
  }

  const submit = (): void => {
    submitValue(value)
  }

  const submitValue = (raw: string): void => {
    if (!raw.trim()) return
    setHistory((items) => [...items, raw])
    setHistoryIndex(-1)
    setValue('')
    setCursor(0)
    setPreferredColumn(undefined)
    props.onSubmit(raw)
  }

  /** Puts a menu entry into the input with a trailing space for arguments. */
  const adoptCompletion = (name: string | undefined): void => {
    if (!name) return
    setValue(`${name} `)
    setCursor(Array.from(name).length + 1)
    setPreferredColumn(undefined)
  }

  const navigateHistory = (direction: number): void => {
    if (history.length === 0) return
    const next = Math.min(history.length - 1, Math.max(-1, historyIndex + direction))
    setHistoryIndex(next)
    const selected = next < 0 ? '' : (history.at(-(next + 1)) ?? '')
    setValue(selected)
    setCursor(Array.from(selected).length)
    setPreferredColumn(undefined)
  }

  const visibleCharacters = Array.from(value)
  const visibleCursor = Math.min(cursor, visibleCharacters.length)
  const before = visibleCharacters.slice(0, visibleCursor).join('')
  const current = visibleCharacters[visibleCursor]
  const after = visibleCharacters.slice(visibleCursor + (current ? 1 : 0)).join('')

  // Sliding window so long custom-command lists never push the input away.
  const windowStart = Math.max(
    0,
    Math.min(
      selectedCompletion - (COMPLETION_MAX_VISIBLE - 1),
      completions.length - COMPLETION_MAX_VISIBLE,
    ),
  )
  const visibleCompletions = completions.slice(windowStart, windowStart + COMPLETION_MAX_VISIBLE)

  return (
    <Box flexDirection="column">
      {completions.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {visibleCompletions.map((entry, offset) => {
            const index = windowStart + offset
            const highlighted = index === selectedCompletion
            return (
              <PickerRow
                key={entry.name}
                selected={highlighted}
                theme={props.theme}
                capabilities={props.capabilities}
              >
                <Text color={highlighted ? props.theme.accent : props.theme.dim}>
                  {highlighted ? `${symbols.user} ` : '  '}
                  {entry.name}
                </Text>
                {entry.summary ? <Text color={props.theme.dim}> {entry.summary}</Text> : null}
              </PickerRow>
            )
          })}
          {completions.length > COMPLETION_MAX_VISIBLE && (
            <Text color={props.theme.dim}>
              {'  '}… 共 {completions.length} 条 · ↑↓ 翻看
            </Text>
          )}
        </Box>
      )}
      <Box
        borderStyle="round"
        borderColor={props.locked ? props.theme.dim : props.theme.accent}
        paddingX={1}
      >
        <Text color={props.locked ? props.theme.dim : props.theme.accent}>{symbols.user} </Text>
        <Text>
          {props.locked ? '(输入已锁定)' : before}
          {!props.locked &&
            (current === '\n' ? (
              <>
                <Text inverse> </Text>
                {'\n'}
              </>
            ) : (
              <Text inverse>{current ?? ' '}</Text>
            ))}
          {!props.locked && after}
        </Text>
      </Box>
      {props.running && !props.locked && (
        <Text color={props.theme.dim}> Enter 加入队列 · Esc 中断当前任务</Text>
      )}
    </Box>
  )
}
