import type {
  CanvasMediaTaskInputFile,
  CanvasPromptTaskFields,
} from '@spark/protocol'

export type CanvasRuntimeRequest = {
  prompt: string
  system: string
  images: Array<{ url?: string; dataUrl?: string; mimeType?: string }>
  relationManifest: CanvasPromptTaskFields['relationManifest']
}

export function buildCanvasSystemPrompt(input: {
  capabilityPrompt?: string
  presetPrompt?: string
  agentPrompt?: string
  skillPrompts?: string[]
  negativePrompt?: string
}): string {
  const sections = [
    input.capabilityPrompt,
    input.presetPrompt,
    input.agentPrompt,
    ...(input.skillPrompts && input.skillPrompts.length > 0
      ? [`[Selected Skills]\n${input.skillPrompts.filter((item) => item.trim()).join('\n\n')}`]
      : []),
    input.negativePrompt?.trim() ? `约束（不可违反）：${input.negativePrompt.trim()}` : undefined,
  ]
  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join('\n\n')
}

export function buildCanvasRuntimeRequest(input: {
  prompt?: string
  inputFiles?: CanvasMediaTaskInputFile[]
} & CanvasPromptTaskFields): CanvasRuntimeRequest {
  const images = (input.inputFiles ?? [])
    .filter((file) => file.type === 'image')
    .map((file) => ({
      ...(file.url != null ? { url: file.url } : {}),
      ...(file.dataUrl != null ? { dataUrl: file.dataUrl } : {}),
      ...(file.mimeType != null ? { mimeType: file.mimeType } : {}),
    }))
    .filter((image) => image.url != null || image.dataUrl != null)
  return {
    prompt: (input.compiledUserText ?? input.prompt ?? '').trim(),
    system: input.systemPrompt?.trim() ?? '',
    images,
    relationManifest: input.relationManifest ?? [],
  }
}

export function buildCanvasMediaProviderPrompt(input: {
  systemPrompt?: string
  userPrompt: string
}): string {
  const system = input.systemPrompt?.trim()
  const user = input.userPrompt.trim()
  if (!system) return user
  if (!user) return system
  return `${system}\n\n${user}`
}
