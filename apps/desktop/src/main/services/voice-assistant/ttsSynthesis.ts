/**
 * ttsSynthesis — TTS 合成共享内核（主进程）
 *
 * 从 VoiceAssistantService.synthesizeSentence 抽出的渠道/模型/音色决策与媒体路由
 * 调用，供两条链路复用：
 * - 语音助手流式播报（服务内持 Live settings）
 * - 消息语音播报按钮（IPC 无状态调用，现读现用语音助手设置）
 *
 * 渠道/模型/音色口径：显式指定（ttsProviderProfileId/ttsModelId/ttsVoice）优先；
 * 未指定时取第一个支持 audio.speech 的渠道与渠道默认模型/音色，MiniMax 专有参数
 * 仅对 minimax-hailuo 渠道下发。另含 TTS 产物清理（路径逃逸防护）。
 */

import { mkdir, unlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { createLogger } from '@spark/shared'
import type { VoiceAssistantSettings } from '@spark/protocol'
import type { MediaProviderProfile, MediaRouterService } from '@spark/agent-runtime'

const log = createLogger('voice-assistant')

/** 单次合成文本的兜底限长（渲染端已按句切分，这里防异常超长输入打爆渠道） */
export const TTS_SYNTHESIS_MAX_TEXT_CHARS = 10_000

export interface TtsSynthesisTarget {
  /** 语音助手设置（TTS 渠道/模型/音色/语速等来源） */
  settings: VoiceAssistantSettings
  /** TTS 渠道解析（带 API key 的 provider 列表） */
  resolveMediaProviders(): Promise<MediaProviderProfile[]>
  /** 媒体路由（TTS 合成） */
  mediaRouter: MediaRouterService
  /** 音频产物输出目录 */
  outputDir: string
}

export interface TtsSynthesisResult {
  filePath: string
  provider: string
}

/**
 * 合成一段文本为音频文件。抛错由调用方决定降级策略（流水线跳句 / IPC 错误响应）。
 */
export async function synthesizeSpeechText(
  target: TtsSynthesisTarget,
  sentence: string,
): Promise<TtsSynthesisResult> {
  await mkdir(target.outputDir, { recursive: true })
  const providers = await target.resolveMediaProviders()
  if (providers.length === 0) {
    throw new Error('未配置支持语音合成的多媒体渠道')
  }
  const settings = target.settings
  const modelParams: Record<string, unknown> = { speed: settings.ttsSpeed }
  if (settings.ttsVoice.trim().length > 0) modelParams.voice = settings.ttsVoice.trim()
  // MiniMax 专有参数（vol/pitch/emotion）仅对 minimax-hailuo 渠道下发：
  // 其他渠道 manifest 若开启透传会把未知字段传给供应商引发 400，缺失时编译器回落渠道默认。
  // 自动选路必须复用 mediaRouter.supports（内部经 profileSupportsMediaCapability 以模型级
  // manifest 声明优先，无 manifest 旧渠道回退渠道级声明 + adapter）：与 invoke 内部的渠道
  // 选择完全同源，避免渠道级误声明 audio.speech 的 ASR 渠道在此抢先命中、与实际路由到的
  // TTS 渠道不一致（MiniMax 专有参数会错发给另一家渠道）。
  const chosenProvider =
    settings.ttsProviderProfileId != null
      ? providers.find((provider) => provider.id === settings.ttsProviderProfileId)
      : providers.find((provider) => target.mediaRouter.supports(provider, 'audio.speech'))
  if (chosenProvider?.mediaProvider === 'minimax-hailuo') {
    if (settings.ttsVol !== 1) modelParams.vol = settings.ttsVol
    if (settings.ttsPitch !== 0) modelParams.pitch = settings.ttsPitch
    if (settings.ttsEmotion.trim().length > 0) modelParams.emotion = settings.ttsEmotion.trim()
  }
  const startedAt = Date.now()
  const { output } = await target.mediaRouter.invoke(
    {
      operation: 'text_to_audio',
      capability: 'audio.speech',
      prompt: sentence.slice(0, TTS_SYNTHESIS_MAX_TEXT_CHARS),
      modelParams,
      outputDir: target.outputDir,
    },
    {
      providers,
      ...(settings.ttsProviderProfileId != null
        ? { providerProfileId: settings.ttsProviderProfileId }
        : {}),
      ...(settings.ttsModelId != null ? { modelId: settings.ttsModelId } : {}),
    },
  )
  const filePath = output.assets.find((asset) => asset.filePath != null)?.filePath
  if (filePath == null) {
    throw new Error(`TTS 无文件产物 (provider=${output.provider})`)
  }
  log.info(
    `[voice-assistant] tts synthesized in ${Date.now() - startedAt}ms (${output.provider}, ${
      filePath.split('/').pop() ?? ''
    })`,
  )
  return { filePath, provider: output.provider }
}

/**
 * 删除 TTS 目录内的产物文件。filePath 必须落在 ttsDir 内（解析真实路径后做前缀
 * 校验，拒绝 ../ 与符号链接逃逸），未命中或删除失败返回 false（文件可能已被清扫）。
 */
export async function removeTtsArtifactWithin(ttsDir: string, filePath: string): Promise<boolean> {
  if (ttsDir.length === 0 || filePath.length === 0) return false
  const resolvedDir = resolve(ttsDir)
  const resolvedFile = resolve(filePath)
  const rel = relative(resolvedDir, resolvedFile)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    log.warn(`[voice-assistant] tts artifact cleanup rejected (outside ttsDir): ${filePath}`)
    return false
  }
  try {
    await unlink(resolvedFile)
    return true
  } catch {
    // 不存在/已被删除：按未删除上报，渲染端无需重试
    return false
  }
}
