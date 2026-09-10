import { Box, Text, useInput, usePaste } from 'ink'
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'

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

/** Pasted input above either limit is rendered as an atomic collapsed block. */
const PASTE_COLLAPSE_MIN_LINES = 8
const PASTE_COLLAPSE_MIN_CHARACTERS = 1_000

interface PasteBlock {
  readonly id: number
  readonly start: number
  readonly end: number
  readonly lineCount: number
  readonly characterCount: number
}

interface HistoryEntry {
  readonly value: string
  readonly pasteBlocks: readonly PasteBlock[]
}

function pasteLineCount(text: string): number {
  return Math.max(1, text.split(/\r\n|\r|\n/).length)
}

function shouldCollapsePaste(text: string): boolean {
  const characterCount = Array.from(text).length
  return (
    pasteLineCount(text) >= PASTE_COLLAPSE_MIN_LINES ||
    characterCount >= PASTE_COLLAPSE_MIN_CHARACTERS
  )
}

/** Keep pasted terminal control sequences from becoming terminal commands when displayed. */
function sanitizeDisplayText(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
}

function sliceCharacters(characters: readonly string[], start: number, end: number): string {
  return characters.slice(start, end).join('')
}

function shiftPasteBlocksAfterInsertion(
  blocks: readonly PasteBlock[],
  position: number,
  insertedLength: number,
): PasteBlock[] {
  if (insertedLength === 0) return [...blocks]
  return blocks.flatMap((block) => {
    if (block.end <= position) return [block]
    if (block.start >= position) {
      return [
        {
          ...block,
          start: block.start + insertedLength,
          end: block.end + insertedLength,
        },
      ]
    }
    // Editing inside a collapsed block turns it into ordinary text.
    return []
  })
}

function shiftPasteBlocksAfterDeletion(
  blocks: readonly PasteBlock[],
  start: number,
  deletedLength: number,
): PasteBlock[] {
  if (deletedLength === 0) return [...blocks]
  const end = start + deletedLength
  return blocks.flatMap((block) => {
    if (block.end <= start) return [block]
    if (block.start >= end) {
      return [
        {
          ...block,
          start: block.start - deletedLength,
          end: block.end - deletedLength,
        },
      ]
    }
    // A partial edit cannot leave a stale range pointing at the wrong text.
    return []
  })
}

