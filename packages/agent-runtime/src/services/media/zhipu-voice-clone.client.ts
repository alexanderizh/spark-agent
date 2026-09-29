/**
 * 智谱音色复刻闭环：上传示例音频 → 复刻 → 删除。
 *
 * 官方流程（核对自 https://docs.bigmodel.cn/openapi/openapi.json）：
 *   1. `POST /paas/v4/files`（multipart：`file` + `purpose=voice-clone-input`）
 *      上传示例音频，得到 `file_id`。支持 mp3 / wav，单文件 ≤ 10MB，
 *      建议时长 3–30 秒。
 *   2. `POST /paas/v4/voice/clone`（JSON）
 *      `{ model:'glm-tts-clone', voice_name, input, file_id, text? }`
 *      `input` 是必填的**试听文本**，`text` 是示例音频对应的文本（选填，可提升质量）。
 *      返回新音色 `voice`（后续作为 GLM-TTS 的 `voice` 参数值）与试听音频 `file_id`。
 *   3. `POST /paas/v4/voice/delete`（JSON `{ voice }`）删除不想要的复刻音色。
 *
 * 复刻成功不代表候选已更新：调用方（ProviderService）随后会重新拉一次
 * `/voice/list` 刷新 `mediaDynamicParamOptions`，复刻音色才会出现在
 * 画布 / 快速创作的音色候选里。
 *
 * 刻意不下载试听音频（响应里的 `file_id` 指向 `/files/{id}/content`）：
 * 平台侧用「同一音色生成一段 TTS」来试听更直接，产物也能直接落进画布，
 * 不必为固定文本的试听段单独维护一条文件下载链路。
 */

import { readFile } from 'node:fs/promises'
import { createLogger } from '@spark/shared'
import { MediaProviderError } from './media-adapter.types.js'
import {
  requestZhipuVoiceJson,
  requestZhipuVoiceMultipart,
  type ZhipuVoiceApiTarget,
} from './zhipu-voice-api.js'

const log = createLogger('zhipu:voice-clone')

/** 复刻专用模型（官方 VoiceCloneRequest.model 仅此一个取值）。 */
export const ZHIPU_VOICE_CLONE_MODEL = 'glm-tts-clone'

/** 示例音频单文件上限（官方：不超过 10MB）。 */
export const ZHIPU_VOICE_CLONE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024

/** 官方支持的示例音频格式。 */
export const ZHIPU_VOICE_CLONE_SAMPLE_EXTENSIONS = ['mp3', 'wav'] as const

/** 试听文本缺省值：官方 `input` 必填，但它只影响试听段内容，不该拦住复刻动作。 */
export const ZHIPU_VOICE_CLONE_DEFAULT_PREVIEW_TEXT = '你好，这是音色复刻的试听示例。'

/** 上传后的文件对象（官方 FileObject，仅保留平台用到的字段）。 */
interface ZhipuFileObject {
  id?: unknown
  bytes?: unknown
  filename?: unknown
}

interface ZhipuVoiceCloneResponse {
  voice?: unknown
  file_id?: unknown
}

export interface CloneZhipuVoiceInput extends ZhipuVoiceApiTarget {
  /** 示例音频本地绝对路径。 */
  samplePath: string
  /** 音色名（渠道内唯一）。 */
  voiceName: string
  /** 试听文本；缺省用 {@link ZHIPU_VOICE_CLONE_DEFAULT_PREVIEW_TEXT}。 */
  previewText?: string
  /** 示例音频对应的文本，选填。 */
  sampleText?: string
  /** 注入文件读取（测试用）。 */
  readFileImpl?: (path: string) => Promise<Buffer>
}

export interface CloneZhipuVoiceResult {
  /** 新音色 id，可直接作为 GLM-TTS 的 `voice` 参数值。 */
  voice: string
  /** 官方生成的试听音频文件 id（平台不下载，仅回传便于排查）。 */
  previewFileId?: string
  /** 示例音频上传后的 file_id。 */
  sampleFileId: string
}

/**
 * 复刻音色：先上传示例音频，再调用复刻接口。
 *
 * 任一步失败都抛 `MediaProviderError`，消息保留厂商原文，便于用户在渠道页看到
 * 真实原因（格式不支持、时长超限、音色名重复等）。
 */
