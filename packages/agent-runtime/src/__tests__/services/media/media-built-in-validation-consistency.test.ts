import { describe, expect, it } from 'vitest'
import {
  BUILTIN_MEDIA_MODEL_MANIFESTS,
  inferRolePolicy,
  isMediaCapabilityId,
  isMediaProviderKind,
  type MediaModelCapabilityManifest,
  type MediaModelManifest,
} from '@spark/protocol'
import { validateMediaRequest } from '../../../services/media/media-request-validator.js'
import type { MediaInputFile } from '../../../services/media/media-adapter.types.js'

describe('built-in media validation consistency', () => {
  it('accepts each built-in capability defaults with its minimum valid inputs', () => {
    const failures: string[] = []

    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      for (const capability of manifest.capabilities) {
        if (!isMediaCapabilityId(capability.id)) continue
        const inputFiles = minimumInputs(capability)
        const result = validateMediaRequest({
          input: {
            operation: operationForCapability(capability.id),
            capability: capability.id,
            prompt: 'test prompt',
            inputFiles,
            modelParams: { ...(capability.defaults ?? {}) },
            outputDir: '',
          },
          providerKind: isMediaProviderKind(manifest.providerKind)
            ? manifest.providerKind
            : 'custom',
          modelId: manifest.modelId,
          capability: capability.id,
          manifest,
          manifestCapability: capability,
          mode: 'canvas',
        })
        if (result.blockingIssues.length > 0) {
          failures.push(
            `${manifest.id}/${capability.id}: ${result.blockingIssues
              .map((issue) => issue.message)
              .join('; ')}`,
          )
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('does not expose schema parameter values rejected by provider validation', () => {
    const failures: string[] = []

    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      for (const capability of manifest.capabilities) {
        if (!isMediaCapabilityId(capability.id)) continue
        const properties = schemaProperties(capability)
        for (const [name, schema] of Object.entries(properties)) {
          if (schema.readOnly === true) continue
          const values = representativeSchemaValues(schema)
          for (const value of values) {
            const modelParams = {
              ...(capability.defaults ?? {}),
              [name]: value,
            }
            const issues = blockingIssuesWithSingleParamAlternatives(
              manifest,
              capability,
              modelParams,
              name,
            )
            if (issues.length > 0) {
              failures.push(
                `${manifest.id}/${capability.id}/${name}=${JSON.stringify(value)}: ${issues.join('; ')}`,
              )
            }
          }
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('accepts each capability declared maximum input count', () => {
    const failures: string[] = []

    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      for (const capability of manifest.capabilities) {
        if (!isMediaCapabilityId(capability.id)) continue
        for (const kind of ['image', 'video', 'audio'] as const) {
          const maximum = maximumForKind(capability, kind)
          if (maximum == null) continue
          const inputFiles = inputsAtDeclaredMaximum(capability, kind, maximum)
          const issues = blockingIssuesWithSingleParamAlternatives(
            manifest,
            capability,
            { ...(capability.defaults ?? {}) },
            undefined,
            inputFiles,
          )
          if (issues.length > 0) {
            failures.push(
              `${manifest.id}/${capability.id}/${kind}=${maximum}: ${issues.join('; ')}`,
            )
          }
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('keeps capability defaults aligned with the exposed schema', () => {
    const failures: string[] = []

    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      for (const capability of manifest.capabilities) {
        const properties = schemaProperties(capability)
        for (const key of Object.keys(capability.defaults ?? {})) {
          if (properties[key]) continue
          failures.push(`${manifest.id}/${capability.id}: undeclared default ${key}`)
        }
      }
    }

    expect(failures).toEqual([])
  })
})

function representativeSchemaValues(schema: Record<string, unknown>): unknown[] {
  const values: unknown[] = []
  if (Array.isArray(schema.enum)) values.push(...schema.enum)
  if (schema.type === 'boolean' && !Array.isArray(schema.enum)) values.push(true, false)
  if (schema.default !== undefined) values.push(schema.default)
  if (typeof schema.minimum === 'number') values.push(schema.minimum)
  if (typeof schema.maximum === 'number') values.push(schema.maximum)
  return values.filter(
    (value, index) => values.findIndex((candidate) => Object.is(candidate, value)) === index,
  )
}

function blockingIssuesWithSingleParamAlternatives(
  manifest: MediaModelManifest,
  capability: MediaModelCapabilityManifest,
  modelParams: Record<string, unknown>,
  fixedParamName?: string,
  inputFiles: MediaInputFile[] = minimumInputs(capability),
): string[] {
  const initial = blockingIssues(manifest, capability, modelParams, inputFiles)
  if (initial.length === 0) return []
  for (const [name, schema] of Object.entries(schemaProperties(capability))) {
    if (name === fixedParamName || schema.readOnly === true) continue
    for (const value of representativeSchemaValues(schema)) {
      const candidate = { ...modelParams, [name]: value }
      if (blockingIssues(manifest, capability, candidate, inputFiles).length === 0) return []
    }
  }
  return initial
}

function blockingIssues(
  manifest: MediaModelManifest,
  capability: MediaModelCapabilityManifest,
  modelParams: Record<string, unknown>,
  inputFiles: MediaInputFile[] = minimumInputs(capability),
): string[] {
  if (!isMediaCapabilityId(capability.id)) {
    throw new Error(`unsupported media capability in consistency test: ${capability.id}`)
  }
  const capabilityId = capability.id
  const result = validateMediaRequest({
    input: {
      operation: operationForCapability(capabilityId),
      capability: capabilityId,
      prompt: 'test prompt',
      inputFiles,
      modelParams,
      outputDir: '',
    },
    providerKind: isMediaProviderKind(manifest.providerKind) ? manifest.providerKind : 'custom',
    modelId: manifest.modelId,
    capability: capabilityId,
    manifest,
    manifestCapability: capability,
    mode: 'canvas',
  })
  return result.blockingIssues.map((issue) => issue.message)
}

function maximumForKind(
  capability: MediaModelCapabilityManifest,
  kind: 'image' | 'video' | 'audio',
): number | undefined {
  if (kind === 'image') return capability.input.maxImages
  if (kind === 'video') return capability.input.maxVideos
  return capability.input.maxAudios
}

function inputsAtDeclaredMaximum(
  capability: MediaModelCapabilityManifest,
  kind: 'image' | 'video' | 'audio',
  maximum: number,
): MediaInputFile[] {
  const policy = inferRolePolicy(capability)
  const referenceMode =
    (kind === 'image' && maximum > 2 && policy.imageRoles?.includes('reference_image')) ||
    (kind === 'video' && policy.videoRoles?.includes('reference_video')) ||
    (kind === 'audio' && policy.audioRoles?.includes('reference_audio'))
  const required = capability.input.required
  const inputs = minimumInputs(capability)
    .filter((file) => file.type !== kind)
    .filter(
      (file) =>
        kind !== 'video' ||
        file.type !== 'image' ||
        required.includes('image') ||
        required.includes('images') ||
        required.includes('mask'),
    )
    .map((file) =>
      referenceMode && file.type === 'image' ? { ...file, role: 'reference' as const } : file,
    )
  if (
    referenceMode &&
    kind === 'audio' &&
    !inputs.some((file) => file.type === 'image' || file.type === 'video') &&
    policy.imageRoles?.includes('reference_image')
  ) {
    inputs.push(inputForKind(capability, 'image', 0, true))
  }
  for (let index = 0; index < maximum; index += 1) {
    inputs.push(inputForKind(capability, kind, index, referenceMode))
  }
  return inputs
}

function inputForKind(
  capability: MediaModelCapabilityManifest,
  kind: 'image' | 'video' | 'audio',
  index: number,
  referenceMode = false,
): MediaInputFile {
  const policy = inferRolePolicy(capability)
  if (kind === 'image') {
    const role =
      !referenceMode && policy.defaultRoleAssignment === 'first_then_last_then_reference'
        ? index === 0
          ? 'first_frame'
          : index === 1 && policy.imageRoles?.includes('last_frame')
            ? 'last_frame'
            : 'reference'
        : 'reference'
    return {
      type: 'image',
      role,
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: imageMimeType(capability),
      width: 1280,
      height: 720,
    }
  }
  if (kind === 'video') {
    return {
      type: 'video',
      role: policy.videoRoles?.includes('reference_video') ? 'reference' : 'input',
      url: `https://example.com/input-${index}.mp4`,
      mimeType: videoMimeType(capability),
      durationMs: 5_000,
      width: 1280,
      height: 720,
    }
  }
  return {
    type: 'audio',
    role: 'reference',
    url: `https://example.com/input-${index}.mp3`,
    mimeType: audioMimeType(capability),
    durationMs: 5_000,
  }
}

function schemaProperties(
  capability: MediaModelCapabilityManifest,
): Record<string, Record<string, unknown>> {
  const properties = capability.paramSchema.properties
  return properties && typeof properties === 'object' && !Array.isArray(properties)
    ? (properties as Record<string, Record<string, unknown>>)
    : {}
}

function minimumInputs(capability: MediaModelCapabilityManifest): MediaInputFile[] {
  const inputs: MediaInputFile[] = []
  const required = capability.input.required
  const policy = inferRolePolicy(capability)
  const needsImage =
    required.includes('image') ||
    required.includes('images') ||
    required.includes('mask') ||
    (capability.id === 'video.reference_to_video' && (policy.imageRoles?.length ?? 0) > 0)
  const needsVideo =
    required.includes('video') ||
    capability.id === 'video.edit' ||
    capability.id === 'video.extend' ||
    (capability.id === 'video.reference_to_video' &&
      !needsImage &&
      (policy.videoRoles?.length ?? 0) > 0)
  const needsAudio = required.includes('audio') || capability.id === 'audio.transcription'

  if (needsImage) {
    const imageRole = required.includes('mask')
      ? 'mask'
      : policy.imageRoles?.[0] === 'reference_image'
        ? 'reference'
        : policy.imageRoles?.[0]
    inputs.push({
      type: 'image',
      ...(imageRole ? { role: imageRole } : {}),
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: imageMimeType(capability),
    })
  }
  if (needsVideo) {
    inputs.push({
      type: 'video',
      role: policy.videoRoles?.[0] === 'reference_video' ? 'reference' : 'input',
      url: 'https://example.com/input.mp4',
      mimeType: videoMimeType(capability),
      durationMs: 5_000,
      width: 1280,
      height: 720,
    })
  }
  if (needsAudio) {
    inputs.push({
      type: 'audio',
      role: 'reference',
      url: 'https://example.com/input.mp3',
      mimeType: audioMimeType(capability),
      durationMs: 5_000,
    })
  }
  return inputs
}

function imageMimeType(capability: MediaModelCapabilityManifest): string {
  return capability.input.acceptedMimeTypes?.find((item) => item.startsWith('image/')) ?? 'image/png'
}

function videoMimeType(capability: MediaModelCapabilityManifest): string {
  return capability.input.acceptedMimeTypes?.find((item) => item.startsWith('video/')) ?? 'video/mp4'
}

function audioMimeType(capability: MediaModelCapabilityManifest): string {
  return capability.input.acceptedMimeTypes?.find((item) => item.startsWith('audio/')) ?? 'audio/mpeg'
}

function operationForCapability(capability: string) {
  if (capability === 'image.edit') return 'image_edit' as const
  if (capability === 'image.variations') return 'image_to_image' as const
  if (capability === 'audio.speech') return 'text_to_audio' as const
  if (capability === 'audio.transcription') return 'audio_transcribe' as const
  if (capability === 'video.image_to_video') return 'image_to_video' as const
  if (capability === 'video.edit') return 'video_edit' as const
  if (capability === 'video.extend') return 'video_extend' as const
  if (capability === 'video.reference_to_video' || capability === 'video.generate') {
    return 'text_to_video' as const
  }
  return 'text_to_image' as const
}
