import type { CanvasPromptTaskFields } from '@spark/protocol'

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
