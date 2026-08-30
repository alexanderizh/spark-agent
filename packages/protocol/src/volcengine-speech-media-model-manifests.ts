/**
 * 火山豆包语音（Volcengine Speech）音频模型清单。
 *
 * 与方舟（volcengine-ark）分属独立 provider：
 *   - 方舟：ark.cn-beijing.volces.com，Bearer 鉴权，图片/视频
 *   - 语音：openspeech.bytedance.com，X-Api-Key 鉴权，音频生成/语音合成
 *
 * 凭证来源不同控制台、域名/鉴权头不同，因此独立成 provider。
 * 参数与枚举核对自 docs/integrations/volcengine/music.md（seed-audio-1.0）
 * 与 docs/integrations/volcengine/tts.md（seed-tts-2.0 单向流式）。
 *
 * 本清单的 invocation 仅供 UI/文档/template fallback 展示；实际请求由专用 adapter
 * volcengine-speech-media.adapter.ts 接管（与 ark 同模式：嵌套对象结构模板插值无法表达）。
 */

import type {
  MediaDomain,
  MediaInvocationMode,
  MediaManifestInputKind,
  MediaManifestOutputKind,
  MediaModelManifest,
} from './media-model-manifest.js'
import { volcengineAudioSchema, volcengineSpeechSchema } from './media-model-shared-manifest-parts.js'

const SEED_AUDIO_DOC = 'https://www.volcengine.com/docs/6561/2550782'
const SEED_TTS_DOC = 'https://www.volcengine.com/docs/6561/2528925'

export const VOLCENGINE_SPEECH_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
  {
    id: 'volcengine-speech:seed-audio-1.0',
    providerKind: 'volcengine-speech',
    modelId: 'seed-audio-1.0',
    displayName: '豆包音频生成 1.0',
    domains: ['audio'] as MediaDomain[],
    capabilities: [
      {
        id: 'audio.music',
        label: '文生音频',
        input: { required: ['text'] as MediaManifestInputKind[] },
        output: {
          types: ['audio'] as MediaManifestOutputKind[],
          mimeTypes: ['audio/wav', 'audio/mpeg', 'audio/pcm', 'audio/ogg'],
        },
        paramSchema: volcengineAudioSchema,
        defaults: {
          format: 'wav',
          speech_rate: 0,
          loudness_rate: 0,
          pitch_rate: 0,
        },
      },
    ],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/api/v3/tts/create',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: 'seed-audio-1.0',
        text_prompt: '{{text_prompt}}',
        speaker: '{{speaker}}',
        audio_config: {
          format: '{{format}}',
          sample_rate: '{{sample_rate}}',
          speech_rate: '{{speech_rate}}',
          loudness_rate: '{{loudness_rate}}',
          pitch_rate: '{{pitch_rate}}',
        },
      },
      response: {
        kind: 'url',
        jsonPaths: ['url'],
        download: true,
      },
    },
    docs: { sourceUrls: [SEED_AUDIO_DOC], lastCheckedAt: '2026-08-11' },
    // 文档未给出 text_prompt 硬上限；此值仅作前端输入框软提示，非官方限制。
    safety: { maxPromptLength: 5000 },
  },
  {
    id: 'volcengine-speech:seed-tts-2.0',
    providerKind: 'volcengine-speech',
    modelId: 'seed-tts-2.0',
    displayName: '豆包语音合成 2.0',
    domains: ['audio'] as MediaDomain[],
    capabilities: [
      {
        id: 'audio.speech',
        label: '语音合成',
        input: { required: ['text'] as MediaManifestInputKind[] },
        output: {
          types: ['audio'] as MediaManifestOutputKind[],
          mimeTypes: ['audio/mpeg', 'audio/pcm', 'audio/ogg', 'audio/wav'],
        },
        paramSchema: volcengineSpeechSchema,
        defaults: {
          format: 'mp3',
          speech_rate: 0,
          loudness_rate: 0,
        },
      },
    ],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/api/v3/tts/unidirectional',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        req_params: { text: '{{text}}', speaker: '{{speaker}}' },
        audio_params: {
          format: '{{format}}',
          sample_rate: '{{sample_rate}}',
          bit_rate: '{{bit_rate}}',
          speech_rate: '{{speech_rate}}',
          loudness_rate: '{{loudness_rate}}',
        },
      },
      // 单向流式接口：响应为 HTTP Chunked 二进制音频流，adapter 累积 chunk 落盘。
      response: { kind: 'binary_response' },
    },
    docs: { sourceUrls: [SEED_TTS_DOC], lastCheckedAt: '2026-08-11' },
    // 单向流式支持长文本；此值仅作前端软提示。
    safety: { maxPromptLength: 10000 },
  },
]
