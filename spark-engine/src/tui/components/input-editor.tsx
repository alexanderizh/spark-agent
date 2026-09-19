import { Box, Text, useInput, usePaste } from 'ink'
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'

import {
  formatImageLabel,
  imagePlaceholderText,
  type TurnImageAttachment,
} from '../../images/attachments.js'
import type { ImageInputSeam } from '../../images/seam.js'
import { shouldSwallowImeKeypress } from '../ime-guard.js'
import { SLASH_COMMANDS } from '../slash-commands.js'
import { glyphs, type TerminalCapabilities, type TuiTheme } from '../theme.js'
import {
  admitImage,
  collectSubmittedImages,
  imageBlockNumbers,
  syncImagePlaceholders,
  type DraftBlock,
} from './input-image-blocks.js'
import { PickerRow } from './picker-layout.js'
import { isMouseInput } from './scroll-region.js'

/** One-line feedback shown under the input (clipboard errors, intake hints). */
interface ImageNotice {
  readonly text: string
  readonly tone: 'info' | 'error'
}

/** One row of the slash-command completion menu. */
export interface CompletionEntry {
  readonly name: string
  readonly summary?: string
}

/** Menu rows stay on screen before the list starts scrolling. */
const COMPLETION_MAX_VISIBLE = 8

/** Shown when an image paste lands while a picker/approval owns the keyboard. */
const LOCKED_IMAGE_PASTE_NOTICE =
  '输入当前被选择器或确认提示占用：先按 Enter/Esc 关闭，再按 Ctrl+V 粘贴图片。'

/** Pasted input above either limit is rendered as an atomic collapsed block. */
const PASTE_COLLAPSE_MIN_LINES = 8
const PASTE_COLLAPSE_MIN_CHARACTERS = 1_000

/**
 * Draft block: a collapsed text paste, or an atomic image placeholder. The
 * image helpers operate on the same shape, so both kinds share one model.
 */
