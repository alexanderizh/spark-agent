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
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
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
import { buildCanvasPromptMentionItems, filterCanvasPromptMentionItems } from './canvasPromptMentions'
import {
  $createCanvasPromptAtomicNode,
  $isCanvasPromptAtomicNode,
  CanvasPromptAtomicNode,
  CanvasPromptDecoratorProvider,
  canvasPromptNodeTypeLabel,
  defaultCanvasPromptRelationForNode,
  renderCanvasPromptNodeThumbnail,
  type CanvasPromptAtomicBlock,
} from './CanvasPromptLexicalNode'

export type CanvasPromptComposerProps = {
  document: CanvasPromptDocument
  mentionNodes: CanvasNode[]
  assets: CanvasAsset[]
  placeholder?: string
  disabled?: boolean
  className?: string
  onChange(document: CanvasPromptDocument): void
  onMentionSelect?(node: CanvasNode, relation: CanvasPromptRelation): boolean | void
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
  onBlockEdit,
  onEditorReady,
}: CanvasPromptComposerProps) {
  const [insertMenuOpen, setInsertMenuOpen] = useState(false)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const initialDocument = useRef(document)
  const initialDisabled = useRef(disabled)
  const nodeById = useMemo(() => new Map(mentionNodes.map((node) => [node.id, node])), [mentionNodes])
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

  useEffect(() => {
    if (!insertMenuOpen) return
    const closeFromPointer = (event: globalThis.MouseEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) setInsertMenuOpen(false)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setInsertMenuOpen(false)
    }
    window.document.addEventListener('mousedown', closeFromPointer)
    window.document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      window.document.removeEventListener('mousedown', closeFromPointer)
      window.document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [insertMenuOpen])

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
          />
          <CanvasPromptEditorSurface
            document={document}
            placeholder={placeholder ?? '输入内容，或使用 @ 引用上游节点与画布资源'}
            disabled={disabled}
            mentionItems={mentionItems}
            assetById={assetById}
            onChange={onChange}
            onMentionSelect={onMentionSelect}
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
}: {
  open: boolean
  disabled: boolean
  mentionItems: ReturnType<typeof buildCanvasPromptMentionItems>
  assetById: Map<string, CanvasAsset>
  onOpenChange(open: boolean): void
  onMentionSelect?: CanvasPromptComposerProps['onMentionSelect']
}) {
  const [editor] = useLexicalComposerContext()

  const insertParameter = (parameter: CanvasPromptParameterBlock['parameter']) => {
    const block: CanvasPromptParameterBlock = {
      kind: 'parameter',
      id: nextPromptBlockId(`parameter-${parameter}`),
      parameter,
      value: '',
      ...(parameter === 'duration' ? { unit: '秒' } : {}),
    }
    insertAtomicBlock(editor, block, true)
    onOpenChange(false)
  }

  const insertReference = (node: CanvasNode, label: string) => {
    const relation = defaultCanvasPromptRelationForNode(node)
    if (onMentionSelect?.(node, relation) === false) return
    insertAtomicBlock(editor, createReferenceBlock(node, label, relation))
    onOpenChange(false)
  }

  return (
    <div className="canvas-prompt-composer-toolbar">
      <button
        type="button"
        className="canvas-prompt-composer-add"
        aria-label="添加参数、角色或资源"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onOpenChange(!open)}
      >
        <Icons.Plus size={16} />
      </button>
      <span>输入内容，或按 @ 引用节点、角色与资源</span>
      {open ? (
        <div className="canvas-prompt-parameter-menu">
          <span className="canvas-prompt-menu-heading">快捷参数</span>
          <InsertMenuButton
            icon={<Icons.Clock size={15} />}
            label="添加镜头时长"
            onClick={() => insertParameter('duration')}
          />
          <InsertMenuButton
            icon={<Icons.MessageSquare size={15} />}
            label="添加台词"
            onClick={() => insertParameter('dialogue')}
          />
          <InsertMenuButton
            icon={<Icons.Crosshair size={15} />}
            label="添加站位信息"
            onClick={() => insertParameter('blocking')}
          />
          {mentionItems.length > 0 ? (
            <>
              <span className="canvas-prompt-menu-heading is-resources">节点与资源</span>
              <div className="canvas-prompt-resource-list">
                {mentionItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertReference(item.node, item.label)}
                  >
                    <span className="canvas-prompt-menu-thumb">
                      {renderCanvasPromptNodeThumbnail(item.node, assetById)}
                    </span>
                    <span className="canvas-prompt-menu-copy">
                      <strong>{item.label}</strong>
                      <small>{canvasPromptNodeTypeLabel(item.node)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function InsertMenuButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick(): void
}) {
  return (
    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      <span className="canvas-prompt-menu-icon">{icon}</span>
      {label}
    </button>
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
  onEditorReady,
}: {
  document: CanvasPromptDocument
  placeholder: string
  disabled: boolean
  mentionItems: ReturnType<typeof buildCanvasPromptMentionItems>
  assetById: Map<string, CanvasAsset>
  onChange(document: CanvasPromptDocument): void
  onMentionSelect?: CanvasPromptComposerProps['onMentionSelect']
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
    const currentSignature = editor.getEditorState().read(() =>
      promptDocumentSignature($readCanvasPromptDocument()),
    )
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

function CanvasPromptMentionPlugin({
  items,
  assetById,
  onMentionSelect,
}: {
  items: ReturnType<typeof buildCanvasPromptMentionItems>
  assetById: Map<string, CanvasAsset>
  onMentionSelect?: CanvasPromptComposerProps['onMentionSelect']
}) {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState<string | null>(null)
  const trigger = useBasicTypeaheadTriggerMatch('@', { minLength: 0, maxLength: 80 })
  const options = useMemo(
    () =>
      filterCanvasPromptMentionItems(items, query ?? '')
        .slice(0, 10)
        .map((item) => new CanvasPromptMentionOption(item)),
    [items, query],
  )

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
      onQueryChange={setQuery}
      onSelectOption={selectOption}
      options={options}
      triggerFn={trigger}
      preselectFirstItem
      menuRenderFn={(anchorElementRef, menuProps) =>
        anchorElementRef.current
          ? createPortal(
              <div className="canvas-prompt-mention-menu" role="listbox">
                {menuProps.options.map((option, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={menuProps.selectedIndex === index}
                    className={menuProps.selectedIndex === index ? 'is-selected' : ''}
                    key={option.key}
                    ref={(element) => option.setRefElement(element)}
                    onMouseEnter={() => menuProps.setHighlightedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => menuProps.selectOptionAndCleanUp(option)}
                  >
                    <span>{renderCanvasPromptNodeThumbnail(option.item.node, assetById)}</span>
                    <span className="canvas-prompt-menu-copy">
                      <strong>{option.item.label}</strong>
                      <small>{canvasPromptNodeTypeLabel(option.item.node)}</small>
                    </span>
                  </button>
                ))}
              </div>,
              anchorElementRef.current,
            )
          : null
      }
    />
  )
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
  window.requestAnimationFrame(() => {
    if (focusParameterInput) {
      const input = Array.from(
        editor.getRootElement()?.querySelectorAll<HTMLElement>('[data-prompt-block-id]') ?? [],
      )
        .find((element) => element.dataset.promptBlockId === block.id)
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
