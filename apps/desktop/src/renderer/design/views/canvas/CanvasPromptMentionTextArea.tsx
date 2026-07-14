import { useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasPromptDocument } from '@spark/protocol'
import { CanvasPromptComposer } from './CanvasPromptComposer'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { migrateLegacyPrompt, toCanvasPromptLegacyText } from './canvasPromptDocument'
import { ensureConnectionReferences, reconcilePromptConnections } from './canvasPromptConnections'
import './canvasPromptComposer.less'

export function CanvasPromptMentionTextArea({
  value,
  placeholder,
  disabled,
  className,
  mentionNodes,
  connectionNodes,
  assets,
  onChange,
  onMentionSelect,
}: {
  value: string
  rows: number
  placeholder?: string
  disabled?: boolean
  className?: string
  mentionNodes?: CanvasNode[]
  connectionNodes?: CanvasNode[]
  assets?: CanvasAsset[]
  onChange: (value: string) => void
  onMentionSelect?: (node: CanvasNode, marker: string) => boolean | void
}) {
  const nodes = useMemo(() => mentionNodes ?? [], [mentionNodes])
  const connections = useMemo(() => connectionNodes ?? [], [connectionNodes])
  const promptAssets = useMemo(() => assets ?? [], [assets])
  const emittedValueRef = useRef(value)
  const [document, setDocument] = useState<CanvasPromptDocument>(() =>
    ensureConnectionReferences(
      migrateLegacyPrompt({ prompt: value, nodes, assets: promptAssets }),
      connections,
    ),
  )

  useEffect(() => {
    if (value === emittedValueRef.current) return
    emittedValueRef.current = value
    setDocument(
      ensureConnectionReferences(
        migrateLegacyPrompt({ prompt: value, nodes, assets: promptAssets }),
        connections,
      ),
    )
  }, [connections, nodes, promptAssets, value])

  useEffect(() => {
    setDocument((current) => {
      const connectedIds = new Set(connections.map((node) => node.id))
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
      const next = ensureConnectionReferences(reconciled, connections)
      if (
        current.blocks.length === next.blocks.length &&
        current.blocks.every((block, index) => block.id === next.blocks[index]?.id) &&
        Array.from(connectedIds).every((id) =>
          next.blocks.some((block) => block.kind === 'reference' && block.sourceNodeId === id),
        )
      ) {
        return current
      }
      const legacy = toCanvasPromptLegacyText(next)
      emittedValueRef.current = legacy
      onChange(legacy)
      return next
    })
  }, [connections, onChange])

  const handleChange = (next: CanvasPromptDocument) => {
    setDocument(next)
    const legacy = toCanvasPromptLegacyText(next)
    emittedValueRef.current = legacy
    onChange(legacy)
  }

  return (
    <CanvasPromptComposer
      document={document}
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
