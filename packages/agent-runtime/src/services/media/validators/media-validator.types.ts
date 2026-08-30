import type {
  MediaCapabilityId,
  MediaContractIssue,
  MediaModelCapabilityManifest,
  MediaModelManifest,
  MediaProviderKind,
  ProviderMediaDefaults,
} from '@spark/protocol'
import type { MediaGenerateInput } from '../media-adapter.types.js'
import type { CompileMediaRequestResult } from '../media-request-compiler.js'

export interface MediaValidationContext {
  input: MediaGenerateInput
  providerKind: MediaProviderKind
  modelId: string
  capability: MediaCapabilityId
  manifest?: MediaModelManifest | undefined
  manifestCapability?: MediaModelCapabilityManifest | undefined
  providerDefaults?: ProviderMediaDefaults | undefined
}

export type MediaProviderValidator = (context: MediaValidationContext) => MediaContractIssue[]

export interface MediaRequestValidationResult extends CompileMediaRequestResult {
  blockingIssues: MediaContractIssue[]
}

export function validationIssue(
  code: MediaContractIssue['code'],
  message: string,
  path: Array<string | number>,
  severity: MediaContractIssue['severity'] = 'error',
): MediaContractIssue {
  return { severity, code, message, path }
}

export function promptText(context: MediaValidationContext): string {
  return (context.input.prompt ?? '').trim()
}

export function inputFilesOfKind(
  context: MediaValidationContext,
  kind: 'image' | 'audio' | 'video' | 'file',
) {
  return (context.input.inputFiles ?? []).filter((file) => {
    if (file.type === kind) return true
    if (file.type !== 'file' || kind === 'file') return false
    return file.mimeType?.toLowerCase().startsWith(`${kind}/`) === true
  })
}

export function imageInputFiles(context: MediaValidationContext) {
  return (context.input.inputFiles ?? []).filter(
    (file) =>
      file.type === 'image' ||
      (file.type === 'file' &&
        (!file.mimeType || file.mimeType.toLowerCase().startsWith('image/'))),
  )
}

export function numericParam(
  params: Record<string, unknown> | undefined,
  ...names: string[]
): number | undefined {
  for (const name of names) {
    const value = params?.[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

export function stringParam(
  params: Record<string, unknown> | undefined,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = params?.[name]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}
