import type {
  CanvasPromptBlock,
  CanvasMediaTaskInputFile,
  CanvasPromptTaskFields,
} from '@spark/protocol'
import type { CanvasInputTransport, CanvasOperationType, CanvasSnapshot } from './canvas.types'
import type { CanvasTaskInputRoleSelection } from './canvasTaskInputFiles'
import { compileCanvasPromptDocument } from './canvasPromptCompiler'
import { materializeCanvasTaskInputFiles } from './canvasWorkspaceTaskInput'

export type CanvasPromptSubmission = CanvasPromptTaskFields & {
  prompt: string
  inputFiles?: CanvasMediaTaskInputFile[]
}

export async function buildCanvasPromptSubmission(input: {
  document: NonNullable<CanvasPromptTaskFields['promptDocument']>
  snapshot: CanvasSnapshot
  operation: CanvasOperationType
  systemPrompt?: string
  negativePrompt?: string
  inputTransport?: CanvasInputTransport
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>
}): Promise<CanvasPromptSubmission> {
  const document = applyInputRoles(input.document, input.inputRoles)
  const compiled = compileCanvasPromptDocument({
    document,
    nodes: input.snapshot.nodes,
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
    promptDocument: document,
    ...(compiled.promptSnapshot ? { promptSnapshot: compiled.promptSnapshot } : {}),
    compiledUserText: compiled.compiledUserText,
    inputSnapshots: compiled.inputSnapshots,
    relationManifest: compiled.relationManifest,
    ...(compiled.promptWarnings ? { promptWarnings: compiled.promptWarnings } : {}),
    ...(compiled.systemPrompt ? { systemPrompt: compiled.systemPrompt } : {}),
    ...(inputFiles.length > 0 ? { inputFiles } : {}),
  }
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
