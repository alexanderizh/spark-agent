import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ClipboardEventHandler,
  type CompositionEventHandler,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
} from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type EditorConfig,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  TextNode,
} from 'lexical'

export type ComposerTokenKind = 'command' | 'skill'

export type ComposerLexicalInputProps = {
  value?: string
  initialValue?: string
  commandNames?: readonly string[]
  skillNames?: readonly string[]
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  onChange(value: string): void
  onKeyDown?: KeyboardEventHandler<HTMLElement>
  onCompositionStart?: CompositionEventHandler<HTMLElement>
  onCompositionEnd?: CompositionEventHandler<HTMLElement>
  onPaste?: ClipboardEventHandler<HTMLElement>
  onBlur?: FocusEventHandler<HTMLElement>
  onContextMenu?: MouseEventHandler<HTMLElement>
}

export type ComposerSelection = { start: number; end: number }

export type ComposerLexicalInputHandle = {
  focus(): void
  getValue(): string
  getSelection(): ComposerSelection
  setSelectionRange(start: number, end: number): void
  select(): void
  replaceSelection(text: string): void
  getElement(): HTMLElement | null
}

type ComposerToken = {
  kind: ComposerTokenKind
  text: string
}

type SerializedComposerTokenNode = SerializedTextNode & {
  type: 'composer-token'
  tokenKind: ComposerTokenKind
  version: 1
}

/**
 * A single Lexical text node that is styled as a token and deleted atomically.
 * Keeping the token as a TextNode preserves Lexical's native selection and IME
 * behavior; the DOM is only a projection of the editor state.
 */
export class ComposerTokenNode extends TextNode {
  readonly __tokenKind: ComposerTokenKind

  static override getType(): string {
    return 'composer-token'
  }

  static override clone(node: ComposerTokenNode): ComposerTokenNode {
    return new ComposerTokenNode(node.__text, node.__tokenKind, node.__key)
  }

  constructor(text: string, tokenKind: ComposerTokenKind, key?: NodeKey) {
    super(text, key)
    this.__tokenKind = tokenKind
    if (key == null) this.setMode('token')
  }

  static override importJSON(serializedNode: SerializedComposerTokenNode): ComposerTokenNode {
    return $createComposerTokenNode(serializedNode.text, serializedNode.tokenKind).updateFromJSON(
      serializedNode,
    )
  }

  override exportJSON(): SerializedComposerTokenNode {
    return {
      ...super.exportJSON(),
      type: 'composer-token',
      tokenKind: this.__tokenKind,
      version: 1,
    }
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.dataset.composerTokenKind = this.__tokenKind
    element.classList.add('composer-input-token', `is-${this.__tokenKind}`)
    return element
  }

  override updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const replaceDOM = super.updateDOM(prevNode, dom, config)
    if (replaceDOM) return true
    dom.dataset.composerTokenKind = this.__tokenKind
    dom.classList.add('composer-input-token', `is-${this.__tokenKind}`)
    return false
  }

  override canInsertTextBefore(): false {
    return false
  }

  override canInsertTextAfter(): false {
    return false
  }
}

export function $createComposerTokenNode(
  text: string,
  tokenKind: ComposerTokenKind,
): ComposerTokenNode {
  return $applyNodeReplacement(new ComposerTokenNode(text, tokenKind))
}

export function $isComposerTokenNode(
  node: LexicalNode | null | undefined,
): node is ComposerTokenNode {
  return node instanceof ComposerTokenNode
}

export const ComposerLexicalInput = forwardRef<
  ComposerLexicalInputHandle,
  ComposerLexicalInputProps
