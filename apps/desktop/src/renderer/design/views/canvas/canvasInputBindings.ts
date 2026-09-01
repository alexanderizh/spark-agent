import type {
  CanvasInputBinding,
  CanvasInputBindingRole,
  CanvasPromptDocument,
  CanvasPromptReferenceBlock,
  CanvasPromptRelation,
} from '@spark/protocol'
import type { CanvasNode } from './canvas.types'
import { type CanvasNodeMediaKind, resolveCanvasNodeMediaKind } from './canvasNodeMediaKind'

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
  outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind> | undefined
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
    const sourceNode = nodeById.get(binding.sourceNodeId)
    const resolvedMediaKind = sourceNode
      ? resolveCanvasNodeMediaKind(sourceNode, input.outputMediaKindByNodeId)
      : undefined
    if (binding.kind === 'file' && resolvedMediaKind) {
      current = { ...current, kind: resolvedMediaKind }
    }
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
      if (promptBlockId) current = { ...current, promptBlockId }
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
      relationForNode(node, input.outputMediaKindByNodeId),
      undefined,
      membershipBinding ? 'input' : undefined,
      input.outputMediaKindByNodeId,
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
    // A visible prompt tag may point to an operation/group owner while the executable
    // binding points to its materialized output. They represent one logical input.
    // Do not re-add the owner as a second generic/file binding merely because the
    // prompt block itself still uses the stable owner id.
    const hasMaterializedOwnerBinding = next.some(
      (binding) =>
        binding.enabled &&
        binding.promptBlockId === block.id &&
        binding.sourceNodeId !== node.id &&
        (input.promptOwnerNodeIdsBySourceNodeId?.get(binding.sourceNodeId) ?? []).includes(node.id),
    )
    if (hasMaterializedOwnerBinding) continue
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
      input.outputMediaKindByNodeId,
    )
    next = addCanvasInputBinding(next, candidate)
  }
  return normalizeCanvasInputBindingOrders(next, input.document)
}

const MEDIA_BINDING_KINDS = new Set<CanvasInputBinding['kind']>(['image', 'video', 'audio', 'file'])

/**
 * 媒体绑定提交顺序归一化：以提示词文档为唯一权威顺序。
 *
 * Why: binding.order 历史上取自 block.order（手动 @ 引用为 Date.now()、连线引用为
 * 创建时的引用块计数），用户在编辑器中重排引用块后，既有绑定的 order 不会跟随更新；
 * 而编译器（canvasPromptCompiler）按文档块数组顺序产出 inputFiles，最终发给上游
 * 模型的资源顺序——即提示词中 <Picture N> / <Video N> 的语义——完全由文档顺序决定。
 * 不归一化的话，素材编排区按 binding.order 展示的序号会与实际发送顺序脱节。
 *
 * 规则（与 applyCanvasMediaInputModeToBindings 的「非媒体在前、媒体在后」惯例一致）：
 * - 非媒体绑定保持原相对顺序在前；
 * - 文档中已引用的启用媒体绑定按 promptBlockId 对应块在文档中的位置排序；
 * - 未在文档中引用的媒体绑定按原相对顺序追加在后。
 *
 * 仅重写 order 值、不改变绑定数组位置——数组位置本身无语义（展示与提交均按 order
 * 排序），保持位置稳定可避免破坏既有消费方与测试对数组结构的假设。
 */
function normalizeCanvasInputBindingOrders(
  bindings: readonly CanvasInputBinding[],
  document: CanvasPromptDocument,
): CanvasInputBinding[] {
  const blockIndexById = new Map<string, number>()
  for (const [index, block] of document.blocks.entries()) blockIndexById.set(block.id, index)

  const nonMediaIndexes: number[] = []
  const referenced: Array<{ index: number; blockIndex: number }> = []
  const unreferencedIndexes: number[] = []
  for (const [index, binding] of bindings.entries()) {
    if (!MEDIA_BINDING_KINDS.has(binding.kind)) {
      nonMediaIndexes.push(index)
      continue
    }
    const blockIndex =
      binding.enabled && binding.promptBlockId
        ? blockIndexById.get(binding.promptBlockId)
        : undefined
    if (blockIndex != null) referenced.push({ index, blockIndex })
    else unreferencedIndexes.push(index)
  }
  const byOrder = (left: number, right: number) =>
    bindings[left]!.order - bindings[right]!.order ||
    bindings[left]!.id.localeCompare(bindings[right]!.id)
  nonMediaIndexes.sort(byOrder)
  unreferencedIndexes.sort(byOrder)
  referenced.sort(
    (left, right) => left.blockIndex - right.blockIndex || byOrder(left.index, right.index),
  )

  const nextOrderByIndex = new Map<number, number>()
  let order = 0
  for (const index of nonMediaIndexes) nextOrderByIndex.set(index, order++)
  for (const entry of referenced) nextOrderByIndex.set(entry.index, order++)
  for (const index of unreferencedIndexes) nextOrderByIndex.set(index, order++)

  return bindings.map((binding, index) => {
    const nextOrder = nextOrderByIndex.get(index)
    return nextOrder != null && nextOrder !== binding.order
      ? { ...binding, order: nextOrder }
      : binding
  })
}

