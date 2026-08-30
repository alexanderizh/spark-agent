import type {
  CanvasPromptBlock,
  CanvasMediaTaskInputFile,
  CanvasPromptTaskFields,
} from '@spark/protocol'
import type {
  CanvasAsset,
  CanvasInputTransport,
  CanvasNode,
  CanvasOperationType,
  CanvasSnapshot,
} from './canvas.types'
import type { CanvasTaskInputRoleSelection } from './canvasTaskInputFiles'
import { compileCanvasPromptDocument } from './canvasPromptCompiler'
import {
  buildCanvasSubmissionPromptDocument,
  buildCanvasVisiblePromptDocument,
} from './canvasPromptInitialization'
import { activeCanvasInputNodeIds } from './canvasInputBindings'
import { expandCanvasInputNodes, materializeCanvasTaskInputFiles } from './canvasWorkspaceTaskInput'
import { canvasOperationKind } from './canvasOperationKind'
import { resolveCanvasMediaInputs } from './canvasResolvedMediaInputs'

export type CanvasPromptSubmission = CanvasPromptTaskFields & {
  prompt: string
  inputFiles?: CanvasMediaTaskInputFile[]
}

type ResolvedExecutableReferences = {
  document: NonNullable<CanvasPromptTaskFields['promptDocument']>
  nodes: CanvasNode[]
  sourceByBlockId: ReadonlyMap<string, { blockId: string; nodeId: string }>
}

export function buildCanvasPromptDocumentForInputs(input: {
  prompt: string
  nodes: CanvasNode[]
  assets: CanvasAsset[]
}): NonNullable<CanvasPromptTaskFields['promptDocument']> {
  return buildCanvasVisiblePromptDocument({
    prompt: input.prompt,
    nodes: input.nodes,
    connections: input.nodes,
    assets: input.assets,
  })
}

export async function buildCanvasPromptSubmission(input: {
  document: NonNullable<CanvasPromptTaskFields['promptDocument']>
  snapshot: CanvasSnapshot
  operation: CanvasOperationType
  systemPrompt?: string
  negativePrompt?: string
  inputTransport?: CanvasInputTransport
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>
  inputNodeIds?: string[]
  inputBindings?: CanvasPromptTaskFields['inputBindings']
}): Promise<CanvasPromptSubmission> {
  const resolved = resolveExecutableReferences(input.document, input.snapshot)
  const inputNodeIds = new Set(
    input.inputBindings
      ? activeCanvasInputNodeIds(input.inputBindings)
      : (input.inputNodeIds ?? []),
  )
  const selectableNodes = Array.from(
    new Map(
      [...resolveCanvasMediaInputs(input.snapshot).bindingNodes, ...resolved.nodes].map((node) => [
        node.id,
        node,
      ]),
    ).values(),
  )
  const selectedSourceNodes = selectableNodes.filter((node) => inputNodeIds.has(node.id))
  const inputNodes = expandCanvasInputNodes(selectedSourceNodes, input.snapshot)
  const executableInputRoles = expandInputRolesToResolvedNodes(
    input.inputRoles,
    selectedSourceNodes,
    input.snapshot,
  )
  const executableSourceDocument = applyInputBindings(resolved, input.inputBindings)
  const visibleDocument = applyInputRoles(input.document, input.inputRoles, input.inputBindings)
  const document = applyInputRoles(
    buildCanvasSubmissionPromptDocument({ document: executableSourceDocument, inputNodes }),
    executableInputRoles,
    input.inputBindings,
  )
  const compilationNodes = Array.from(
    new Map(
      [...input.snapshot.nodes, ...resolved.nodes, ...inputNodes].map((node) => [node.id, node]),
    ).values(),
  )
  const compiled = compileCanvasPromptDocument({
    document,
    nodes: compilationNodes,
    assets: input.snapshot.assets,
    operation: input.operation,
    capturedAt: new Date().toISOString(),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
  })
  const rawFiles = (compiled.inputFiles ?? []) as CanvasMediaTaskInputFile[]
  const inputFiles = await materializeCanvasTaskInputFiles(
    rawFiles,
    canvasOperationKind(input.operation) === 'local_media' ? undefined : input.inputTransport,
  )
  return {
    prompt: compiled.compiledUserText,
    promptDocument: visibleDocument,
    ...(compiled.promptSnapshot ? { promptSnapshot: compiled.promptSnapshot } : {}),
    compiledUserText: compiled.compiledUserText,
    inputSnapshots: compiled.inputSnapshots,
    relationManifest: compiled.relationManifest,
    ...(input.inputBindings
      ? { inputBindings: input.inputBindings.map((binding) => ({ ...binding })) }
      : {}),
    ...(compiled.promptWarnings ? { promptWarnings: compiled.promptWarnings } : {}),
    ...(compiled.systemPrompt ? { systemPrompt: compiled.systemPrompt } : {}),
    ...(inputFiles.length > 0 ? { inputFiles } : {}),
  }
}

function applyInputBindings(
  resolved: ResolvedExecutableReferences,
  bindings: CanvasPromptTaskFields['inputBindings'],
): NonNullable<CanvasPromptTaskFields['promptDocument']> {
  if (!bindings) return resolved.document
  return {
    version: 2,
    blocks: resolved.document.blocks
      .filter(
        (block) =>
          (block.kind !== 'reference' && block.kind !== 'structured') ||
          isResolvedReferenceEnabled(block, resolved.sourceByBlockId, bindings),
      )
      .map((block) => ({ ...block })),
  }
}