>(function ComposerLexicalInput(
  {
    value,
    initialValue = '',
    commandNames = [],
    skillNames = [],
    placeholder = '输入消息',
    disabled = false,
    readOnly = false,
    onChange,
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
    onPaste,
    onBlur,
    onContextMenu,
  },
  ref,
) {
  const initialValueRef = useRef(value ?? initialValue)
  const initialCommandNamesRef = useRef(commandNames)
  const initialSkillNamesRef = useRef(skillNames)
  const initialConfig = useMemo(
    () => ({
      namespace: 'SparkComposerLexicalInput',
      nodes: [ComposerTokenNode],
      editable: true,
      theme: {
        paragraph: 'composer-input-paragraph',
      },
      editorState: () => {
        $replaceComposerValue(
          initialValueRef.current,
          initialCommandNamesRef.current,
          initialSkillNamesRef.current,
        )
      },
      onError(error: Error) {
        throw error
      },
    }),
    [],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ComposerLexicalInputController
        ref={ref}
        value={value ?? initialValue}
        commandNames={commandNames}
        skillNames={skillNames}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onPaste={onPaste}
        onBlur={onBlur}
        onContextMenu={onContextMenu}
      />
    </LexicalComposer>
  )
})

type ComposerLexicalInputControllerProps = Omit<
  ComposerLexicalInputProps,
  | 'initialValue'
  | 'value'
  | 'onKeyDown'
  | 'onCompositionStart'
  | 'onCompositionEnd'
  | 'onPaste'
  | 'onBlur'
  | 'onContextMenu'
> & {
  value: string
  onChange(value: string): void
  onKeyDown?: KeyboardEventHandler<HTMLElement> | undefined
  onCompositionStart?: CompositionEventHandler<HTMLElement> | undefined
  onCompositionEnd?: CompositionEventHandler<HTMLElement> | undefined
  onPaste?: ClipboardEventHandler<HTMLElement> | undefined
  onBlur?: FocusEventHandler<HTMLElement> | undefined
  onContextMenu?: MouseEventHandler<HTMLElement> | undefined
}

const ComposerLexicalInputController = forwardRef<
  ComposerLexicalInputHandle,
  ComposerLexicalInputControllerProps
