import type {
  CanvasInputBinding,
  CanvasInputBindingRole,
  CanvasPromptDocument,
  CanvasPromptReferenceBlock,
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
  promptOwnerNodeIdsBySourceNodeId?: ReadonlyMap<string, readonly string[]> | undefined
}): CanvasInputBinding[] {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const blockById = new Map(input.document.blocks.map((block) => [block.id, block]))
  const activePromptBlockIdBySourceNodeId = new Map<string, string>()
  for (const block of input.document.blocks) {
    if (block.kind !== 'reference' && block.kind !== 'structured') continue
    if (block.kind === 'reference' && (block.suppressed || block.disconnected)) continue
    if (!activePromptBlockIdBySourceNodeId.has(block.sourceNodeId)) {
      activePromptBlockIdBySourceNodeId.set(block.sourceNodeId, block.id)
    }
  }
  const connectionIds = new Set(input.connectionNodeIds)
  let next = input.bindings.flatMap<CanvasInputBinding>((binding) => {
    let current = binding
    const existingBlock = binding.promptBlockId ? blockById.get(binding.promptBlockId) : undefined
    const existingBlockIsActive =
      existingBlock != null &&
      !(
        existingBlock.kind === 'reference' &&
        (existingBlock.suppressed || existingBlock.disconnected)
      )
    if (!binding.promptBlockId || (!existingBlockIsActive && binding.origin !== 'connection')) {
      const promptBlockId = resolveCanvasInputBindingPromptBlockId({
        sourceNodeId: binding.sourceNodeId,
        activePromptBlockIdBySourceNodeId,
        promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
      })
      if (promptBlockId) current = { ...binding, promptBlockId }
    }
    if (current.promptBlockId) {
      const block = blockById.get(current.promptBlockId)
      if (!block) {
        return current.origin === 'connection' ? [{ ...current, enabled: false }] : []
      }
      if (block.kind === 'reference' && (block.suppressed || block.disconnected)) {
        return current.origin === 'connection' ? [{ ...current, enabled: false }] : []
      }
    }
    if (current.origin === 'connection' && !connectionIds.has(current.sourceNodeId)) {
      return [{ ...current, enabled: false }]
    }
    return [{ ...current }]
  })

  for (const nodeId of input.connectionNodeIds) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    const promptBlockId = resolveCanvasInputBindingPromptBlockId({
      sourceNodeId: nodeId,
      activePromptBlockIdBySourceNodeId,
      promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
    })
    // Operation creation can persist an explicit temporal/reference role for this
    // physical edge. Keep that role authoritative instead of layering the generic
    // connection role on the same image.
    if (
      next.some(
        (binding) =>
          binding.enabled &&
          binding.sourceNodeId === node.id &&
          binding.origin === 'connection' &&
          binding.role !== 'input',
      )
    ) {
      continue
    }
    const membershipBinding = next.find(
      (binding) =>
        binding.enabled &&
        binding.sourceNodeId === node.id &&
        binding.promptBlockId === promptBlockId &&
        binding.role === 'input',
    )
    const candidate = bindingForNode(
      node,
      'connection',
      promptBlockId,
      next.length,
      relationForNode(node),
      undefined,
      membershipBinding ? 'input' : undefined,
    )
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
    const membershipBinding = next.find(
      (binding) =>
        binding.enabled &&
        binding.sourceNodeId === node.id &&
        binding.promptBlockId === block.id &&
        binding.role === 'input',
    )
    const candidate = bindingForNode(
      node,
      origin,
      block.id,
      block.kind === 'reference' ? block.order : blockIndex,
      relation,
      block.kind === 'structured' ? 'structured' : undefined,
      membershipBinding ? 'input' : undefined,
    )
    next = addCanvasInputBinding(next, candidate)
  }
  return next
}

/**
 * Legacy picker bindings predate visible prompt tags. Materialize one manual
 * reference for every active picker/manual source that has no visible owner so
 * the editor remains the complete, removable projection of actual inputs.
 */
