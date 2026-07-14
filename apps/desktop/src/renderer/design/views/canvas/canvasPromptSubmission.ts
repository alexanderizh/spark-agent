import type {
  CanvasPromptBlock,
  CanvasMediaTaskInputFile,
  CanvasPromptTaskFields,
} from '@spark/protocol'
import type { CanvasAsset, CanvasInputTransport, CanvasNode, CanvasOperationType, CanvasSnapshot } from './canvas.types'
import type { CanvasTaskInputRoleSelection } from './canvasTaskInputFiles'
import { compileCanvasPromptDocument } from './canvasPromptCompiler'
import {
  buildCanvasSubmissionPromptDocument,
  buildCanvasVisiblePromptDocument,
} from './canvasPromptInitialization'
import {
  expandCanvasInputNodes,
  materializeCanvasTaskInputFiles,
} from './canvasWorkspaceTaskInput'

export type CanvasPromptSubmission = CanvasPromptTaskFields & {
  prompt: string
  inputFiles?: CanvasMediaTaskInputFile[]
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
}): Promise<CanvasPromptSubmission> {
  const inputNodeIds = new Set(input.inputNodeIds ?? [])
  const selectedSourceNodes = input.snapshot.nodes.filter((node) => inputNodeIds.has(node.id))
  const inputNodes = expandCanvasInputNodes(selectedSourceNodes, input.snapshot)
  const resolved = resolveExecutableReferences(input.document, input.snapshot)
  const visibleDocument = applyInputRoles(input.document, input.inputRoles)
  const document = applyInputRoles(
    buildCanvasSubmissionPromptDocument({ document: resolved.document, inputNodes }),
    input.inputRoles,
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
  const inputFiles = await materializeCanvasTaskInputFiles(rawFiles, input.inputTransport)
  return {
    prompt: compiled.compiledUserText,
    promptDocument: visibleDocument,
    ...(compiled.promptSnapshot ? { promptSnapshot: compiled.promptSnapshot } : {}),
    compiledUserText: compiled.compiledUserText,
    inputSnapshots: compiled.inputSnapshots,
    relationManifest: compiled.relationManifest,
    ...(compiled.promptWarnings ? { promptWarnings: compiled.promptWarnings } : {}),
    ...(compiled.systemPrompt ? { systemPrompt: compiled.systemPrompt } : {}),
    ...(inputFiles.length > 0 ? { inputFiles } : {}),
  }
}

function resolveExecutableReferences(
  document: NonNullable<CanvasPromptTaskFields['promptDocument']>,
  snapshot: CanvasSnapshot,
): { document: NonNullable<CanvasPromptTaskFields['promptDocument']>; nodes: CanvasNode[] } {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const resolvedNodes = new Map<string, CanvasNode>()
  const blocks = document.blocks.flatMap<CanvasPromptBlock>((block) => {
    if (block.kind !== 'reference' && block.kind !== 'structured') return [{ ...block }]
    const source = nodeById.get(block.sourceNodeId)
    if (!source) return [{ ...block }]
    const expanded = expandCanvasInputNodes([source], snapshot)
    if (expanded.length === 1 && expanded[0]?.id === source.id) return [{ ...block }]
    if (expanded.length === 0) return [{ ...block }]
    return expanded.map((node, index) => {
      resolvedNodes.set(node.id, node)
      if (block.kind === 'structured') {
        return {
          ...block,
          id: `${block.id}-resolved-${index}`,
          sourceNodeId: node.id,
          summary: expanded.length > 1 ? `${block.summary} · ${node.title ?? index + 1}` : block.summary,
        }
      }
      return {
        ...block,
        id: `${block.id}-resolved-${index}`,
        sourceNodeId: node.id,
        label: expanded.length > 1 ? `${block.label} · ${node.title ?? index + 1}` : block.label,
        order: block.order + index,
      }
    })
  })
  return { document: { version: 2, blocks }, nodes: Array.from(resolvedNodes.values()) }
}

function applyInputRoles(
  document: NonNullable<CanvasPromptTaskFields['promptDocument']>,
  inputRoles: Record<string, CanvasTaskInputRoleSelection> | undefined,
): NonNullable<CanvasPromptTaskFields['promptDocument']> {
  if (!inputRoles) return document
  const blocks = document.blocks.flatMap<CanvasPromptBlock>((block) => {
    if (block.kind !== 'reference') return [{ ...block }]
    const selected = inputRoles[block.sourceNodeId]
    if (!selected) return [{ ...block }]
    const roles = Array.isArray(selected) ? selected : [selected]
    const mapped = roles.map<Extract<CanvasPromptBlock, { kind: 'reference' }>['relation']>((role) => {
      if (role === 'first_frame' || role === 'last_frame') return role
      if (role === 'reference') return 'reference_image' as const
      return block.relation
    })
    return mapped.map((relation, index) => ({
      ...block,
      id: index === 0 ? block.id : `${block.id}-${roles[index]}`,
      relation,
      order: block.order + index,
    }))
  })
  return { version: 2, blocks }
}
