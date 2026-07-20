import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  PUNCTUATION,
  type TriggerFn,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  KEY_ESCAPE_COMMAND,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type TextNode,
} from 'lexical'
import type {
  CanvasPromptBlock,
  CanvasPromptDocument,
  CanvasPromptParameterBlock,
  CanvasPromptReferenceBlock,
  CanvasPromptRelation,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { buildCanvasPromptMentionItems } from './canvasPromptMentions'
import { CanvasPromptInsertMenu } from './CanvasPromptInsertMenu'
import {
  $createCanvasPromptAtomicNode,
  $isCanvasPromptAtomicNode,
  CanvasPromptAtomicNode,
  CanvasPromptDecoratorProvider,
  defaultCanvasPromptRelationForNode,
  type CanvasPromptAtomicBlock,
} from './CanvasPromptLexicalNode'

export type CanvasPromptCanvasNodePickHandler = (onPick: (node: CanvasNode) => void) => void

export type CanvasPromptComposerProps = {
  document: CanvasPromptDocument
  mentionNodes: CanvasNode[]
  assets: CanvasAsset[]
  placeholder?: string
  disabled?: boolean
  className?: string
  onChange(document: CanvasPromptDocument): void
  onMentionSelect?(node: CanvasNode, relation: CanvasPromptRelation): boolean | void
  onRequestCanvasNodePick?: CanvasPromptCanvasNodePickHandler
  onBlockEdit?(blockId: string): void
  onEditorReady?(editor: LexicalEditor): void
}

export function CanvasPromptComposer({
  document,
  mentionNodes,
  assets,
  placeholder,
  disabled = false,
  className,
  onChange,
  onMentionSelect,
  onRequestCanvasNodePick,
  onBlockEdit,
  onEditorReady,
}: CanvasPromptComposerProps) {
  const [insertMenuOpen, setInsertMenuOpen] = useState(false)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const initialDocument = useRef(document)
  const initialDisabled = useRef(disabled)
  const nodeById = useMemo(
    () => new Map(mentionNodes.map((node) => [node.id, node])),
    [mentionNodes],
  )
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const mentionItems = useMemo(() => buildCanvasPromptMentionItems(mentionNodes), [mentionNodes])
  const decoratorContext = useMemo(
    () => ({ nodeById, assetById, disabled, ...(onBlockEdit ? { onBlockEdit } : {}) }),
    [assetById, disabled, nodeById, onBlockEdit],
  )
  const initialConfig = useMemo(
    () => ({
      namespace: 'SparkCanvasPromptComposer',
      nodes: [CanvasPromptAtomicNode],
      editable: !initialDisabled.current,
      theme: {
        paragraph: 'canvas-prompt-lexical-paragraph',
        text: { base: 'canvas-prompt-lexical-text' },
      },
      onError(error: Error) {
        throw error
      },
      editorState: () => $replaceCanvasPromptDocument(initialDocument.current),
    }),
    [],
  )

  return (
    <CanvasPromptDecoratorProvider value={decoratorContext}>
      <LexicalComposer initialConfig={initialConfig}>
        <div
          ref={composerRef}
          className={`canvas-prompt-composer${className ? ` ${className}` : ''}`}
        >
          <CanvasPromptToolbar
            open={insertMenuOpen}
            disabled={disabled}
            mentionItems={mentionItems}
            assetById={assetById}
            onOpenChange={setInsertMenuOpen}
            onMentionSelect={onMentionSelect}
            {...(onRequestCanvasNodePick ? { onRequestCanvasNodePick } : {})}
          />
          <CanvasPromptEditorSurface
            document={document}
            placeholder={placeholder ?? '输入内容，或使用 @ 引用上游节点与画布资源'}
            disabled={disabled}
            mentionItems={mentionItems}
            assetById={assetById}
            onChange={onChange}
            onMentionSelect={onMentionSelect}
            {...(onRequestCanvasNodePick ? { onRequestCanvasNodePick } : {})}
            onEditorReady={onEditorReady}
          />
        </div>
      </LexicalComposer>
    </CanvasPromptDecoratorProvider>
  )
}

function CanvasPromptToolbar({
  open,
  disabled,
  mentionItems,
  assetById,
  onOpenChange,
  onMentionSelect,
  onRequestCanvasNodePick,
}: {
  open: boolean
  disabled: boolean
  mentionItems: ReturnType<typeof buildCanvasPromptMentionItems>
  assetById: Map<string, CanvasAsset>
  onOpenChange(open: boolean): void
  onMentionSelect?: CanvasPromptComposerProps['onMentionSelect']
  onRequestCanvasNodePick?: CanvasPromptCanvasNodePickHandler
}) {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState('')
  const [triggerElement, setTriggerElement] = useState<HTMLButtonElement | null>(null)

  const insertParameter = (parameter: CanvasPromptParameterBlock['parameter']) => {
    const block = createParameterBlock(parameter)
    insertAtomicBlock(editor, block, true)
    onOpenChange(false)
  }

  const insertReference = (node: CanvasNode, label: string) => {
    const relation = defaultCanvasPromptRelationForNode(node)
    if (onMentionSelect?.(node, relation) === false) return
    insertAtomicBlock(editor, createReferenceBlock(node, label, relation))
    onOpenChange(false)
  }

  const pickReferenceFromCanvas = () => {
    onOpenChange(false)
    onRequestCanvasNodePick?.((node) => {
      const item = mentionItems.find((candidate) => candidate.node.id === node.id)
      if (item) insertReference(node, item.label)
    })
  }

  return (
    <div className="canvas-prompt-composer-toolbar">
      <button
        ref={setTriggerElement}
        type="button"
        className="canvas-prompt-composer-add"
        aria-label="添加参数、图片、视频或资源"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setQuery('')
          onOpenChange(!open)
        }}
      >
        <Icons.Plus size={16} />
      </button>
      <span>输入内容，或按 @ 引用节点、图片与视频资源</span>
      {open && triggerElement
        ? createPortal(
            <CanvasPromptInsertMenu
              items={mentionItems}
              assetById={assetById}
              query={query}
              autoFocus
              triggerElement={triggerElement}
              fixedToTrigger
              onQueryChange={setQuery}
              onInsertParameter={insertParameter}
              onInsertReference={(item) => insertReference(item.node, item.label)}
              {...(onRequestCanvasNodePick ? { onPickFromCanvas: pickReferenceFromCanvas } : {})}
              onRequestClose={() => onOpenChange(false)}
            />,
            document.body,
          )
        : null}
    </div>
  )
}

