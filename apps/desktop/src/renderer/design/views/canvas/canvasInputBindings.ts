import type {
  CanvasInputBinding,
  CanvasInputBindingRole,
  CanvasPromptDocument,
  CanvasPromptRelation,
} from '@spark/protocol'
import type { CanvasNode } from './canvas.types'

type CreateCanvasInputBinding = Omit<CanvasInputBinding, 'id' | 'enabled'> & {
  id?: string
  enabled?: boolean
}

export function createCanvasInputBinding(input: CreateCanvasInputBinding): CanvasInputBinding {
  const role = input.role ?? 'input'
  return {
    ...input,
    id: input.id ?? `${input.origin}:${input.sourceNodeId}:${role}`,
    enabled: input.enabled ?? true,
  }
}

export function addCanvasInputBinding(
  bindings: readonly CanvasInputBinding[],
  next: CanvasInputBinding,
): CanvasInputBinding[] {
  const key = canvasInputBindingKey(next)
  const existingIndex = bindings.findIndex((binding) => canvasInputBindingKey(binding) === key)
  if (existingIndex < 0) return [...bindings, { ...next }]
  const existing = bindings[existingIndex]!
  if (existing.enabled) {
    return bindings.map((binding, index) =>
      index === existingIndex && !binding.promptBlockId && next.promptBlockId
        ? { ...binding, promptBlockId: next.promptBlockId }
        : { ...binding },
    )
  }
  return bindings.map((binding, index) =>
    index === existingIndex
      ? {
          ...binding,
          enabled: true,
          ...(binding.promptBlockId || !next.promptBlockId
            ? {}
            : { promptBlockId: next.promptBlockId }),
        }
      : { ...binding },
  )
}

export function removeCanvasInputBinding(
  bindings: readonly CanvasInputBinding[],
  bindingId: string,
): CanvasInputBinding[] {
  return bindings.flatMap((binding) => {
    if (binding.id !== bindingId) return [{ ...binding }]
    if (binding.origin === 'connection') return [{ ...binding, enabled: false }]
    return []
  })
}

