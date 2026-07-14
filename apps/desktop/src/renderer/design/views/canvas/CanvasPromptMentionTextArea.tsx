import { useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasPromptDocument } from '@spark/protocol'
import { CanvasPromptComposer } from './CanvasPromptComposer'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { migrateLegacyPrompt, toCanvasPromptLegacyText } from './canvasPromptDocument'
import { ensureConnectionReferences, reconcilePromptConnections } from './canvasPromptConnections'
import './canvasPromptComposer.less'

export function CanvasPromptMentionTextArea({
  value,
  document: controlledDocument,
  placeholder,
  disabled,
  className,
  mentionNodes,
  connectionNodes,
  assets,
  onChange,
  onMentionSelect,
  onDocumentChange,
}: {
  value: string
  document?: CanvasPromptDocument
  rows: number
  placeholder?: string
  disabled?: boolean
  className?: string
  mentionNodes?: CanvasNode[]
  connectionNodes?: CanvasNode[]
  assets?: CanvasAsset[]
  onChange: (value: string) => void
  onMentionSelect?: (node: CanvasNode, marker: string) => boolean | void
  onDocumentChange?: (document: CanvasPromptDocument) => void
}) {
  const nodes = useMemo(() => mentionNodes ?? [], [mentionNodes])
  const connections = useMemo(() => connectionNodes ?? [], [connectionNodes])
  const promptAssets = useMemo(() => assets ?? [], [assets])
  const emittedValueRef = useRef(value)
  const [document, setDocument] = useState<CanvasPromptDocument>(() =>
    controlledDocument ??
      ensureConnectionReferences(
        migrateLegacyPrompt({ prompt: value, nodes, assets: promptAssets }),
        connections,
      ),
  )
  const resolvedDocument = controlledDocument ?? document
  const resolvedDocumentRef = useRef(resolvedDocument)
  const knownConnectionIdsRef = useRef(
    new Set(
      resolvedDocument.blocks.flatMap((block) =>
        block.kind === 'reference' && block.source === 'connection' ? [block.sourceNodeId] : [],
      ),
    ),
  )

  useEffect(() => {
    resolvedDocumentRef.current = resolvedDocument
  }, [resolvedDocument])

  useEffect(() => {
    if (!controlledDocument) return
    emittedValueRef.current = toCanvasPromptLegacyText(controlledDocument)
  }, [controlledDocument])

  useEffect(() => {
    if (controlledDocument) return
    if (value === emittedValueRef.current) return
    emittedValueRef.current = value
    setDocument(
      ensureConnectionReferences(
        migrateLegacyPrompt({ prompt: value, nodes, assets: promptAssets }),
        connections,
      ),
    )
  }, [connections, controlledDocument, nodes, promptAssets, value])

  useEffect(() => {
    const current = resolvedDocumentRef.current
    const connectedIds = new Set(connections.map((node) => node.id))
    const newConnections = connections.filter((node) => !knownConnectionIdsRef.current.has(node.id))
    const syntheticEdges = connections.map((node, index) => ({
      id: `composer-connection-${index}`,
      projectId: node.projectId,
      boardId: node.boardId,
      userId: node.userId,
      sourceNodeId: node.id,
      targetNodeId: 'composer',
      type: 'used_as_input' as const,
      metadata: {},
      createdAt: '',
    }))
    const reconciled = reconcilePromptConnections(current, syntheticEdges).document
    const next = ensureConnectionReferences(reconciled, newConnections)
    knownConnectionIdsRef.current = connectedIds
    if (JSON.stringify(current.blocks) === JSON.stringify(next.blocks)) return
    setDocument(next)
    resolvedDocumentRef.current = next
    const legacy = toCanvasPromptLegacyText(next)
    emittedValueRef.current = legacy
    onChange(legacy)
    onDocumentChange?.(next)
  }, [connections, onChange, onDocumentChange])

  const handleChange = (next: CanvasPromptDocument) => {
    setDocument(next)
    const legacy = toCanvasPromptLegacyText(next)
    emittedValueRef.current = legacy
    onChange(legacy)
    onDocumentChange?.(next)
  }

  return (
    <CanvasPromptComposer
      document={resolvedDocument}
      mentionNodes={nodes}
      assets={promptAssets}
      {...(placeholder != null ? { placeholder } : {})}
      {...(disabled != null ? { disabled } : {})}
      {...(className != null ? { className } : {})}
      onChange={handleChange}
      onMentionSelect={(node, relation) => onMentionSelect?.(node, relation)}
    />
  )
}