>(function ComposerLexicalInputController(
  {
    value,
    commandNames = [],
    skillNames = [],
    placeholder,
    disabled = false,
    readOnly = false,
    onChange,
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
    onPaste,
    onBlur,
    onContextMenu,
  },
  ref,
) {
  const [editor] = useLexicalComposerContext()
  const editableRef = useRef<HTMLDivElement | null>(null)
  const lastSyncedValueRef = useRef(value)
  // 编辑器最近一次对外呈现的内容：用户输入上报（onChange）或外部同步写入后的值。
  // 用于识别「编辑器领先于 React value 回流」的窗口，避免用旧 value 重建编辑器。
  const lastReportedValueRef = useRef(value)
  // 上一次 effect 见到的 value prop；不相等说明是一次真正的外部 setValue。
  const previousPropValueRef = useRef(value)
  // IME 组合期间禁止任何外部重建；组合结束后再补一次挂起的外部同步。
  const isComposingRef = useRef(false)
  const pendingSyncAfterCompositionRef = useRef(false)

  const getValue = useCallback(
    () => editor.getEditorState().read(() => $readComposerValue()),
    [editor],
  )
  const getSelection = useCallback(
    () => editor.getEditorState().read(() => $readComposerSelection()),
    [editor],
  )
  const setSelectionRange = useCallback(
    (start: number, end: number) => {
      editor.update(() => $setComposerSelection(start, end))
    },
    [editor],
  )
  const replaceSelection = useCallback(
    (text: string) => {
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selection.insertText(text)
          return
        }
        $setComposerSelection(getValue().length, getValue().length)
        const nextSelection = $getSelection()
        if ($isRangeSelection(nextSelection)) nextSelection.insertText(text)
      })
    },
    [editor, getValue],
  )

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editableRef.current?.focus()
      },
      getValue,
      getSelection,
      setSelectionRange,
      select: () => setSelectionRange(0, getValue().length),
      replaceSelection,
      getElement: () => editableRef.current,
    }),
    [editor, getSelection, getValue, replaceSelection, setSelectionRange],
  )

  useEffect(() => {
    editor.setEditable(!disabled && !readOnly)
  }, [disabled, editor, readOnly])

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLElement>>(
    (event) => {
      const isPlainDelete =
        (event.key === 'Backspace' || event.key === 'Delete') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      let deletedToken = false

      if (isPlainDelete) {
        editor.update(() => {
          deletedToken = $deleteAdjacentComposerToken(event.key === 'Backspace')
        })
        if (deletedToken) {
          event.preventDefault()
          event.stopPropagation()
        }
      }

      onKeyDown?.(event)
    },
    [editor, onKeyDown],
  )

  // 外部 value 同步：编辑器内容与 React value 出现分歧时，用 value 重建编辑器。
  // 两道防御保证不打断 IME / 不丢用户输入：
  // 1) IME 组合期间（compositionstart -> compositionend）一律挂起，组合结束后再补；
  // 2) Lexical 的 update commit 走微任务，组合文本写入编辑器与 React value 回流之间存在
  //    毫秒级窗口；若 effect 在窗口内重跑（如流式渲染导致的高频重绘），编辑器内容仍是
  //    最近一次 onChange 上报的内容（lastReportedValueRef），此时编辑器是权威数据源，
  //    绝不能用尚未回流的旧 value root.clear() 重建，否则组合中的 DOM 被销毁、拼音上屏。
  const syncExternalValue = useCallback(() => {
    if (isComposingRef.current) {
      pendingSyncAfterCompositionRef.current = true
      return
    }

    const currentValue = getValue()
    const expectedTokens = tokenizeComposerValue(
      value,
      new Set(commandNames.map((name) => normalizeName(name, '/'))),
      new Set(skillNames.map((name) => normalizeName(name, '@'))),
    )
    const currentTokens = editor.getEditorState().read(() => $readComposerTokens())
    const expectedTokenSignature = expectedTokens
      .filter((part): part is ComposerToken => typeof part !== 'string')
      .map((part) => `${part.kind}:${part.text}`)
      .join('\u0000')

    const isNewPropValue = value !== previousPropValueRef.current
    previousPropValueRef.current = value

    if (currentValue === value && currentTokens === expectedTokenSignature) return

    // value prop 未变（effect 只是因 commandNames 引用变化等被重跑），而编辑器内容仍是
    // 最近一次上报的内容：说明编辑器领先于 React 回流，跳过回写，等 value 追上来。
    // token 重排也会在下一次 value 变化的 effect 中自动补齐。
    if (!isNewPropValue && currentValue === lastReportedValueRef.current) return

    const previousValue = lastSyncedValueRef.current
    lastSyncedValueRef.current = value
    const selection = getSelection()
    const preserveSelection = editableRef.current === document.activeElement
    const placeCaretAtEnd = preserveSelection && previousValue.length === 0 && value.length > 0
    editor.update(
      () => {
        $replaceComposerValue(value, commandNames, skillNames)
        if (placeCaretAtEnd) $setComposerSelection(value.length, value.length)
        else if (preserveSelection) $setComposerSelection(selection.start, selection.end)
      },
      { tag: 'composer-external-sync' },
    )
    lastReportedValueRef.current = value
  }, [commandNames, editor, getSelection, getValue, skillNames, value])

  // compositionend 之后 Lexical 才在微任务里 commit 组合文本并触发 onChange；
  // 挂起的同步放到宏任务执行，确保 lastReportedValueRef 已是组合后的最新内容。
  const syncExternalValueRef = useRef(syncExternalValue)
  syncExternalValueRef.current = syncExternalValue

  useEffect(() => {
    syncExternalValue()
  }, [syncExternalValue])

  return (
    <div className="composer-input-lexical">
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            ref={editableRef}
            className="composer-input composer-input-editor"
            aria-label="消息输入"
            aria-multiline="true"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onCompositionStart={(event) => {
              isComposingRef.current = true
              onCompositionStart?.(event)
            }}
            onCompositionEnd={(event) => {
              isComposingRef.current = false
              onCompositionEnd?.(event)
              if (pendingSyncAfterCompositionRef.current) {
                pendingSyncAfterCompositionRef.current = false
                setTimeout(() => syncExternalValueRef.current(), 0)
              }
            }}
            onPaste={onPaste}
            onBlur={onBlur}
            onContextMenu={onContextMenu}
          />
        }
        placeholder={<div className="composer-input-placeholder">{placeholder}</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(editorState: EditorState, _editor: LexicalEditor, tags: Set<string>) => {
          // 外部程序同步（选命令插入 / 历史导航 / prefill 等 setValue）不是用户输入：
          // 同步时光标仍停在旧位置，若照常上报 onChange，handleValueChange 会按旧光标
          // 重新识别出斜杠片段，把 selectSlashCmd 刚关闭的命令弹窗再次打开。
          if (tags.has('composer-external-sync')) return
          const nextValue = editorState.read(() => $readComposerValue())
          lastReportedValueRef.current = nextValue
          onChange(nextValue)
        }}
      />
    </div>
  )
})