function CanvasPromptEditorSurface({
  document,
  placeholder,
  disabled,
  mentionItems,
  assetById,
  onChange,
  onMentionSelect,
  onRequestCanvasNodePick,
  onEditorReady,
}: {
  document: CanvasPromptDocument
  placeholder: string
  disabled: boolean
  mentionItems: ReturnType<typeof buildCanvasPromptMentionItems>
  assetById: Map<string, CanvasAsset>
  onChange(document: CanvasPromptDocument): void
  onMentionSelect?: CanvasPromptComposerProps['onMentionSelect']
  onRequestCanvasNodePick?: CanvasPromptCanvasNodePickHandler
  onEditorReady?: CanvasPromptComposerProps['onEditorReady']
}) {
  const [editor] = useLexicalComposerContext()

  return (
    <div
      className="canvas-prompt-composer-body"
      aria-label="提示词编排器"
      onMouseDown={(event) => {
        if (disabled || event.target !== event.currentTarget) return
        event.preventDefault()
        editor.focus(undefined, { defaultSelection: 'rootEnd' })
      }}
    >
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="canvas-prompt-text-block canvas-prompt-lexical-input"
            ariaLabel="提示词输入"
          />
        }
        placeholder={<div className="canvas-prompt-lexical-placeholder">{placeholder}</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <CanvasPromptEditablePlugin disabled={disabled} />
      <CanvasPromptReadyPlugin onReady={onEditorReady} />
      <CanvasPromptDocumentPlugin document={document} onChange={onChange} />
      <CanvasPromptMentionPlugin
        items={mentionItems}
        assetById={assetById}
        onMentionSelect={onMentionSelect}
        {...(onRequestCanvasNodePick ? { onRequestCanvasNodePick } : {})}
      />
    </div>
  )
}

