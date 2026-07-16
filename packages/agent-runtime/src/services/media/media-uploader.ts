import type { MediaProviderKind } from '@spark/protocol'

export interface MediaUploadInput {
  buffer: Buffer
  filename: string
  mimeType?: string
  targetProvider?: MediaProviderKind
  purpose?: string
  expiresAfter?: number
}

export interface MediaUploadResult {
  provider: MediaProviderKind
  fileId?: string
  url?: string
  publicUrl?: string
  expiresAt?: string
}

export interface MediaUploader {
  canHandle(provider: MediaProviderKind): boolean
  upload(input: MediaUploadInput): Promise<MediaUploadResult>
}
