import type { MediaUploadInput, MediaUploadResult, MediaUploader } from '@spark/agent-runtime'
import type { MediaProviderKind } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { getAuthService } from '../Auth/AuthService.js'

export class SparkMediaUploader implements MediaUploader {
  canHandle(provider: MediaProviderKind): boolean {
    return provider === 'xai' || provider === 'volcengine-ark' || provider === 'bailian'
  }

  async upload(input: MediaUploadInput): Promise<MediaUploadResult> {
    const auth = getAuthService()
    if (!auth.getCurrentUserId()) {
      throw new SparkError('PROVIDER_AUTH_FAILED', 'Spark 平台文件上传需要先登录或注册')
    }
    const uploaded = await auth.uploadFile({
      dataUrl: `data:${input.mimeType ?? 'application/octet-stream'};base64,${input.buffer.toString('base64')}`,
      fileName: input.filename,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    })
    return {
      provider: input.targetProvider ?? 'xai',
      publicUrl: uploaded.aiUrl,
      url: uploaded.aiUrl,
    }
  }
}

export const sparkMediaUploader = new SparkMediaUploader()
