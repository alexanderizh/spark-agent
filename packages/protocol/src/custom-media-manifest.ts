import type { MediaModelCapabilityManifest, MediaModelManifest } from './media-model-manifest.js'

export interface BasicCustomMediaManifestInput {
  modelId: string
  modelType: 'image' | 'video'
  mode: 'sync' | 'async_polling'
}

export function createBasicCustomMediaManifest(
  input: BasicCustomMediaManifestInput,
): MediaModelManifest {
  const modelId = input.modelId.trim()
  const id = `custom:${slugifyModelId(modelId)}`
  const capability =
    input.modelType === 'image' ? imageGenerateCapability() : videoGenerateCapability()
  const endpoint = input.modelType === 'image' ? '/images/generations' : '/videos/generations'
  const requestTemplate = { model: '{{modelId}}', prompt: '{{prompt}}' }

  if (input.mode === 'async_polling') {
    return {
      id,
      providerKind: 'custom',
      modelId,
      displayName: modelId,
      domains: [input.modelType],
      capabilities: [capability],
      invocation: {
        mode: 'async_polling',
        endpoint,
        method: 'POST',
        contentType: 'json',
        requestTemplate,
        response: {
          kind: 'task_poll',
          taskIdPaths: ['task_id', 'id'],
          statusEndpoint: '/tasks/{{taskId}}',
          resultPaths: ['data[].url', 'output.url', 'url'],
        },
        polling: {
          intervalMs: 5_000,
          timeoutMs: 600_000,
          statusMap: {
            queued: 'queued',
            pending: 'queued',
            running: 'running',
            processing: 'running',
            succeeded: 'succeeded',
            success: 'succeeded',
            completed: 'succeeded',
            failed: 'failed',
            error: 'failed',
            cancelled: 'cancelled',
          },
        },
      },
      docs: { sourceUrls: [] },
    }
  }

  return {
    id,
    providerKind: 'custom',
    modelId,
    displayName: modelId,
    domains: [input.modelType],
    capabilities: [capability],
    invocation: {
      mode: 'sync',
      endpoint,
      method: 'POST',
      contentType: 'json',
      requestTemplate,
      response: {
        kind: 'url',
        jsonPaths: ['data[].url', 'output.url', 'url'],
        download: true,
      },
    },
    docs: { sourceUrls: [] },
  }
}

function imageGenerateCapability(): MediaModelCapabilityManifest {
  return {
    id: 'image.generate',
    label: '文生图',
    input: { required: ['prompt'] },
    output: { types: ['image'], mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    paramSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        size: { type: 'string', title: '尺寸' },
        aspectRatio: { type: 'string', title: '比例' },
        n: { type: 'integer', title: '数量', minimum: 1, maximum: 16, default: 1 },
        quality: { type: 'string', title: '质量' },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
    defaults: { n: 1 },
  }
}

function videoGenerateCapability(): MediaModelCapabilityManifest {
  return {
    id: 'video.generate',
    label: '文生视频',
    input: { required: ['prompt'] },
    output: { types: ['video'], mimeTypes: ['video/mp4'] },
    paramSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        aspectRatio: { type: 'string', title: '比例' },
        duration: { type: 'integer', title: '时长（秒）', minimum: 1, maximum: 300 },
        resolution: { type: 'string', title: '分辨率' },
        quality: { type: 'string', title: '质量' },
        seed: { type: 'integer', title: '随机种子' },
      },
    },
  }
}

function slugifyModelId(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