function CanvasPromptReadyPlugin({
  onReady,
}: {
  onReady?: CanvasPromptComposerProps['onEditorReady']
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => onReady?.(editor), [editor, onReady])
  return null
}

function CanvasPromptEditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => editor.setEditable(!disabled), [disabled, editor])
  return null
}

function CanvasPromptDocumentPlugin({
  document,
  onChange,
}: {
  document: CanvasPromptDocument
  onChange(document: CanvasPromptDocument): void
}) {
  const [editor] = useLexicalComposerContext()
  const externalSignature = promptDocumentSignature(document)

  useEffect(() => {
    const currentSignature = editor
      .getEditorState()
      .read(() => promptDocumentSignature($readCanvasPromptDocument()))
    if (currentSignature === externalSignature) return
    editor.update(() => $replaceCanvasPromptDocument(document), {
      tag: 'canvas-prompt-external-sync',
    })
  }, [document, editor, externalSignature])

  const handleChange = useCallback(
    (editorState: EditorState) => {
      const next = editorState.read(() => $readCanvasPromptDocument())
      if (promptDocumentSignature(next) !== externalSignature) onChange(next)
    },
    [externalSignature, onChange],
  )

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
}

class CanvasPromptMentionOption extends MenuOption {
  item: ReturnType<typeof buildCanvasPromptMentionItems>[number]

  constructor(item: ReturnType<typeof buildCanvasPromptMentionItems>[number]) {
    super(item.id)
    this.item = item
  }
}

const CANVAS_PROMPT_MENTION_TRIGGER = new RegExp(`@((?:[^@${PUNCTUATION}\\s]){0,80})$`)

const matchCanvasPromptMentionTrigger: TriggerFn = (text) => {
  const match = CANVAS_PROMPT_MENTION_TRIGGER.exec(text)
  if (!match) return null
  return {
    leadOffset: match.index,
    matchingString: match[1] ?? '',
    replaceableString: match[0],
  }
}

function CanvasPromptMentionPlugin({
  items,
  assetById,
  onMentionSelect,
  onRequestCanvasNodePick,
}: {
  items: ReturnType<typeof buildCanvasPromptMentionItems>
  assetById: Map<string, CanvasAsset>
  onMentionSelect?: CanvasPromptComposerProps['onMentionSelect']
  onRequestCanvasNodePick?: CanvasPromptCanvasNodePickHandler
}) {
  const [editor] = useLexicalComposerContext()
  const [searchQuery, setSearchQuery] = useState('')
  const options = useMemo(() => items.map((item) => new CanvasPromptMentionOption(item)), [items])

  const selectOption = useCallback(
    (
      option: CanvasPromptMentionOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void,
    ) => {
      const relation = defaultCanvasPromptRelationForNode(option.item.node)
      if (onMentionSelect?.(option.item.node, relation) === false) return
      editor.update(() => {
        textNodeContainingQuery?.remove()
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const node = $createCanvasPromptAtomicNode(
          createReferenceBlock(option.item.node, option.item.label, relation),
        )
        selection.insertNodes([node])
        node.selectNext()
      })
      closeMenu()
    },
    [editor, onMentionSelect],
  )

  return (
    <LexicalTypeaheadMenuPlugin<CanvasPromptMentionOption>
      onQueryChange={(nextQuery) => {
        if (nextQuery != null) setSearchQuery(nextQuery)
      }}
      onSelectOption={selectOption}
      options={options}
      triggerFn={matchCanvasPromptMentionTrigger}
      preselectFirstItem
      menuRenderFn={(anchorElementRef, menuProps, matchingString) =>
        anchorElementRef.current
          ? createPortal(
              <CanvasPromptInsertMenu
                items={items}
                assetById={assetById}
                query={searchQuery}
                autoFocus
                triggerElement={anchorElementRef.current}
                fixedToTrigger
                onQueryChange={setSearchQuery}
                onInsertParameter={(parameter) => {
                  insertParameterAtTypeahead(
                    editor,
                    createParameterBlock(parameter),
                    matchingString,
                  )
                  closeLexicalTypeahead(editor)
                }}
                onInsertReference={(item) => {
                  const option = menuProps.options.find(
                    (candidate) => candidate.item.id === item.id,
                  )
                  if (option) menuProps.selectOptionAndCleanUp(option)
                }}
                {...(onRequestCanvasNodePick
                  ? {
                      onPickFromCanvas: () => {
                        const bookmark = captureTypeaheadCanvasNodePick(editor, matchingString)
                        closeLexicalTypeahead(editor)
                        onRequestCanvasNodePick((node) => {
                          const item = items.find((candidate) => candidate.node.id === node.id)
                          if (!item) return
                          const relation = defaultCanvasPromptRelationForNode(node)
                          if (onMentionSelect?.(node, relation) === false) return
                          insertAtomicBlockAtTypeaheadBookmark(
                            editor,
                            createReferenceBlock(node, item.label, relation),
                            bookmark,
                          )
                        })
                      },
                    }
                  : {})}
                onRequestClose={() => closeLexicalTypeahead(editor)}
              />,
              document.body,
            )
          : null
      }
    />
  )
}