function $replaceComposerValue(
  value: string,
  commandNames: readonly string[],
  skillNames: readonly string[],
) {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  const commands = new Set(commandNames.map((name) => normalizeName(name, '/')))
  const skills = new Set(skillNames.map((name) => normalizeName(name, '@')))

  for (const part of tokenizeComposerValue(value, commands, skills)) {
    if (typeof part === 'string') {
      appendPlainText(paragraph, part)
      continue
    }
    paragraph.append($createComposerTokenNode(part.text, part.kind))
  }

  root.append(paragraph)
}

function $readComposerValue(): string {
  let value = ''
  const visit = (node: LexicalNode) => {
    if ($isTextNode(node) || $isLineBreakNode(node)) {
      value += node.getTextContent()
      return
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }
  $getRoot()
    .getChildren()
    .forEach((node, index, children) => {
      visit(node)
      if (index < children.length - 1) value += '\n'
    })
  return value
}

function $readComposerTokens(): string {
  const tokens: string[] = []
  const visit = (node: LexicalNode) => {
    if ($isComposerTokenNode(node)) {
      tokens.push(`${node.__tokenKind}:${node.getTextContent()}`)
      return
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }
  $getRoot().getChildren().forEach(visit)
  return tokens.join('\u0000')
}

function $readComposerSelection(): ComposerSelection {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) {
    const end = $readComposerValue().length
    return { start: end, end }
  }
  const start = composerPointToOffset(
    selection.anchor.key,
    selection.anchor.offset,
    selection.anchor.type,
  )
  const end = composerPointToOffset(
    selection.focus.key,
    selection.focus.offset,
    selection.focus.type,
  )
  return start <= end ? { start, end } : { start: end, end: start }
}

function $setComposerSelection(start: number, end: number): void {
  const valueLength = $readComposerValue().length
  const anchor = findComposerPoint(Math.max(0, Math.min(start, valueLength)))
  const focus = findComposerPoint(Math.max(0, Math.min(end, valueLength)))
  if (anchor == null || focus == null) {
    $getRoot().selectEnd()
    return
  }
  const selection = $createRangeSelection()
  selection.setTextNodeRange(anchor.node, anchor.offset, focus.node, focus.offset)
  $setSelection(selection)
}

function $deleteAdjacentComposerToken(isBackward: boolean): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

  const point = selection.anchor
  if (point.type !== 'text') return false
  const node = point.getNode()
  if (!$isComposerTokenNode(node)) return false

  const tokenLength = node.getTextContentSize()
  const atBoundary = isBackward ? point.offset === tokenLength : point.offset === 0
  if (!atBoundary) return false

  const currentOffset = composerPointToOffset(point.key, point.offset, point.type)
  const nextOffset = isBackward ? currentOffset - tokenLength : currentOffset
  node.remove()
  $setComposerSelection(nextOffset, nextOffset)
  return true
}

