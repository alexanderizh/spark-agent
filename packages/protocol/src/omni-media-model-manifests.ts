import type {
  MediaManifestInputKind,
  MediaManifestOutputKind,
  MediaModelManifest,
} from './media-model-manifest.js'
import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from './media-config.js'
import { googleOmniVideoSchema } from './media-model-shared-manifest-parts.js'

export const OMNI_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
  {
    id: 'omni:gemini-omni-flash-preview',
    providerKind: 'omni',
    modelId: 'gemini-omni-flash-preview',
    displayName: 'Gemini Omni Flash Preview',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.generate',
        label: '对话式文生视频',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleOmniVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      },
      {
        id: 'video.image_to_video',
        label: '图生视频 / 视频编辑',
        input: {
          required: ['prompt', 'image'] as MediaManifestInputKind[],
          maxImages: 3,
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleOmniVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      },
      {
        id: 'video.edit',
        label: '自然语言视频编辑',
        input: {
          required: ['prompt', 'video'] as MediaManifestInputKind[],
          acceptedMimeTypes: ['video/mp4', 'video/webm'],
        },
        output: { types: ['video'] as MediaManifestOutputKind[], mimeTypes: ['video/mp4'] },
        paramSchema: googleOmniVideoSchema,
        defaults: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/models/{{modelId}}:predictLongRunning',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { instances: [{ prompt: '{{prompt}}' }] },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['name'],
        statusEndpoint: '/{{taskId}}',
        resultPaths: [
          'response.generateVideoResponse.generatedSamples[].video.uri',
          'response.generatedVideos[].video.uri',
        ],
      },
      polling: {
        intervalMs: 10000,
        timeoutMs: DEFAULT_VIDEO_POLL_TIMEOUT_MS,
        statusMap: { pending: 'queued', running: 'running', done: 'succeeded', failed: 'failed' },
      },
    },
    docs: {
      sourceUrls: ['https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash'],
      lastCheckedAt: '2026-07-01',
    },
    safety: {
      maxPromptLength: 32000,
      allowLocalFiles: true,
      maxInputBytes: 100 * 1024 * 1024,
    },
  },
]
