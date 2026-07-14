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
}

export type CanvasPromptCompiledInputFile = {
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
