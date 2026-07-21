import type { MediaInputMetadata } from './media-config.js'

/** Current cross-process canvas prompt document version. */
export const CANVAS_PROMPT_VERSION = 2 as const

export type CanvasPromptJsonValue =
  | null
  | boolean
  | number
  | string
  | CanvasPromptJsonValue[]
  | { [key: string]: CanvasPromptJsonValue }

export type CanvasPromptRelation =
  | 'character'
  | 'supporting_character'
  | 'scene'
  | 'prop'
  | 'first_frame'
  | 'last_frame'
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'
  | 'storyboard'
  | 'screenplay'
  | 'generic'

export type CanvasPromptTextBlock = {
  kind: 'text'
  id: string
  text: string
}

export type CanvasPromptReferenceBlock = {
  kind: 'reference'
  id: string
  source: 'connection' | 'manual'
  sourceNodeId: string
  relation: CanvasPromptRelation
  /** Relation assigned when the physical connection created this block. */
  connectionRelation?: CanvasPromptRelation
  /** Physical connection was removed after the user edited the automatic block. */
  disconnected?: boolean
  /** User intentionally removed this connected input from the authored prompt. */
  suppressed?: boolean
  label: string
  order: number
  note?: string
}

export type CanvasPromptParameterBlock = {
  kind: 'parameter'
  id: string
  parameter: 'duration' | 'dialogue' | 'blocking' | 'custom'
  value: string | number
  unit?: string
  relation?: string
}

export type CanvasPromptStructuredBlock = {
  kind: 'structured'
  id: string
  sourceNodeId: string
  schema: 'storyboard' | 'screenplay' | 'json' | 'table'
  summary: string
}

export type CanvasPromptBlock =
  | CanvasPromptTextBlock
  | CanvasPromptReferenceBlock
  | CanvasPromptParameterBlock
  | CanvasPromptStructuredBlock

/** Versioned, ordered prompt source authored in the renderer. */
export type CanvasPromptDocument = {
  version: typeof CANVAS_PROMPT_VERSION
  blocks: CanvasPromptBlock[]
}

/** Immutable copy of the authored document captured when a task is submitted. */
export type CanvasPromptSnapshot = CanvasPromptDocument & {
  capturedAt?: string
}

export type CanvasPromptInputKind = 'image' | 'video' | 'audio' | 'text' | 'structured' | 'file'

export type CanvasInputBindingOrigin = 'connection' | 'manual' | 'picker'

export type CanvasInputBindingRole =
  | 'input'
  | 'first_frame'
  | 'last_frame'
  | 'reference'
  | 'mask'

/** Canonical task-level binding shared by every canvas input entry point. */
export type CanvasInputBinding = {
  id: string
  sourceNodeId: string
  origin: CanvasInputBindingOrigin
  kind: CanvasPromptInputKind
  relation: CanvasPromptRelation
  role?: CanvasInputBindingRole
  enabled: boolean
  order: number
  promptBlockId?: string
}

export type CanvasPromptModelReference = {
  channel:
    | 'reference_images'
    | 'input_images'
    | 'reference_videos'
    | 'input_videos'
    | 'reference_audios'
    | 'input_audios'
    | 'first_frame'
    | 'last_frame'
    | 'text'
  ordinal?: number
  label: string
}

/** Stable, non-secret representation of one resolved prompt input. */
export type CanvasPromptInputSnapshot = {
  blockId: string
  sourceNodeId: string
  sourceAssetId?: string
  relation: CanvasPromptRelation
  order: number
  label: string
  kind: CanvasPromptInputKind
  contentHash?: string
  storageRef?: string
  previewUrl?: string
  mimeType?: string
  width?: number
  height?: number
  durationMs?: number
  contentText?: string
  schema?: CanvasPromptStructuredBlock['schema']
  structuredData?: CanvasPromptJsonValue
}

export type CanvasPromptWarning = {
  code: string
  message: string
  blockId?: string
}

