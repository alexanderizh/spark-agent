import {
  isMediaCapabilityId,
  isMediaProviderKind,
  type CanvasMediaPruneModelParamsRequest,
  type CanvasMediaTaskInputFile,
  type CanvasOperationType,
  type MediaModelCapabilityManifest,
  type MediaModelManifest,
} from '@spark/protocol'
import { validateMediaRequest } from '@spark/agent-runtime'

export function mapCanvasMediaTaskInputFiles(inputFiles: CanvasMediaTaskInputFile[]) {
  return inputFiles.map((file) => ({
    type: file.type,
    ...(file.role != null ? { role: file.role } : {}),
    ...(file.fileId != null ? { fileId: file.fileId } : {}),
    ...(file.path != null ? { path: file.path } : {}),
    ...(file.url != null ? { url: file.url } : {}),
    ...(file.dataUrl != null ? { dataUrl: file.dataUrl } : {}),
    ...(file.mimeType != null ? { mimeType: file.mimeType } : {}),
    ...(file.sizeBytes != null ? { sizeBytes: file.sizeBytes } : {}),
    ...(file.width != null ? { width: file.width } : {}),
    ...(file.height != null ? { height: file.height } : {}),
    ...(file.durationMs != null ? { durationMs: file.durationMs } : {}),
  }))
}

export function validateCanvasMediaTaskParams(input: {
  request: CanvasMediaPruneModelParamsRequest
  manifest: MediaModelManifest
  capability: MediaModelCapabilityManifest
}) {
  const { request, manifest, capability } = input
  if (!isMediaCapabilityId(request.capabilityId)) {
    return {
      prunedModelParams: request.modelParams,
      droppedParams: [],
      warnings: [],
      validationIssues: [],
      fallbackReason: `capability ${request.capabilityId} 不是可执行的媒体能力`,
    }
  }

  const result = validateMediaRequest({
    input: {
      operation: operationForCapability(request.capabilityId),
      capability: request.capabilityId,
      ...(request.prompt != null ? { prompt: request.prompt } : {}),
      ...(request.inputFiles != null
        ? {
            inputFiles: mapCanvasMediaTaskInputFiles(request.inputFiles),
          }
        : {}),
      modelParams: request.modelParams,
      outputDir: '',
    },
    providerKind: isMediaProviderKind(manifest.providerKind) ? manifest.providerKind : 'custom',
    modelId: request.modelId ?? manifest.modelId,
    capability: request.capabilityId,
    manifest,
    manifestCapability: capability,
    mode: 'canvas',
  })

  return {
    prunedModelParams: result.canonicalParams,
    droppedParams: result.droppedParams,
    warnings: result.warnings,
    validationIssues: result.validationIssues,
  }
}

function operationForCapability(capability: string): CanvasOperationType {
  switch (capability) {
    case 'image.edit':
      return 'image_edit'
    case 'image.variations':
      return 'image_to_image'
    case 'audio.speech':
      return 'text_to_audio'
    case 'audio.transcription':
      return 'audio_transcribe'
    case 'video.image_to_video':
      return 'image_to_video'
    case 'video.edit':
      return 'video_edit'
    case 'video.extend':
      return 'video_extend'
    case 'video.reference_to_video':
    case 'video.generate':
      return 'text_to_video'
    case 'image.generate':
    default:
      return 'text_to_image'
  }
}
