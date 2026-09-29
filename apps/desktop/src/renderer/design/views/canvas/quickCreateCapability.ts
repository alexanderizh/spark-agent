import type {
  CanvasMediaModelSummary,
  CanvasMediaTaskInputFile,
  CanvasOperationType,
  MediaCapabilityId,
} from '@spark/protocol'
import type { QuickCreateMode } from './quickCreateTaskStore'

/** 快速创作表单中的输入素材（在画布输入文件基础上补充本地展示所需字段）。 */
export type QuickCreateInput = CanvasMediaTaskInputFile & {
  id: string
  name: string
  previewUrl: string
}

export const IMAGE_CAPABILITIES: MediaCapabilityId[] = ['image.generate', 'image.edit']
export const VIDEO_CAPABILITIES: MediaCapabilityId[] = [
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
]
/**
 * 语音（TTS）候选能力。协议层 capabilityForOperation('text_to_audio') 会同时给出
 * audio.music 与 audio.speech，且 music 排在前面；不显式携带 capabilityId 时
 * media-router 可能按候选顺序路由到音乐模型，因此语音模式必须锁定 audio.speech。
 */
export const AUDIO_CAPABILITIES: MediaCapabilityId[] = ['audio.speech']

/**
 * 语音识别（STT）候选能力。识别只有 audio.transcription 一个能力，
 * 固定锁定即可，无需按模型声明做候选回退。
 */
export const TRANSCRIBE_CAPABILITIES: MediaCapabilityId[] = ['audio.transcription']

/** 按模式与输入素材推导画布 operation（不含模型上下文）。 */
export function operationFor(
  mode: QuickCreateMode,
  inputs: readonly QuickCreateInput[],
): CanvasOperationType {
  if (mode === 'reverse') return 'image_prompt_reverse'
  if (mode === 'audio') return 'text_to_audio'
  if (mode === 'transcribe') return 'audio_transcribe'
  if (mode === 'image') return inputs.length > 0 ? 'image_edit' : 'text_to_image'
  if (inputs.some((input) => input.type === 'video')) return 'video_edit'
  return inputs.length > 0 ? 'image_to_video' : 'text_to_video'
}

/**
 * 按模式、输入素材与具体模型解析媒体能力候选：取模型声明支持的第一个候选能力；
 * 模型未声明任何候选时回退到候选首项（由兼容模型过滤在提交前剔除不支持的模型）。
 *
 * 视频输入走「参考视频生视频」时不能只盯 video.edit——仅支持 reference_to_video 的模型
 * （如自建 MiniMax H3）会因此被过滤掉，导致选了参考视频后无模型可选。
 */
export function capabilityFor(
  mode: QuickCreateMode,
  inputs: readonly QuickCreateInput[],
  model?: CanvasMediaModelSummary,
): MediaCapabilityId | undefined {
  if (mode === 'reverse') return undefined
  // 语音只有 text_to_audio 一个操作，且必须固定在 audio.speech 上：
  // 不做「模型未声明则回退候选首项」推导，避免回退到 audio.music。
  if (mode === 'audio') return AUDIO_CAPABILITIES[0]
  // 识别同样只有 audio.transcription 一个能力，固定锁定，
  // 兼容模型过滤只保留真正声明了转写能力的模型。
  if (mode === 'transcribe') return TRANSCRIBE_CAPABILITIES[0]
  const candidates: MediaCapabilityId[] =
    mode === 'image'
      ? inputs.length > 0
        ? ['image.edit']
        : IMAGE_CAPABILITIES
      : inputs.some((input) => input.type === 'video')
        ? ['video.reference_to_video', 'video.edit']
        : inputs.length > 0
          ? ['video.image_to_video', 'video.reference_to_video', 'video.generate']
          : ['video.generate', 'video.reference_to_video']
  return (
    candidates.find((id) => model?.capabilities.some((item) => item.id === id)) ?? candidates[0]
  )
}

/**
 * 提交时按已解析能力推导 operation：视频输入走 reference_to_video（参考视频生视频）时
 * 记为 text_to_video，与后端 router 的偏好能力推导保持一致，保证历史重试能还原能力；
 * 其余情况沿用 operationFor 的既有推导。
 */
export function operationForSubmission(
  mode: QuickCreateMode,
  inputs: readonly QuickCreateInput[],
  capability: MediaCapabilityId | undefined,
): CanvasOperationType {
  if (mode === 'audio') return 'text_to_audio'
  if (mode === 'transcribe') return 'audio_transcribe'
  if (capability === 'video.reference_to_video') return 'text_to_video'
  return operationFor(mode, inputs)
}
