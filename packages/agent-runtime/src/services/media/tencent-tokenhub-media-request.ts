import type { MediaCapabilityId } from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaInputFile,
  MediaProviderContext,
} from './media-adapter.types.js'
import { compileMediaRequest } from './media-request-compiler.js'
import { resolveTencentMediaReference } from './tencent-tokenhub-media-input.js'

const KLING_PREFIX = 'kl-video-'
const VIDU_PREFIX = 'vd-video-'
const FX_TWO_IMAGE_TEMPLATES = new Set(['kissing', 'hearting', 'hug', 'kissface'])

export async function buildTencentVideoRequest(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Promise<Record<string, unknown>> {
  const model = ctx.defaultModel
  const capability = input.capability as MediaCapabilityId
  const prompt = input.prompt?.trim() ?? ''
  const body: Record<string, unknown> = { model }

  if (prompt) body.prompt = prompt
  if (model.startsWith(KLING_PREFIX) && input.negativePrompt?.trim()) {
    body.negative_prompt = input.negativePrompt.trim()
  }
  Object.assign(body, compileTencentProviderParams(input, ctx))

  if (capability !== 'video.image_to_video') return normalizeTencentBody(model, body)

  if (model === 'yt-video-fx') {
    const refs = await resolveAllImages(input, ctx)
    assertVideoFxImageCount(String(body.template ?? 'hug'), refs.length)
    body.images = refs.map((url) => ({ url }))
    return normalizeTencentBody(model, body)
  }

  if (model === 'yt-video-humanactor') {
    await addHumanActorInputs(body, input, ctx)
    return normalizeTencentBody(model, body)
  }

  if (model.startsWith(VIDU_PREFIX)) {
    body.images = await resolveOrderedImages(input, ctx)
    return normalizeTencentBody(model, body)
  }

  const { firstFrame, lastFrame } = selectFrameFiles(input.inputFiles ?? [])
  if (firstFrame) {
    body.image = { url: await resolveTencentMediaReference(firstFrame, 'image', ctx) }
  }
  if (lastFrame && model.startsWith(KLING_PREFIX)) {
    body.image_tail = { url: await resolveTencentMediaReference(lastFrame, 'image', ctx) }
  }
  return normalizeTencentBody(model, body)
}

export function compileTencentProviderParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const manifest = ctx.mediaManifest
  const capability = ctx.mediaManifestCapability
  if (!manifest || !capability) return removeBlankParams(input.modelParams)

  const compiled = compileMediaRequest({
    manifest,
    capability,
    modelId: ctx.defaultModel,
    input: {
      ...(input.prompt != null ? { prompt: input.prompt } : {}),
      ...(input.negativePrompt != null ? { negativePrompt: input.negativePrompt } : {}),
      ...(input.modelParams != null ? { modelParams: input.modelParams } : {}),
      inputFiles: (input.inputFiles ?? []).map((file) => ({
        type: file.type,
        ...(file.role != null ? { role: file.role } : {}),
      })),
    },
    ...(input.capability?.startsWith('video.') && ctx.mediaDefaults?.video
      ? { providerDefaults: ctx.mediaDefaults.video }
      : {}),
    mode: 'adapter',
    ...(ctx.skipParameterValidation ? { skipParameterValidation: true } : {}),
  })
  const blockingIssue = compiled.validationIssues.find((issue) => issue.severity === 'error')
  if (blockingIssue && !ctx.skipParameterValidation) {
    throw new MediaProviderError('invalid_input', blockingIssue.message)
  }
  return compiled.providerParams
}

async function addHumanActorInputs(
  body: Record<string, unknown>,
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Promise<void> {
  const files = input.inputFiles ?? []
  const image = files.find((file) => isFileKind(file, 'image'))
  const audio = files.find((file) => isFileKind(file, 'audio'))
  if (image) {
    const imageRef = await resolveTencentMediaReference(image, 'image', ctx)
    const dataMatch = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/is.exec(imageRef)
    if (dataMatch?.[1]) body.image_base64 = dataMatch[1]
    else body.image_url = imageRef
  }
  if (audio) body.audio_url = await resolveTencentMediaReference(audio, 'audio', ctx)
}

async function resolveAllImages(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Promise<string[]> {
  const images = (input.inputFiles ?? []).filter((file) => isFileKind(file, 'image'))
  return Promise.all(images.map((file) => resolveTencentMediaReference(file, 'image', ctx)))
}

async function resolveOrderedImages(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Promise<string[]> {
  const images = (input.inputFiles ?? []).filter((file) => isFileKind(file, 'image'))
  const first = images.find((file) => file.role === 'first_frame')
  const tail = images.find((file) => file.role === 'last_frame')
  const ordered = [first, ...images.filter((file) => file !== first && file !== tail), tail].filter(
    (file): file is MediaInputFile => Boolean(file),
  )
  return Promise.all(ordered.map((file) => resolveTencentMediaReference(file, 'image', ctx)))
}

function selectFrameFiles(files: MediaInputFile[]): {
  firstFrame?: MediaInputFile
  lastFrame?: MediaInputFile
} {
  const images = files.filter((file) => isFileKind(file, 'image'))
  const firstFrame =
    images.find((file) => file.role === 'first_frame') ??
    images.find((file) => file.role !== 'last_frame')
  const lastFrame = images.find((file) => file.role === 'last_frame')
  return {
    ...(firstFrame ? { firstFrame } : {}),
    ...(lastFrame ? { lastFrame } : {}),
  }
}

function isFileKind(file: MediaInputFile, kind: 'image' | 'audio'): boolean {
  if (file.type === kind) return true
  return file.type === 'file' && file.mimeType?.toLowerCase().startsWith(`${kind}/`) === true
}

function normalizeTencentBody(
  model: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = snakeCaseObject(body)
  if (model.startsWith(KLING_PREFIX) && typeof normalized.duration === 'number') {
    normalized.duration = String(normalized.duration)
  }
  if (model.startsWith(KLING_PREFIX) && normalized.multi_shot === true) {
    delete normalized.prompt
  }
  if (model.startsWith(KLING_PREFIX) && normalized.multi_shot === false) {
    delete normalized.shot_type
    delete normalized.multi_prompt
  }
  return normalized
}

function snakeCaseObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [toSnakeCase(key), snakeCaseValue(value)]),
  )
}

function snakeCaseValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeCaseValue)
  if (isPlainRecord(value)) return snakeCaseObject(value)
  return value
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
}

function removeBlankParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params ?? {}).filter(([, value]) => {
      if (value === undefined || value === null) return false
      return typeof value !== 'string' || value.trim().length > 0
    }),
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertVideoFxImageCount(template: string, imageCount: number): void {
  if (template === 'onestory' && imageCount >= 2 && imageCount <= 10) return
  if (template === 'ridefly' && imageCount === 2) return
  if (FX_TWO_IMAGE_TEMPLATES.has(template) && imageCount >= 1 && imageCount <= 2) return
  if (
    !['onestory', 'ridefly'].includes(template) &&
    !FX_TWO_IMAGE_TEMPLATES.has(template) &&
    imageCount === 1
  ) {
    return
  }
  const expected =
    template === 'onestory'
      ? '2–10 张'
      : template === 'ridefly'
        ? '2 张'
        : FX_TWO_IMAGE_TEMPLATES.has(template)
          ? '1–2 张'
          : '1 张'
  throw new MediaProviderError(
    'invalid_input',
    `YT-Video-FX 模板 ${template} 需要 ${expected}图片，当前为 ${imageCount} 张`,
  )
}
