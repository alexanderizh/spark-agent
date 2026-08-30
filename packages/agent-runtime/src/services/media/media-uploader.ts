import type { MediaProviderKind } from '@spark/protocol'

export interface MediaUploadInput {
  buffer: Buffer
  filename: string
  mimeType?: string
  targetProvider?: MediaProviderKind
  purpose?: string
  expiresAfter?: number
  /**
   * 本地文件绝对路径；提供时 SparkMediaUploader 优先直传（主进程读盘后 multipart），
   * 避免大视频走 buffer→base64→dataUrl 的内存膨胀。adapter 仅有 buffer 时可不填。
   */
  filePath?: string
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