export function materializeCanvasInputBindingReferences(input: {
  document: CanvasPromptDocument
  bindings: readonly CanvasInputBinding[]
  nodes: readonly CanvasNode[]
  promptOwnerNodeIdsBySourceNodeId?: ReadonlyMap<string, readonly string[]> | undefined
}): CanvasPromptDocument {
  const blocks = input.document.blocks.map((block) => ({ ...block }))
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const visibleSourceNodeIds = new Set(
    blocks.flatMap((block) => {
      if (block.kind === 'structured') return [block.sourceNodeId]
      if (block.kind === 'reference' && !block.suppressed && !block.disconnected) {
        return [block.sourceNodeId]
      }
      return []
    }),
  )
  const usedBlockIds = new Set(blocks.map((block) => block.id))
  let nextOrder = blocks.filter((block) => block.kind === 'reference').length

  for (const binding of activeCanvasInputBindings(input.bindings)) {
    if (binding.origin === 'connection') continue
    const visibleOwnerNodeId = resolveVisiblePromptOwnerNodeId({
      sourceNodeId: binding.sourceNodeId,
      visibleSourceNodeIds,
      promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
    })
    if (visibleOwnerNodeId) continue
    const node = nodeById.get(binding.sourceNodeId)
    if (!node) continue
    const reference: CanvasPromptReferenceBlock = {
      kind: 'reference',
      id: uniqueMaterializedPromptBlockId(
        binding.promptBlockId ?? `legacy-input-${binding.sourceNodeId}`,
        usedBlockIds,
      ),
      source: 'manual',
      sourceNodeId: binding.sourceNodeId,
      relation: visiblePromptRelationForBinding(binding),
      label: node.title?.trim() || node.id,
      order: nextOrder,
    }
    nextOrder += 1
    visibleSourceNodeIds.add(binding.sourceNodeId)
    appendPromptReferenceBlock(blocks, reference, usedBlockIds)
  }

  return { version: 2, blocks }
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

function resolveCanvasInputBindingPromptBlockId(input: {
  sourceNodeId: string
  activePromptBlockIdBySourceNodeId: ReadonlyMap<string, string>
  promptOwnerNodeIdsBySourceNodeId?: ReadonlyMap<string, readonly string[]> | undefined
}): string | undefined {
  const direct = input.activePromptBlockIdBySourceNodeId.get(input.sourceNodeId)
  if (direct) return direct
  for (const ownerNodeId of input.promptOwnerNodeIdsBySourceNodeId?.get(input.sourceNodeId) ?? []) {
    const ownerBlockId = input.activePromptBlockIdBySourceNodeId.get(ownerNodeId)
    if (ownerBlockId) return ownerBlockId
  }
  return undefined
}

function resolveVisiblePromptOwnerNodeId(input: {
  sourceNodeId: string
  visibleSourceNodeIds: ReadonlySet<string>
  promptOwnerNodeIdsBySourceNodeId?: ReadonlyMap<string, readonly string[]> | undefined
}): string | undefined {
  if (input.visibleSourceNodeIds.has(input.sourceNodeId)) return input.sourceNodeId
  return (input.promptOwnerNodeIdsBySourceNodeId?.get(input.sourceNodeId) ?? []).find((nodeId) =>
    input.visibleSourceNodeIds.has(nodeId),
  )
}

function visiblePromptRelationForBinding(binding: CanvasInputBinding): CanvasPromptRelation {
  if (binding.role === 'first_frame' || binding.role === 'last_frame') return 'reference_image'
  return binding.relation
}

function uniqueMaterializedPromptBlockId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId)
    return baseId
  }
  let index = 1
  while (usedIds.has(`${baseId}-${index}`)) index += 1
  const id = `${baseId}-${index}`
  usedIds.add(id)
  return id
}

function appendPromptReferenceBlock(
  blocks: CanvasPromptDocument['blocks'],
  reference: CanvasPromptReferenceBlock,
  usedBlockIds: Set<string>,
) {
  const trailing = blocks.at(-1)
  if (trailing?.kind === 'text' && trailing.text.length === 0) {
    blocks.splice(blocks.length - 1, 0, reference)
    return
  }
  blocks.push(reference, {
    kind: 'text',
    id: uniqueMaterializedPromptBlockId(`${reference.id}-trailing-text`, usedBlockIds),
    text: '',
  })
}

function bindingForNode(
  node: CanvasNode,
  origin: CanvasInputBinding['origin'],
  promptBlockId: string | undefined,
  order: number,
  relation = relationForNode(node),
  kindOverride?: CanvasInputBinding['kind'],
  roleOverride?: CanvasInputBindingRole,
): CanvasInputBinding {
  const kind = kindOverride ?? inputKindForNode(node)
  const role: CanvasInputBindingRole =
    roleOverride ??
    (relation === 'first_frame'
      ? 'first_frame'
      : relation === 'last_frame'
        ? 'last_frame'
        : kind === 'image'
          ? 'reference'
          : 'input')
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
