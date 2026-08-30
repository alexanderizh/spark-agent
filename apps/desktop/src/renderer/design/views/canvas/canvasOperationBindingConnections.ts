import type { CanvasNode } from './canvas.types'

type CanvasMediaNodeType = Extract<CanvasNode['type'], 'image' | 'video' | 'audio'>

/**
 * Keep text/structured upstream inputs in prompt bindings while limiting media inputs to the
 * current model capability. Without this split, enabling media configuration drops text task
 * outputs from the executable binding set even though their prompt tags remain visible.
 */
export function selectCanvasOperationBindingConnectionNodes(input: {
  expandedSourceNodes: readonly CanvasNode[]
  supportedInputTypes: readonly string[]
}): CanvasNode[] {
  const supportedMediaTypes = new Set(input.supportedInputTypes.filter(isCanvasMediaNodeType))
  if (supportedMediaTypes.size === 0) return [...input.expandedSourceNodes]

  return input.expandedSourceNodes.filter(
    (node) => !isCanvasMediaNodeType(node.type) || supportedMediaTypes.has(node.type),
  )
}

function isCanvasMediaNodeType(type: string): type is CanvasMediaNodeType {
  return type === 'image' || type === 'video' || type === 'audio'
}