type PasteBlock = DraftBlock

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
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\r\n?/g, '\n')
  )
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
  imageNumbers: ReadonlyMap<number, number>,
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
    if (!expanded && block.image !== undefined && block.start >= start && block.end <= end) {
      nodes.push(
        <Text key={`image-${block.id}`} color={theme.accent}>
          {formatImageLabel(block.image, imageNumbers.get(block.id) ?? 1)}
        </Text>,
      )
      position = blockEnd
      continue
    }
    if (!expanded && block.start >= start && block.end <= end) {
      const detail = block.lineCount > 1 ? `${block.lineCount} 行` : `${block.characterCount} 字符`
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
  /** Clipboard/file image intake; absent disables Ctrl+V and path detection. */
  readonly imageInput?: ImageInputSeam
  /** Model `capabilities.images`; false shows a one-time warning hint. */
  readonly supportsImages?: boolean
  readonly onSubmit: (value: string, images: readonly TurnImageAttachment[]) => void
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
  const [imageNotice, setImageNotice] = useState<ImageNotice | undefined>(undefined)
  const [readingImage, setReadingImage] = useState(false)
  const nextPasteId = useRef(1)
  const readingImageRef = useRef(false)
  const imageCapabilityHintShown = useRef(false)
  const characters = useMemo(() => Array.from(value), [value])
  // Clipboard and path reads resolve after the render that started them, so
  // those callbacks have to edit the draft as it stands now: writing back the
  // pre-read snapshot silently dropped every character typed meanwhile.
  const latestEditRef = useRef({ characters, cursor, pasteBlocks })
  useEffect(() => {
    latestEditRef.current = { characters, cursor, pasteBlocks }
  })
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
      // A paste chord can share one stdin chunk with the keystrokes that follow
      // it immediately (`\u0016describe…`). Peel the byte so the picture is read
      // *and* the text still lands, instead of inserting an invisible control
      // character and silently losing the image.
      if (input.length > 1 && input.startsWith('\u0016')) {
        requestClipboardImage()
        insert(input.slice(1), true)
        return
      }
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
      if (isImagePasteKey(input, key, props.imageInput?.altVPaste === true)) {
        requestClipboardImage()
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
      // A picture has no text representation, so terminals that route the
      // paste chord through their own paste channel deliver an *empty*
      // bracketed paste. That empty event is the only evidence that a picture
      // arrived; dropping it silently is what read as "Ctrl+V does nothing".
      if (!text) {
        if (props.locked) {
          setImageNotice({ text: LOCKED_IMAGE_PASTE_NOTICE, tone: 'info' })
          return
        }
        requestClipboardImage()
        return
      }
      // A locked editor keeps dropping pasted text, exactly as before.
      if (props.locked || !props.active) return
      if (attachPastedImagePath(text)) return
      insert(text, true)
    },
    { isActive: props.active || props.locked },
  )

  // A picker or an approval prompt owns the keyboard, so the editor's own
  // handler is inactive there. Image intake stays on a narrow channel anyway:
  // it collides with none of those keys, and a paste that changes nothing at
  // all is indistinguishable from a broken shortcut.
  useInput(
    (input, key) => {
      if (isImagePasteKey(input, key, props.imageInput?.altVPaste === true)) {
        setImageNotice({ text: LOCKED_IMAGE_PASTE_NOTICE, tone: 'info' })
      }
    },
    { isActive: props.locked },
  )

  function moveCursorAcrossPaste(position: number, direction: -1 | 1): number {
    if (pastesExpanded) {
      return direction === -1
        ? Math.max(0, position - 1)
        : Math.min(characters.length, position + 1)
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

  function replaceCharacters(
    start: number,
    removedLength: number,
    inserted: readonly string[],
  ): void {
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
    // Async callers arrive after a render; the ref holds the current draft.
    const { characters, cursor, pasteBlocks } = latestEditRef.current
    setHistoryIndex(-1)
    const shiftedBlocks = shiftPasteBlocksAfterInsertion(pasteBlocks, cursor, inserted.length)
    const nextBlocks =
      shouldCollapsePaste(input) && pasted
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

  /**
   * Reads the clipboard and turns the picture into an atomic placeholder.
   * The read is async; `readingImageRef` keeps a held-down Ctrl+V from
   * queueing several reads while the first one is still running.
   */
  function requestClipboardImage(): void {
    const reader = props.imageInput
    if (reader === undefined || readingImageRef.current) return
    readingImageRef.current = true
    setReadingImage(true)
    void reader
      .readClipboard()
      .then((result) => {
        if (result.ok) insertImage(result.image)
        else setImageNotice({ text: result.message, tone: 'error' })
      })
      .catch((error: unknown) => {
        setImageNotice({
          text: `读取剪贴板图片失败：${error instanceof Error ? error.message : String(error)}`,
          tone: 'error',
        })
      })
      .finally(() => {
        readingImageRef.current = false
        setReadingImage(false)
      })
  }

  /**
   * A dropped image file arrives as text; when the whole paste is one existing
   * image path it becomes an attachment instead of literal path text.
   */
  function attachPastedImagePath(text: string): boolean {
    const reader = props.imageInput
    if (reader === undefined || text.includes('\n')) return false
    // Strip surrounding quoting before the cheap extension gate: terminals
    // quote or escape a dropped path, and `normalizePastedPath` unwraps it
    // afterwards. Only the gate needs to tolerate the wrapping.
    const candidate = text.trim().replace(/^["']|["']$/g, '')
    if (!/\.[a-z0-9]+$/i.test(candidate)) return false
    void reader.resolveFilePath(text).then(async (path) => {
      if (path === undefined) {
        insert(text, true)
        return
      }
      const result = await reader.readFile(path)
      if (!result.ok) {
        insert(text, true)
        return
      }
      insertImage(result.image)
      setImageNotice({
        text: `已识别图片路径并附加为图片：${result.image.name ?? path}（删除该块即可撤销）`,
        tone: 'info',
      })
    })
    return true
  }

  /** Inserts `[Image #N]` as an atomic block at the caret. */
  function insertImage(image: TurnImageAttachment): void {
    const { characters, cursor, pasteBlocks } = latestEditRef.current
    const admission = admitImage(pasteBlocks, image)
    if (!admission.ok) {
      setImageNotice({ text: admission.message, tone: 'error' })
      return
    }
    const index = imageBlockNumbers(pasteBlocks).size + 1
    const placeholder = imagePlaceholderText(index)
    const inserted = Array.from(placeholder)
    const shifted = shiftPasteBlocksAfterInsertion(pasteBlocks, cursor, inserted.length)
    const blockId = nextPasteId.current++
    const nextBlocks = [
      ...shifted,
      {
        id: blockId,
        start: cursor,
        end: cursor + inserted.length,
        lineCount: 1,
        characterCount: inserted.length,
        image,
      },
    ].sort((left, right) => left.start - right.start)
    const nextText = [
      ...characters.slice(0, cursor),
      ...inserted,
      ...characters.slice(cursor),
    ].join('')
    // Renumbering keeps placeholder text and attachment order in lockstep.
    const synced = syncImagePlaceholders(nextText, nextBlocks)
    const own = synced.blocks.find((block) => block.id === blockId)
    setHistoryIndex(-1)
    setValue(synced.text)
    setPasteBlocks(synced.blocks)
    setPastesExpanded(false)
    setCursor(own?.end ?? cursor + inserted.length)
    setPreferredColumn(undefined)
    setImageNotice(
      props.supportsImages === false && !imageCapabilityHintShown.current
        ? { text: '当前模型未声明图片输入能力，仍会尝试发送。', tone: 'info' }
        : undefined,
    )
    if (props.supportsImages === false) imageCapabilityHintShown.current = true
  }

  function submit(): void {
    submitValue(value, pasteBlocks)
  }

  function submitValue(raw: string, rawPasteBlocks: readonly PasteBlock[] = []): void {
    if (!raw.trim()) return
    // Only placeholders still present in the text are sent; the rest of the
    // draft goes out unchanged.
    const images = collectSubmittedImages(raw, rawPasteBlocks)
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
    setImageNotice(undefined)
    setCursor(0)
    setPreferredColumn(undefined)
    props.onSubmit(raw, images)
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
  const imageNumbers = imageBlockNumbers(pasteBlocks)
  const hasImageBlocks = imageNumbers.size > 0
  const cursorAtCollapsedPaste =
    !pastesExpanded && pasteBlocks.some((block) => block.start === visibleCursor)
  const before = renderDraftSlice(
    visibleCharacters,
    pasteBlocks,
    0,
    visibleCursor,
    pastesExpanded,
    imageNumbers,
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
    imageNumbers,
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
          {hasImageBlocks ? ' Ctrl+V 粘贴图片 ·' : ''}
          {pastesExpanded ? ' Ctrl+E 折叠粘贴' : ' Ctrl+E 展开粘贴'} · Backspace/Delete 删除整块
        </Text>
      )}
      {readingImage && !props.locked && <Text color={props.theme.dim}> 正在读取剪贴板图片…</Text>}
      {imageNotice !== undefined && (
        <Text color={imageNotice.tone === 'error' ? props.theme.error : props.theme.dim}>
          {' '}
          {imageNotice.text}
        </Text>
      )}
    </Box>
  )
}

/**
 * Ctrl+V (or Alt+V on Windows/WSL terminals, which reserve Ctrl+V for their
 * own paste) requests a clipboard image read. Terminals deliver the chord
 * either as `input: 'v'` with a modifier flag or as the raw C0 byte.
 */
export function isImagePasteKey(
  input: string,
  key: { readonly ctrl: boolean; readonly meta: boolean },
  altVPaste: boolean,
): boolean {
  // `\u0016` *is* Ctrl+V, so the byte alone is authoritative: a terminal or
  // input layer that resolves the chord without setting the parsed ctrl flag
  // would otherwise let the control character fall through into the draft
  // (invisible and seemingly ignored).
  if (input === '\u0016') return true
  return input === 'v' && (key.ctrl || (altVPaste && key.meta))
}