export function activeCanvasInputBindings(
  bindings: readonly CanvasInputBinding[],
): CanvasInputBinding[] {
  return bindings
    .filter((binding) => binding.enabled)
    .map((binding) => ({ ...binding }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

export function activeCanvasInputNodeIds(bindings: readonly CanvasInputBinding[]): string[] {
  return Array.from(
    new Set(activeCanvasInputBindings(bindings).map((binding) => binding.sourceNodeId)),
  )
}

export function replaceCanvasInputBindingRoles(
  bindings: readonly CanvasInputBinding[],
  bindingId: string,
  roles: readonly CanvasInputBindingRole[],
): CanvasInputBinding[] {
  const current = bindings.find((binding) => binding.id === bindingId)
  if (!current) return bindings.map((binding) => ({ ...binding }))
  const withoutCurrent = bindings.filter((binding) => binding.id !== bindingId)
  const uniqueRoles = Array.from(new Set(roles))
  return uniqueRoles.reduce<CanvasInputBinding[]>(
    (result, role, index) => {
      const next = createCanvasInputBinding({
        sourceNodeId: current.sourceNodeId,
        origin: current.origin,
        kind: current.kind,
        relation: relationForRole(current.relation, role),
        role,
        enabled: current.enabled,
        order: current.order + index,
        ...(role === current.role && current.promptBlockId
          ? { promptBlockId: current.promptBlockId }
          : {}),
      })
      return addCanvasInputBinding(result, next)
    },
    withoutCurrent.map((binding) => ({ ...binding })),
  )
}

export function reconcileCanvasInputBindings(input: {
  bindings: readonly CanvasInputBinding[]
  document: CanvasPromptDocument
  nodes: readonly CanvasNode[]
  connectionNodeIds: readonly string[]
}): CanvasInputBinding[] {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const blockById = new Map(input.document.blocks.map((block) => [block.id, block]))
  const connectionIds = new Set(input.connectionNodeIds)
  let next = input.bindings.flatMap<CanvasInputBinding>((binding) => {
    if (binding.promptBlockId) {
      const block = blockById.get(binding.promptBlockId)
      if (!block) {
        return binding.origin === 'connection' ? [{ ...binding, enabled: false }] : []
      }
      if (block.kind === 'reference' && (block.suppressed || block.disconnected)) {
        return [{ ...binding, enabled: false }]
      }
    }
    if (binding.origin === 'connection' && !connectionIds.has(binding.sourceNodeId)) {
      return [{ ...binding, enabled: false }]
    }
    return [{ ...binding }]
  })

  for (const nodeId of input.connectionNodeIds) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    const candidate = bindingForNode(node, 'connection', undefined, next.length)
    if (
      next.some((binding) => canvasInputBindingKey(binding) === canvasInputBindingKey(candidate))
    ) {
      continue
    }
    next = addCanvasInputBinding(next, candidate)
  }

  for (const [blockIndex, block] of input.document.blocks.entries()) {
    if (block.kind !== 'reference' && block.kind !== 'structured') continue
    if (block.kind === 'reference' && (block.suppressed || block.disconnected)) continue
    const node = nodeById.get(block.sourceNodeId)
    if (!node) continue
    const relation =
      block.kind === 'reference' ? block.relation : relationForStructuredBlock(block.schema)
    const origin = block.kind === 'reference' ? block.source : 'manual'
    const candidate = bindingForNode(
      node,
      origin,
      block.id,
      block.kind === 'reference' ? block.order : blockIndex,
      relation,
      block.kind === 'structured' ? 'structured' : undefined,
    )
    next = addCanvasInputBinding(next, candidate)
  }
  return next
}

export function removeCanvasInputNodeBindings(
  bindings: readonly CanvasInputBinding[],
  nodeId: string,
): CanvasInputBinding[] {
  return bindings.reduce<CanvasInputBinding[]>((result, binding) => {
    if (binding.sourceNodeId !== nodeId) return [...result, { ...binding }]
    return removeCanvasInputBinding([...result, binding], binding.id)
  }, [])
}

export function removeCanvasInputNodeFromPromptDocument(
  document: CanvasPromptDocument,
  nodeId: string,
): CanvasPromptDocument {
  return {
    version: 2,
    blocks: document.blocks.flatMap((block) => {
      if (block.kind === 'structured' && block.sourceNodeId === nodeId) return []
      if (block.kind !== 'reference' || block.sourceNodeId !== nodeId) return [{ ...block }]
      return block.source === 'connection' ? [{ ...block, suppressed: true }] : []
    }),
  }
}

export function removeCanvasInputBindingFromPromptDocument(
  document: CanvasPromptDocument,
  binding: CanvasInputBinding,
): CanvasPromptDocument {
  if (!binding.promptBlockId) return document
  return {
    version: 2,
    blocks: document.blocks.flatMap((block) => {
      if (block.id !== binding.promptBlockId) return [{ ...block }]
      if (block.kind === 'reference' && block.source === 'connection') {
        return [{ ...block, suppressed: true }]
      }
      return []
    }),
  }
}

function canvasInputBindingKey(binding: CanvasInputBinding): string {
  return `${binding.sourceNodeId}:${binding.role ?? 'input'}`
}

function bindingForNode(
  node: CanvasNode,
  origin: CanvasInputBinding['origin'],
  promptBlockId: string | undefined,
  order: number,
  relation = relationForNode(node),
  kindOverride?: CanvasInputBinding['kind'],
): CanvasInputBinding {
  const kind = kindOverride ?? inputKindForNode(node)
  const role: CanvasInputBindingRole =
    relation === 'first_frame'
      ? 'first_frame'
      : relation === 'last_frame'
        ? 'last_frame'
        : kind === 'image'
          ? 'reference'
          : 'input'
  return createCanvasInputBinding({
    sourceNodeId: node.id,
    origin,
    kind,
    relation,
    role,
    enabled: true,
    order,
    ...(promptBlockId ? { promptBlockId } : {}),
  })
}

function inputKindForNode(node: CanvasNode): CanvasInputBinding['kind'] {
  if (node.type === 'image' || node.type === 'video' || node.type === 'audio') return node.type
  if (node.type === 'text' || node.type === 'prompt') return 'text'
  return 'file'
}

function relationForNode(node: CanvasNode): CanvasPromptRelation {
  if (node.data.pipelineRole === 'character') return 'character'
  if (node.data.pipelineRole === 'scene') return 'scene'
  if (node.data.pipelineRole === 'prop') return 'prop'
  if (node.data.pipelineRole === 'shot') return 'storyboard'
  if (node.data.pipelineRole === 'screenplay') return 'screenplay'
  if (node.type === 'image') return 'reference_image'
  if (node.type === 'video') return 'reference_video'
  if (node.type === 'audio') return 'reference_audio'
  return 'generic'
}

function relationForStructuredBlock(
  schema: Extract<CanvasPromptDocument['blocks'][number], { kind: 'structured' }>['schema'],
): CanvasPromptRelation {
  if (schema === 'storyboard') return 'storyboard'
  if (schema === 'screenplay') return 'screenplay'
  return 'generic'
}

function relationForRole(
  current: CanvasPromptRelation,
  role: CanvasInputBindingRole,
): CanvasPromptRelation {
  if (role === 'first_frame') return 'first_frame'
  if (role === 'last_frame') return 'last_frame'
  return current
}