function createParameterBlock(
  parameter: CanvasPromptParameterBlock['parameter'],
): CanvasPromptParameterBlock {
  return {
    kind: 'parameter',
    id: nextPromptBlockId(`parameter-${parameter}`),
    parameter,
    value: '',
    ...(parameter === 'duration' ? { unit: '秒' } : {}),
  }
}

function closeLexicalTypeahead(editor: LexicalEditor) {
  editor.dispatchCommand(
    KEY_ESCAPE_COMMAND,
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
}

function insertParameterAtTypeahead(
  editor: LexicalEditor,
  block: CanvasPromptParameterBlock,
  matchingString: string,
) {
  editor.update(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || selection.anchor.type !== 'text') return
    const textNode = selection.anchor.getNode()
    if (!$isTextNode(textNode)) return
    const endOffset = selection.anchor.offset
    const replaceableLength = matchingString.length + 1
    const startOffset = Math.max(0, endOffset - replaceableLength)
    textNode.spliceText(startOffset, replaceableLength, '')
    textNode.select(startOffset, startOffset)
    const nextSelection = $getSelection()
    if (!$isRangeSelection(nextSelection)) return
    const node = $createCanvasPromptAtomicNode(block)
    nextSelection.insertNodes([node])
    node.selectNext()
  })
  focusInsertedBlock(editor, block.id, true)
}

type CanvasPromptTypeaheadBookmark = {
  textNodeKey: NodeKey
  startOffset: number
  endOffset: number
  replaceableText: string
}

function captureTypeaheadCanvasNodePick(
  editor: LexicalEditor,
  matchingString: string,
): CanvasPromptTypeaheadBookmark | null {
  let bookmark: CanvasPromptTypeaheadBookmark | null = null
  editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || selection.anchor.type !== 'text') return
    const textNode = selection.anchor.getNode()
    if (!$isTextNode(textNode)) return
    const endOffset = selection.anchor.offset
    const startOffset = Math.max(0, endOffset - matchingString.length - 1)
    bookmark = {
      textNodeKey: textNode.getKey(),
      startOffset,
      endOffset,
      replaceableText: textNode.getTextContent().slice(startOffset, endOffset),
    }
  })
  return bookmark
}