export async function cloneZhipuVoice(input: CloneZhipuVoiceInput): Promise<CloneZhipuVoiceResult> {
  const voiceName = input.voiceName.trim()
  if (!voiceName) {
    throw new MediaProviderError('invalid_input', '请填写音色名称')
  }
  const sampleFileId = await uploadVoiceCloneSample(input)
  const payload = await requestZhipuVoiceJson<ZhipuVoiceCloneResponse>(
    input,
    '音色复刻',
    '/voice/clone',
    {
      method: 'POST',
      body: JSON.stringify({
        model: ZHIPU_VOICE_CLONE_MODEL,
        voice_name: voiceName,
        input: input.previewText?.trim() || ZHIPU_VOICE_CLONE_DEFAULT_PREVIEW_TEXT,
        file_id: sampleFileId,
        ...(input.sampleText?.trim() ? { text: input.sampleText.trim() } : {}),
      }),
    },
  )
  const voice = typeof payload?.voice === 'string' ? payload.voice.trim() : ''
  if (!voice) {
    // 2xx 但没给出音色 id：无法在后续同步里定位，按失败处理而不是静默当作成功。
    throw new MediaProviderError('provider_http_error', '音色复刻未返回音色 id')
  }
  log.info(`cloned voice ok, voice=${voice}, voiceName=${voiceName}, sampleFileId=${sampleFileId}`)
  return {
    voice,
    sampleFileId,
    ...(typeof payload?.file_id === 'string' && payload.file_id.trim()
      ? { previewFileId: payload.file_id.trim() }
      : {}),
  }
}

/** 删除复刻音色（官方只按 `voice` 删除）。 */
export async function deleteZhipuVoice(
  input: ZhipuVoiceApiTarget & { voice: string },
): Promise<void> {
  const voice = input.voice.trim()
  if (!voice) throw new MediaProviderError('invalid_input', '缺少要删除的音色 id')
  await requestZhipuVoiceJson<unknown>(input, '删除音色', '/voice/delete', {
    method: 'POST',
    body: JSON.stringify({ voice }),
  })
  log.info(`deleted voice ok, voice=${voice}`)
}

/**
 * 上传音色复刻的示例音频。
 *
 * 官方对 `voice-clone-input` 的限制在本地先拦一道（格式 / 体积），避免把明显不合规的
 * 文件传到厂商再等一个 400；本地拦不住的部分（时长 3–30 秒、音频内容质量）
 * 仍由厂商判定。
 */
async function uploadVoiceCloneSample(input: CloneZhipuVoiceInput): Promise<string> {
  const samplePath = input.samplePath.trim()
  if (!samplePath) throw new MediaProviderError('invalid_input', '请选择示例音频文件')
  const extension = samplePath.split('.').pop()?.toLowerCase() ?? ''
  if (!(ZHIPU_VOICE_CLONE_SAMPLE_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new MediaProviderError(
      'invalid_input',
      `示例音频仅支持 ${ZHIPU_VOICE_CLONE_SAMPLE_EXTENSIONS.join(' / ')} 格式`,
    )
  }
  const readFileImpl = input.readFileImpl ?? readFile
  let buffer: Buffer
  try {
    buffer = await readFileImpl(samplePath)
  } catch (error) {
    throw new MediaProviderError(
      'invalid_input',
      `无法读取示例音频：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (buffer.byteLength > ZHIPU_VOICE_CLONE_SAMPLE_MAX_BYTES) {
    throw new MediaProviderError(
      'invalid_input',
      `示例音频不能超过 ${ZHIPU_VOICE_CLONE_SAMPLE_MAX_BYTES / 1024 / 1024}MB`,
    )
  }

  const form = new FormData()
  form.append('purpose', 'voice-clone-input')
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: extension === 'wav' ? 'audio/wav' : 'audio/mpeg' }),
    samplePath.split(/[\\/]/).pop() ?? `sample.${extension}`,
  )
  const payload = await requestZhipuVoiceMultipart<ZhipuFileObject>(
    input,
    '示例音频上传',
    '/files',
    form,
  )
  const fileId = typeof payload?.id === 'string' ? payload.id.trim() : ''
  if (!fileId) {
    throw new MediaProviderError('provider_http_error', '示例音频上传未返回文件 id')
  }
  return fileId
}
