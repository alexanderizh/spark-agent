import type { CanvasPromptTaskFields } from '@spark/protocol'
import type { CanvasTaskInputRole, CanvasTaskInputRoleSelection } from './canvasTaskInputFiles'

export function pickCanvasPromptTaskFields(input: CanvasPromptTaskFields): CanvasPromptTaskFields {
  return {
    ...(input.promptDocument ? { promptDocument: input.promptDocument } : {}),
    ...(input.promptSnapshot ? { promptSnapshot: input.promptSnapshot } : {}),
    ...(input.compiledUserText != null ? { compiledUserText: input.compiledUserText } : {}),
    ...(input.inputSnapshots ? { inputSnapshots: input.inputSnapshots } : {}),
    ...(input.relationManifest ? { relationManifest: input.relationManifest } : {}),
    ...(input.promptWarnings ? { promptWarnings: input.promptWarnings } : {}),
    ...(input.systemPrompt != null ? { systemPrompt: input.systemPrompt } : {}),
  }
}

export function buildCanvasRetryInputRoles(
  manifest: CanvasPromptTaskFields['relationManifest'],
): Record<string, CanvasTaskInputRoleSelection> {
  const roles: Record<string, CanvasTaskInputRole[]> = {}
  for (const entry of manifest ?? []) {
    const role = retryRoleForRelation(entry.relation)
    const current = roles[entry.sourceNodeId] ?? []
    if (!current.includes(role)) current.push(role)
    roles[entry.sourceNodeId] = current
  }
  return roles
}

function retryRoleForRelation(
  relation: NonNullable<CanvasPromptTaskFields['relationManifest']>[number]['relation'],
): CanvasTaskInputRole {
  if (relation === 'first_frame') return 'first_frame'
  if (relation === 'last_frame') return 'last_frame'
  if (
    relation === 'reference_image' ||
    relation === 'character' ||
    relation === 'supporting_character' ||
    relation === 'scene' ||
    relation === 'prop'
  ) {
    return 'reference'
  }
  return 'input'
}