function renderDraftSlice(
  characters: readonly string[],
  blocks: readonly PasteBlock[],
  start: number,
  end: number,
  expanded: boolean,
  theme: TuiTheme,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let position = start
  for (const block of blocks) {
    if (block.end <= start) continue
    if (block.start >= end) break

    const blockStart = Math.max(start, block.start)
    if (blockStart > position) {
      nodes.push(sanitizeDisplayText(sliceCharacters(characters, position, blockStart)))
    }

    const blockEnd = Math.min(end, block.end)
    if (!expanded && block.start >= start && block.end <= end) {
      const detail =
        block.lineCount > 1
          ? `${block.lineCount} 行`
          : `${block.characterCount} 字符`
      nodes.push(
        <Text key={`paste-${block.id}`} color={theme.accent}>
          [已粘贴文本 #{block.id} · {detail}]
        </Text>,
      )
    } else {
      nodes.push(sanitizeDisplayText(sliceCharacters(characters, blockStart, blockEnd)))
    }
    position = blockEnd
  }

  if (position < end) {
    nodes.push(sanitizeDisplayText(sliceCharacters(characters, position, end)))
  }
  return nodes
}

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
  const [pasteBlocks, setPasteBlocks] = useState<readonly PasteBlock[]>([])
  const [pastesExpanded, setPastesExpanded] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [completionIndex, setCompletionIndex] = useState(0)
  const nextPasteId = useRef(1)
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
          setPasteBlocks([])
          setPastesExpanded(false)
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
      if (key.ctrl && input === 'e') {
        if (pasteBlocks.length > 0) setPastesExpanded((expanded) => !expanded)
        return
      }
      if (key.ctrl && input === 'u') {
        setHistoryIndex(-1)
        setValue('')
        setPasteBlocks([])
        setPastesExpanded(false)
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
          replaceCharacters(cursor - 1, 1, ['\n'])
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
        setCursor((position) => moveCursorAcrossPaste(position, -1))
      } else if (key.rightArrow) {
        setPreferredColumn(undefined)
        setCursor((position) => moveCursorAcrossPaste(position, 1))
      } else if (key.home) {
        setPreferredColumn(undefined)
        setCursor(0)
      } else if (key.end) {
        setPreferredColumn(undefined)
        setCursor(characters.length)
      } else if (key.backspace) removeBeforeCursor()
      else if (key.delete) removeAtCursor()
      else if (key.upArrow || key.downArrow) {
        if (characters.length === 0 || historyIndex >= 0) {
          // Keep the existing history behavior for an empty draft.
          navigateHistory(key.upArrow ? 1 : -1)
        } else if (value.includes('\n')) {
          const moved = moveCursorVertically(
            characters,
            cursor,
            key.upArrow ? -1 : 1,
            preferredColumn,
          )
          setCursor(clampCursorAroundPaste(moved.cursor, key.upArrow ? -1 : 1))
          setPreferredColumn(moved.preferredColumn)
        }
      } else if (input && !key.ctrl && !key.meta) insert(input, input.length > 1)
    },
    { isActive: props.active && !props.locked },
  )

  // Ink's bracketed-paste channel keeps multiline input out of key handling,
  // so the editor can represent it as one stable visual block.
  usePaste(
    (text) => {
      if (text) insert(text, true)
    },
    { isActive: props.active && !props.locked },
  )

  function moveCursorAcrossPaste(position: number, direction: -1 | 1): number {
    if (pastesExpanded) {
      return direction === -1 ? Math.max(0, position - 1) : Math.min(characters.length, position + 1)
    }
    for (const block of pasteBlocks) {
      if (direction === -1 && position > block.start && position <= block.end) {
        return block.start
      }
      if (direction === 1 && position >= block.start && position < block.end) {
        return block.end
      }
    }
    return direction === -1 ? Math.max(0, position - 1) : Math.min(characters.length, position + 1)
  }

  function clampCursorAroundPaste(position: number, direction: -1 | 1): number {
    if (pastesExpanded) return position
    for (const block of pasteBlocks) {
      if (position > block.start && position < block.end) {
        return direction === -1 ? block.start : block.end
      }
    }
    return position
  }

  function replaceCharacters(start: number, removedLength: number, inserted: readonly string[]): void {
    const nextCharacters = [
      ...characters.slice(0, start),
      ...inserted,
      ...characters.slice(start + removedLength),
    ]
    const afterDelete = shiftPasteBlocksAfterDeletion(pasteBlocks, start, removedLength)
    const nextBlocks = shiftPasteBlocksAfterInsertion(afterDelete, start, inserted.length)
    setValue(nextCharacters.join(''))
    setPasteBlocks(nextBlocks)
    if (nextBlocks.length === 0) setPastesExpanded(false)
  }

  function insert(input: string, pasted = false): void {
    const inserted = Array.from(input)
    if (inserted.length === 0) return
    setHistoryIndex(-1)
    const shiftedBlocks = shiftPasteBlocksAfterInsertion(pasteBlocks, cursor, inserted.length)
    const nextBlocks = shouldCollapsePaste(input) && pasted
      ? [
          ...shiftedBlocks,
          {
            id: nextPasteId.current++,
            start: cursor,
            end: cursor + inserted.length,
            lineCount: pasteLineCount(input),
            characterCount: inserted.length,
          },
        ].sort((left, right) => left.start - right.start)
      : shiftedBlocks
    setValue([...characters.slice(0, cursor), ...inserted, ...characters.slice(cursor)].join(''))
    setPasteBlocks(nextBlocks)
    if (nextBlocks.length > shiftedBlocks.length) setPastesExpanded(false)
    setCursor(cursor + inserted.length)
    setPreferredColumn(undefined)
  }

  function removeBeforeCursor(): void {
    if (cursor === 0) return
    setHistoryIndex(-1)
    const block = pastesExpanded
      ? undefined
      : pasteBlocks.find((candidate) => cursor > candidate.start && cursor <= candidate.end)
    const start = block?.start ?? cursor - 1
    const length = block?.end === undefined ? 1 : block.end - block.start
    replaceCharacters(start, length, [])
    setCursor(start)
    setPreferredColumn(undefined)
  }

  function removeAtCursor(): void {
    setHistoryIndex(-1)
    if (cursor >= characters.length) return
    const block = pastesExpanded
      ? undefined
      : pasteBlocks.find((candidate) => cursor >= candidate.start && cursor < candidate.end)
    const start = block?.start ?? cursor
    const length = block?.end === undefined ? 1 : block.end - block.start
    replaceCharacters(start, length, [])
    setPreferredColumn(undefined)
  }

  function removeWordBeforeCursor(): void {
    setHistoryIndex(-1)
    let position = cursor
    while (position > 0 && (characters[position - 1] ?? '').trim() === '') position -= 1
    while (position > 0 && (characters[position - 1] ?? '').trim() !== '') position -= 1
    if (position === cursor) return
    const overlappingBlock = pasteBlocks.find(
      (block) => block.start < cursor && block.end > position,
    )
    const start = overlappingBlock?.start ?? position
    replaceCharacters(start, cursor - start, [])
    setCursor(start)
    setPreferredColumn(undefined)
  }

  function submit(): void {
    submitValue(value, pasteBlocks)
  }

  function submitValue(raw: string, rawPasteBlocks: readonly PasteBlock[] = []): void {
    if (!raw.trim()) return
    setHistory((items) => [
      ...items,
      {
        value: raw,
        pasteBlocks: rawPasteBlocks.map((block) => ({ ...block })),
      },
    ])
    setHistoryIndex(-1)
    setValue('')
    setPasteBlocks([])
    setPastesExpanded(false)
    setCursor(0)
    setPreferredColumn(undefined)
    props.onSubmit(raw)
  }

  /** Puts a menu entry into the input with a trailing space for arguments. */
  function adoptCompletion(name: string | undefined): void {
    if (!name) return
    setValue(`${name} `)
    setPasteBlocks([])
    setPastesExpanded(false)
    setCursor(Array.from(name).length + 1)
    setPreferredColumn(undefined)
  }

  function navigateHistory(direction: number): void {
    if (history.length === 0) return
    const next = Math.min(history.length - 1, Math.max(-1, historyIndex + direction))
    setHistoryIndex(next)
    const selected = next < 0 ? undefined : history.at(-(next + 1))
    const selectedValue = selected?.value ?? ''
    setValue(selectedValue)
    setPasteBlocks(selected?.pasteBlocks ?? [])
    setPastesExpanded(false)
    setCursor(Array.from(selectedValue).length)
    setPreferredColumn(undefined)
  }

  const visibleCharacters = characters
  const visibleCursor = Math.min(cursor, visibleCharacters.length)
  const cursorAtCollapsedPaste =
    !pastesExpanded && pasteBlocks.some((block) => block.start === visibleCursor)
  const before = renderDraftSlice(
    visibleCharacters,
    pasteBlocks,
    0,
    visibleCursor,
    pastesExpanded,
    props.theme,
  )
  const current = visibleCharacters[visibleCursor]
  const currentIsLineBreak = current === '\n' || current === '\r'
  const afterStart =
    cursorAtCollapsedPaste || current === undefined
      ? visibleCursor
      : current === '\r' && visibleCharacters[visibleCursor + 1] === '\n'
        ? visibleCursor + 2
        : visibleCursor + 1
  const after = renderDraftSlice(
    visibleCharacters,
    pasteBlocks,
    afterStart,
    visibleCharacters.length,
    pastesExpanded,
    props.theme,
  )

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
            (cursorAtCollapsedPaste ? (
              <Text inverse> </Text>
            ) : currentIsLineBreak ? (
              <>
                <Text inverse> </Text>
                {'\n'}
              </>
            ) : (
              <Text inverse>{sanitizeDisplayText(current ?? '') || ' '}</Text>
            ))}
          {!props.locked && after}
        </Text>
      </Box>
      {pasteBlocks.length > 0 && !props.locked && (
        <Text color={props.theme.dim}>
          {pastesExpanded ? ' Ctrl+E 折叠粘贴' : ' Ctrl+E 展开粘贴'} · Backspace/Delete 删除整块
        </Text>
      )}
      {props.running && !props.locked && (
        <Text color={props.theme.dim}> Enter 加入队列 · Esc 中断当前任务</Text>
      )}
    </Box>
  )
}