function insertAtomicBlockAtTypeaheadBookmark(
  editor: LexicalEditor,
  block: CanvasPromptAtomicBlock,
  bookmark: CanvasPromptTypeaheadBookmark | null,
) {
  editor.update(() => {
    if (bookmark) {
      const textNode = $getNodeByKey<TextNode>(bookmark.textNodeKey)
      const replaceableText = textNode
        ?.getTextContent()
        .slice(bookmark.startOffset, bookmark.endOffset)
      if ($isTextNode(textNode) && replaceableText === bookmark.replaceableText) {
        textNode.spliceText(bookmark.startOffset, bookmark.endOffset - bookmark.startOffset, '')
        textNode.select(bookmark.startOffset, bookmark.startOffset)
      }
    }
    const node = $createCanvasPromptAtomicNode(block)
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      selection.insertNodes([node])
      node.selectNext()
      return
    }
    const paragraph = $createParagraphNode()
    paragraph.append(node)
    $getRoot().append(paragraph)
    node.selectNext()
  })
  focusInsertedBlock(editor, block.id, false)
}

function insertAtomicBlock(
  editor: LexicalEditor,
  block: CanvasPromptAtomicBlock,
  focusParameterInput = false,
) {
  editor.update(() => {
    const node = $createCanvasPromptAtomicNode(block)
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      selection.insertNodes([node])
      node.selectNext()
      return
    }
    const root = $getRoot()
    const paragraph = $createParagraphNode()
    paragraph.append(node)
    root.append(paragraph)
    node.selectNext()
  })
  focusInsertedBlock(editor, block.id, focusParameterInput)
}

function focusInsertedBlock(editor: LexicalEditor, blockId: string, focusParameterInput: boolean) {
  window.requestAnimationFrame(() => {
    if (focusParameterInput) {
      const input = Array.from(
        editor.getRootElement()?.querySelectorAll<HTMLElement>('[data-prompt-block-id]') ?? [],
      )
        .find((element) => element.dataset.promptBlockId === blockId)
        ?.querySelector<HTMLInputElement>('input')
      if (input) {
        input.focus()
        return
      }
    }
    editor.focus()
  })
}

function createReferenceBlock(
  node: CanvasNode,
  label: string,
  relation: CanvasPromptRelation,
): CanvasPromptReferenceBlock {
  return {
    kind: 'reference',
    id: nextPromptBlockId(`reference-${node.id}`),
    source: 'manual',
    sourceNodeId: node.id,
    relation,
    label,
    order: Date.now(),
  }
}

function $replaceCanvasPromptDocument(document: CanvasPromptDocument) {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  for (const block of document.blocks) {
    if (block.kind !== 'text') {
      paragraph.append($createCanvasPromptAtomicNode(block))
      continue
    }
    const lines = block.text.split('\n')
    lines.forEach((line, index) => {
      if (line) paragraph.append($createTextNode(line))
      if (index < lines.length - 1) paragraph.append($createLineBreakNode())
    })
  }
  root.append(paragraph)
}

function $readCanvasPromptDocument(): CanvasPromptDocument {
  const blocks: CanvasPromptBlock[] = []
  let text = ''
  let textIndex = 0
  const flushText = () => {
    if (!text) return
    blocks.push({ kind: 'text', id: `text-${textIndex}`, text })
    textIndex += 1
    text = ''
  }
  const visit = (node: LexicalNode) => {
    if ($isTextNode(node)) {
      text += node.getTextContent()
      return
    }
    if ($isLineBreakNode(node)) {
      text += '\n'
      return
    }
    if ($isCanvasPromptAtomicNode(node)) {
      flushText()
      blocks.push(node.getBlock())
      return
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }
  const children = $getRoot().getChildren()
  children.forEach((node, index) => {
    visit(node)
    if (index < children.length - 1) text += '\n'
  })
  flushText()
  return { version: 2, blocks }
}

function promptDocumentSignature(document: CanvasPromptDocument): string {
  return JSON.stringify(
    document.blocks.map((block) =>
      block.kind === 'text' ? { kind: 'text', text: block.text } : block,
    ),
  )
}

let promptBlockSequence = 0
function nextPromptBlockId(prefix: string): string {
  promptBlockSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${promptBlockSequence.toString(36)}`
}