/**
 * 素材编排区的「前移 / 后移」：媒体素材的展示与提交顺序都以提示词文档为权威，
 * 因此移动必须同时重排文档中的引用块（输入区 chips 跟随换位）与绑定 order，
 * 保证编排区序号、输入区引用顺序、最终发给模型的资源顺序三者一致。
 */
export function moveCanvasMediaInput(
  state: { bindings: readonly CanvasInputBinding[]; document: CanvasPromptDocument },
  sourceNodeId: string,
  direction: -1 | 1,
): { bindings: CanvasInputBinding[]; document: CanvasPromptDocument } {
  const groupOrder = new Map<string, number>()
  for (const binding of state.bindings) {
    if (!binding.enabled || !MEDIA_BINDING_KINDS.has(binding.kind)) continue
    const current = groupOrder.get(binding.sourceNodeId)
    if (current == null || binding.order < current) {
      groupOrder.set(binding.sourceNodeId, binding.order)
    }
  }
  const sequence = Array.from(groupOrder.keys()).sort(
    (left, right) =>
      (groupOrder.get(left) ?? 0) - (groupOrder.get(right) ?? 0) || left.localeCompare(right),
  )
  const index = sequence.indexOf(sourceNodeId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= sequence.length) {
    return {
      bindings: state.bindings.map((binding) => ({ ...binding })),
      document: { version: 2, blocks: state.document.blocks.map((block) => ({ ...block })) },
    }
  }
  ;[sequence[index], sequence[target]] = [sequence[target]!, sequence[index]!]

  const document = reorderMediaPromptBlocks(state.document, state.bindings, sequence)
  // 先按新序列打临时序号，再走归一化：文档内引用收敛到块位置，无块项保持新序列相对顺序。
  const rankByNode = new Map(sequence.map((nodeId, rank) => [nodeId, rank]))
  const bindings = state.bindings.map((binding) => {
    const rank = rankByNode.get(binding.sourceNodeId)
    return rank == null ? { ...binding } : { ...binding, order: rank }
  })
  return {
    bindings: normalizeCanvasInputBindingOrders(bindings, document),
    document,
  }
}

/** 把媒体绑定对应的引用/结构化块，按新序列置换到它们原本占据的文档槽位上。 */
function reorderMediaPromptBlocks(
  document: CanvasPromptDocument,
  bindings: readonly CanvasInputBinding[],
  sequence: readonly string[],
): CanvasPromptDocument {
  const blockIndexById = new Map(document.blocks.map((block, index) => [block.id, index]))
  const blockIdsByNode = new Map<string, string[]>()
  for (const binding of bindings) {
    if (!binding.enabled || !MEDIA_BINDING_KINDS.has(binding.kind) || !binding.promptBlockId) {
      continue
    }
    if (!blockIndexById.has(binding.promptBlockId)) continue
    const ids = blockIdsByNode.get(binding.sourceNodeId) ?? []
    if (!ids.includes(binding.promptBlockId)) ids.push(binding.promptBlockId)
    blockIdsByNode.set(binding.sourceNodeId, ids)
  }
  const movedBlockIds: string[] = []
  const movedIdSet = new Set<string>()
  for (const nodeId of sequence) {
    const ids = (blockIdsByNode.get(nodeId) ?? [])
      .slice()
      .sort((left, right) => (blockIndexById.get(left) ?? 0) - (blockIndexById.get(right) ?? 0))
    for (const id of ids) {
      if (movedIdSet.has(id)) continue
      movedIdSet.add(id)
      movedBlockIds.push(id)
    }
  }
  const blocks = document.blocks.map((block) => ({ ...block }))
  if (movedBlockIds.length > 0) {
    const blockById = new Map(document.blocks.map((block) => [block.id, block]))
    const slots = document.blocks.flatMap((block, index) =>
      movedIdSet.has(block.id) ? [index] : [],
    )
    slots.forEach((slot, position) => {
      const block = blockById.get(movedBlockIds[position] ?? '')
      if (block) blocks[slot] = { ...block }
    })
  }
  return { version: 2, blocks }
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
  outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind>,
): CanvasInputBinding {
  const kind = kindOverride ?? inputKindForNode(node, outputMediaKindByNodeId)
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

function inputKindForNode(
  node: CanvasNode,
  outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind>,
): CanvasInputBinding['kind'] {
  const mediaKind = resolveCanvasNodeMediaKind(node, outputMediaKindByNodeId)
  if (mediaKind) return mediaKind
  if (node.type === 'text' || node.type === 'prompt') return 'text'
  return 'file'
}

function relationForNode(
  node: CanvasNode,
  outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind>,
): CanvasPromptRelation {
  if (node.data.pipelineRole === 'character') return 'character'
  if (node.data.pipelineRole === 'scene') return 'scene'
  if (node.data.pipelineRole === 'prop') return 'prop'
  if (node.data.pipelineRole === 'shot') return 'storyboard'
  if (node.data.pipelineRole === 'screenplay') return 'screenplay'
  const mediaKind = resolveCanvasNodeMediaKind(node, outputMediaKindByNodeId)
  if (mediaKind === 'image') return 'reference_image'
  if (mediaKind === 'video') return 'reference_video'
  if (mediaKind === 'audio') return 'reference_audio'
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