function isResolvedReferenceEnabled(
  block: Extract<CanvasPromptBlock, { kind: 'reference' | 'structured' }>,
  sourceByBlockId: ResolvedExecutableReferences['sourceByBlockId'],
  bindings: NonNullable<CanvasPromptTaskFields['inputBindings']>,
): boolean {
  const source = sourceByBlockId.get(block.id) ?? {
    blockId: block.id,
    nodeId: block.sourceNodeId,
  }
  const blockBindings = bindings.filter((binding) => binding.promptBlockId === source.blockId)
  const candidates = blockBindings.length > 0 ? blockBindings : bindings
  return candidates.some(
    (binding) =>
      binding.enabled &&
      (binding.sourceNodeId === block.sourceNodeId || binding.sourceNodeId === source.nodeId),
  )
}

function resolveExecutableReferences(
  document: NonNullable<CanvasPromptTaskFields['promptDocument']>,
  snapshot: CanvasSnapshot,
): ResolvedExecutableReferences {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const resolvedNodes = new Map<string, CanvasNode>()
  const sourceByBlockId = new Map<string, { blockId: string; nodeId: string }>()
  const blocks = document.blocks.flatMap<CanvasPromptBlock>((block) => {
    if (block.kind !== 'reference' && block.kind !== 'structured') return [{ ...block }]
    const originalSource = { blockId: block.id, nodeId: block.sourceNodeId }
    const sourceNode = nodeById.get(block.sourceNodeId)
    if (!sourceNode) {
      sourceByBlockId.set(block.id, originalSource)
      return [{ ...block }]
    }
    const expanded = expandCanvasInputNodes([sourceNode], snapshot)
    if (expanded.length === 1 && expanded[0]?.id === sourceNode.id) {
      sourceByBlockId.set(block.id, originalSource)
      return [{ ...block }]
    }
    if (expanded.length === 0) {
      sourceByBlockId.set(block.id, originalSource)
      return [{ ...block }]
    }
    return expanded.map((node, index) => {
      resolvedNodes.set(node.id, node)
      const resolvedBlockId = `${block.id}-resolved-${index}`
      sourceByBlockId.set(resolvedBlockId, originalSource)
      if (block.kind === 'structured') {
        return {
          ...block,
          id: resolvedBlockId,
          sourceNodeId: node.id,
          summary:
            expanded.length > 1 ? `${block.summary} · ${node.title ?? index + 1}` : block.summary,
        }
      }
      return {
        ...block,
        id: resolvedBlockId,
        sourceNodeId: node.id,
        label: expanded.length > 1 ? `${block.label} · ${node.title ?? index + 1}` : block.label,
        order: block.order + index,
      }
    })
  })
  return {
    document: { version: 2, blocks },
    nodes: Array.from(resolvedNodes.values()),
    sourceByBlockId,
  }
}

function applyInputRoles(
  document: NonNullable<CanvasPromptTaskFields['promptDocument']>,
  inputRoles: Record<string, CanvasTaskInputRoleSelection> | undefined,
  inputBindings?: CanvasPromptTaskFields['inputBindings'],
): NonNullable<CanvasPromptTaskFields['promptDocument']> {
  if (!inputRoles) return document
  const blocks = document.blocks.flatMap<CanvasPromptBlock>((block) => {
    if (block.kind !== 'reference') return [{ ...block }]
    const bindingSourceNodeId = inputBindings?.find(
      (binding) => binding.enabled && binding.promptBlockId === block.id,
    )?.sourceNodeId
    const selected =
      inputRoles[block.sourceNodeId] ??
      (bindingSourceNodeId ? inputRoles[bindingSourceNodeId] : undefined)
    if (!selected) return [{ ...block }]
    const roles = Array.isArray(selected) ? selected : [selected]
    const mapped = roles.map<Extract<CanvasPromptBlock, { kind: 'reference' }>['relation']>(
      (role) => {
        if (role === 'first_frame' || role === 'last_frame') return role
        if (role === 'reference') {
          if (block.relation === 'reference_video' || block.relation === 'reference_audio') {
            return block.relation
          }
          return 'reference_image' as const
        }
        return block.relation
      },
    )
    return mapped.map((relation, index) => ({
      ...block,
      id: index === 0 ? block.id : `${block.id}-${roles[index]}`,
      relation,
      order: block.order + index,
    }))
  })
  return { version: 2, blocks }
}

function expandInputRolesToResolvedNodes(
  inputRoles: Record<string, CanvasTaskInputRoleSelection> | undefined,
  selectedSourceNodes: readonly CanvasNode[],
  snapshot: CanvasSnapshot,
): Record<string, CanvasTaskInputRoleSelection> | undefined {
  if (!inputRoles) return undefined
  const expandedRoles = { ...inputRoles }
  for (const sourceNode of selectedSourceNodes) {
    const selectedRole = inputRoles[sourceNode.id]
    if (!selectedRole) continue
    const expandedNodes = expandCanvasInputNodes([sourceNode], snapshot)
    const resolvedNode = expandedNodes.length === 1 ? expandedNodes[0] : undefined
    if (!resolvedNode || resolvedNode.id === sourceNode.id) continue
    expandedRoles[resolvedNode.id] = selectedRole
  }
  return expandedRoles
}