export type CanvasPromptRelationManifestEntry = {
  blockId: string
  sourceNodeId: string
  relation: CanvasPromptRelation
  order: number
  label?: string
  contentHash?: string
  modelReference?: CanvasPromptModelReference
}

export type CanvasPromptCompiledInputFile = MediaInputMetadata & {
  fileId?: string
  path?: string
  url?: string
  dataUrl?: string
  mimeType?: string
  type: 'image' | 'audio' | 'video' | 'file'
  role?: 'input' | 'first_frame' | 'last_frame' | 'reference' | 'mask'
}

/** Deterministic artifacts produced from a document and its resolved inputs. */
export type CanvasPromptCompilation = {
  promptSnapshot?: CanvasPromptSnapshot
  compiledUserText: string
  inputFiles?: CanvasPromptCompiledInputFile[]
  inputSnapshots: CanvasPromptInputSnapshot[]
  relationManifest: CanvasPromptRelationManifestEntry[]
  promptWarnings?: CanvasPromptWarning[]
  systemPrompt?: string
}

/** Optional task/request fields; legacy string-only requests remain valid. */
export interface CanvasPromptTaskFields {
  promptDocument?: CanvasPromptDocument
  inputBindings?: CanvasInputBinding[]
  promptSnapshot?: CanvasPromptSnapshot
  compiledUserText?: string
  inputSnapshots?: CanvasPromptInputSnapshot[]
  relationManifest?: CanvasPromptRelationManifestEntry[]
  promptWarnings?: CanvasPromptWarning[]
  systemPrompt?: string
}

/** Non-sensitive compilation summary safe to return through IPC. */
export interface CanvasPromptResponseFields {
  compiledUserText?: string
  relationManifest?: CanvasPromptRelationManifestEntry[]
  promptWarnings?: CanvasPromptWarning[]
  systemPrompt?: string
}

/**
 * Compose the single prompt accepted by image/video providers.
 *
 * Canvas keeps system and user text separate for editing and diagnostics, while
 * most media APIs only accept one text field. Connected text nodes can already
 * be expanded into a functional system prompt, so blindly concatenating both
 * copies wastes provider context and can cross model limits.
 */
export function composeCanvasMediaProviderPrompt(input: {
  systemPrompt?: string
  userPrompt: string
}): string {
  const system = input.systemPrompt?.trim() ?? ''
  const user = input.userPrompt.trim()
  if (!system) return user
  if (!user) return system

  const normalizedSystem = normalizePromptForContainment(system)
  const normalizedUser = normalizePromptForContainment(user)
  if (normalizedSystem.includes(normalizedUser)) return system
  if (normalizedUser.includes(normalizedSystem)) return user

  const hasExplicitReferenceMappings =
    user.includes('[用户输入与引用关系]') && user.includes('[/用户输入与引用关系]')
  const dedupedUser = (
    hasExplicitReferenceMappings
      ? user
      : user.replace(
          /\[文本引用[^\]\r\n]*开始\]([\s\S]*?)\[\/文本引用[^\]\r\n]*结束\]/g,
          (block, body: string) =>
            referenceBodyAlreadyIncluded(normalizedSystem, body) ? '' : block,
        )
  ).trim()

  if (!dedupedUser) return system
  const normalizedDedupedUser = normalizePromptForContainment(dedupedUser)
  if (normalizedSystem.includes(normalizedDedupedUser)) return system
  return `${system}\n\n${dedupedUser}`
}

function referenceBodyAlreadyIncluded(normalizedSystem: string, body: string): boolean {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  return paragraphs.some((paragraph) => {
    const normalized = normalizePromptForContainment(paragraph)
    // Short labels such as names are not distinctive enough to remove a whole
    // reference block. A substantive paragraph must already exist verbatim.
    return normalized.length >= 24 && normalizedSystem.includes(normalized)
  })
}

function normalizePromptForContainment(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}