type ComposerPoint = { node: TextNode; offset: number }

function composerPointToOffset(key: NodeKey, offset: number, type: 'text' | 'element'): number {
  let total = 0
  let found = false
  const measure = (node: LexicalNode): number => {
    if ($isTextNode(node)) return node.getTextContentSize()
    if ($isLineBreakNode(node)) return 1
    if ($isElementNode(node))
      return node.getChildren().reduce((sum, child) => sum + measure(child), 0)
    return 0
  }
  const visit = (node: LexicalNode) => {
    if (found) return
    if (node.getKey() === key) {
      if ($isTextNode(node) && type === 'text') {
        total += Math.min(offset, node.getTextContentSize())
      } else if ($isElementNode(node) && type === 'element') {
        node
          .getChildren()
          .slice(0, Math.max(0, offset))
          .forEach((child) => {
            total += measure(child)
          })
      }
      found = true
      return
    }
    if ($isTextNode(node)) {
      total += node.getTextContentSize()
      return
    }
    if ($isLineBreakNode(node)) {
      total += 1
      return
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }
  $getRoot()
    .getChildren()
    .forEach((child, index, children) => {
      if (found) return
      visit(child)
      if (!found && index < children.length - 1) total += 1
    })
  return total
}

function findComposerPoint(target: number): ComposerPoint | null {
  const leaves: Array<{ node: TextNode; start: number; end: number }> = []
  let total = 0
  const visit = (node: LexicalNode) => {
    if ($isTextNode(node)) {
      const start = total
      total += node.getTextContentSize()
      leaves.push({ node, start, end: total })
      return
    }
    if ($isLineBreakNode(node)) {
      total += 1
      return
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }

  const rootChildren = $getRoot().getChildren()
  rootChildren.forEach((child, index) => {
    visit(child)
    if (index < rootChildren.length - 1) total += 1
  })

  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index]!
    if (target < leaf.end) {
      return { node: leaf.node, offset: Math.max(0, target - leaf.start) }
    }
    if (target !== leaf.end) continue

    const next = leaves[index + 1]
    if ($isComposerTokenNode(leaf.node) && next?.start === leaf.end) {
      return { node: next.node, offset: 0 }
    }
    return { node: leaf.node, offset: leaf.node.getTextContentSize() }
  }

  const last = leaves.at(-1)
  return last == null ? null : { node: last.node, offset: last.node.getTextContentSize() }
}

function appendPlainText(paragraph: ReturnType<typeof $createParagraphNode>, text: string) {
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (line) paragraph.append(new TextNode(line))
    if (index < lines.length - 1) paragraph.append($createLineBreakNode())
  })
}

function tokenizeComposerValue(
  value: string,
  commands: ReadonlySet<string>,
  skills: ReadonlySet<string>,
): Array<string | ComposerToken> {
  const parts: Array<string | ComposerToken> = []
  let plain = ''
  let index = 0

  const flushPlain = () => {
    if (plain) parts.push(plain)
    plain = ''
  }

  while (index < value.length) {
    const trigger = value[index]
    const isBoundary = index === 0 || /\s/.test(value[index - 1] ?? '')
    if (isBoundary && (trigger === '/' || trigger === '@')) {
      let end = index + 1
      while (end < value.length && !/\s/.test(value[end] ?? '')) end += 1
      const candidate = value.slice(index, end)
      const name = candidate.slice(1)
      const kind =
        trigger === '/' && commands.has(name)
          ? 'command'
          : trigger === '@' && skills.has(name)
            ? 'skill'
            : null
      if (kind) {
        flushPlain()
        parts.push({ kind, text: candidate })
        index = end
        continue
      }
    }
    plain += trigger
    index += 1
  }

  flushPlain()
  return parts
}

function normalizeName(name: string, prefix: '/' | '@'): string {
  const trimmed = name.trim()
  return trimmed.startsWith(prefix) ? trimmed.slice(1) : trimmed
}
