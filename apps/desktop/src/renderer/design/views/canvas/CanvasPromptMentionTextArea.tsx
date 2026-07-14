import { useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasPromptDocument } from '@spark/protocol'
import { CanvasPromptComposer } from './CanvasPromptComposer'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { migrateLegacyPrompt, toCanvasPromptLegacyText } from './canvasPromptDocument'
import './canvasPromptComposer.less'

export function CanvasPromptMentionTextArea({
  value,
  placeholder,
  disabled,
  className,
  mentionNodes,
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
  assets?: CanvasAsset[]
  onChange: (value: string) => void
  onMentionSelect?: (node: CanvasNode, marker: string) => boolean | void
}) {
  const nodes = useMemo(() => mentionNodes ?? [], [mentionNodes])
  const promptAssets = useMemo(() => assets ?? [], [assets])
  const emittedValueRef = useRef(value)
  const [document, setDocument] = useState<CanvasPromptDocument>(() =>
    migrateLegacyPrompt({ prompt: value, nodes, assets: promptAssets }),
  )

  useEffect(() => {
    if (value === emittedValueRef.current) return
    emittedValueRef.current = value
    setDocument(migrateLegacyPrompt({ prompt: value, nodes, assets: promptAssets }))
  }, [nodes, promptAssets, value])

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
