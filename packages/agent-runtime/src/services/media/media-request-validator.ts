import type {
  MediaCapabilityId,
  MediaContractIssue,
  MediaModelCapabilityManifest,
  MediaModelManifest,
  MediaProviderKind,
  ProviderMediaDefaults,
} from '@spark/protocol'
import type { MediaGenerateInput } from './media-adapter.types.js'
import { compileMediaRequest } from './media-request-compiler.js'
import { validateCommonMediaRequest } from './validators/common-media.validator.js'
import { mediaProviderValidator } from './validators/media-validator.registry.js'
import type {
  MediaRequestValidationResult,
  MediaValidationContext,
} from './validators/media-validator.types.js'

export interface ValidateMediaRequestInput {
  input: MediaGenerateInput
  providerKind: MediaProviderKind
  modelId: string
  capability: MediaCapabilityId
  manifest?: MediaModelManifest | undefined
  manifestCapability?: MediaModelCapabilityManifest | undefined
  providerDefaults?: ProviderMediaDefaults | undefined
  mode?: 'canvas' | 'mcp' | 'adapter' | undefined
}

export function validateMediaRequest(
  request: ValidateMediaRequestInput,
): MediaRequestValidationResult {
  const context: MediaValidationContext = {
    input: request.input,
    providerKind: request.providerKind,
    modelId: request.modelId,
    capability: request.capability,
    ...(request.manifest ? { manifest: request.manifest } : {}),
    ...(request.manifestCapability ? { manifestCapability: request.manifestCapability } : {}),
    ...(request.providerDefaults ? { providerDefaults: request.providerDefaults } : {}),
  }

  const compiled =
    request.manifest && request.manifestCapability
      ? compileMediaRequest({
          manifest: request.manifest,
          capability: request.manifestCapability,
          modelId: request.modelId,
          input: {
            ...(request.input.prompt != null ? { prompt: request.input.prompt } : {}),
            ...(request.input.negativePrompt != null
              ? { negativePrompt: request.input.negativePrompt }
              : {}),
            ...(request.input.modelParams != null
              ? { modelParams: request.input.modelParams }
              : {}),
            ...(request.input.inputFiles != null
              ? {
                  inputFiles: request.input.inputFiles.map((file) => ({
                    type: file.type,
                    ...(file.role != null ? { role: file.role } : {}),
                  })),
                }
              : {}),
          },
          ...(request.providerDefaults
            ? {
                providerDefaults: providerDefaultsForCapability(
                  request.providerDefaults,
                  request.capability,
                ),
              }
            : {}),
          mode: request.mode ?? 'adapter',
        })
      : {
          canonicalParams: { ...(request.input.modelParams ?? {}) },
          providerParams: { ...(request.input.modelParams ?? {}) },
          droppedParams: [],
          warnings: [],
          validationIssues: [],
        }

  const runtimeIssues = [
    ...validateCommonMediaRequest(context),
    ...(mediaProviderValidator(request.providerKind)?.(context) ?? []),
  ]
  const compiledIssues = compiled.validationIssues.map((issue) => ({
    ...issue,
    path: issue.path[0] === 'modelParams' ? issue.path : ['modelParams', ...issue.path],
  }))
  const issues: MediaContractIssue[] = [...compiledIssues, ...runtimeIssues]
  const validationIssues = dedupeIssues(issues)
  const blockingSource = request.mode === 'adapter' ? runtimeIssues : validationIssues
  return {
    ...compiled,
    validationIssues,
    blockingIssues: dedupeIssues(blockingSource).filter((issue) => issue.severity === 'error'),
  }
}

function providerDefaultsForCapability(
  defaults: ProviderMediaDefaults,
  capability: MediaCapabilityId,
): Record<string, unknown> | undefined {
  if (capability.startsWith('image.')) return defaults.image
  if (capability.startsWith('video.')) return defaults.video
  if (capability.startsWith('audio.')) return defaults.audio
  return undefined
}

function dedupeIssues(issues: MediaContractIssue[]): MediaContractIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.code}:${issue.path.join('.')}:${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
