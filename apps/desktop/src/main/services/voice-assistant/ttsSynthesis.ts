/**
 * ttsSynthesis — TTS 合成共享内核（主进程）
 *
 * 从 VoiceAssistantService.synthesizeSentence 抽出的渠道/模型/音色决策与媒体路由
 * 调用，供两条链路复用：
 * - 语音助手流式播报（服务内持 Live settings，不走缓存：句子重复率极低）
 * - 消息语音播报按钮（IPC 无状态调用，现读现用语音助手设置，走 ttsSpeechCache）
 *
 * 渠道/模型/音色口径：显式指定（ttsProviderProfileId/ttsModelId/ttsVoice）优先；
 * 未指定时取第一个支持 audio.speech 的渠道与渠道默认模型/音色，MiniMax 专有参数
 * 仅对 minimax-hailuo 渠道下发。另含 TTS 产物清理（路径逃逸防护）。
 *
 * 缓存键与合成同源：resolveTtsRoute 一次解析出「实际参数 + 实际渠道/模型」，
 * 同一份 route 既驱动 invoke 也驱动缓存键，杜绝「设置变了命中旧音频」。
 *
 * 渠道合成失败（未配置渠道 / 调用失败）时经 ttsLocalFallback 落回系统自带语音
 * 合成（详见该模块头注释）；语音助手流式播报与消息播报两条链路同源生效。
 */

import { mkdir, unlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { createLogger } from '@spark/shared'
import type { VoiceAssistantSettings } from '@spark/protocol'
import type { MediaProviderProfile, MediaRouterService } from '@spark/agent-runtime'
import { computeTtsCacheKey, type TtsSpeechCache } from './ttsSpeechCache.js'
import { synthesizeSpeechLocally } from './ttsLocalFallback.js'

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
  /** 是否启用 ttsSpeechCache 磁盘缓存（消息播报开启；流式链路默认关闭） */
  useCache?: boolean
  /** useCache=true 时必填；命中零请求，未命中合成后落盘 */
  speechCache?: TtsSpeechCache
}

export interface TtsSynthesisResult {
  filePath: string
  provider: string
  /** 文件是否由磁盘缓存接管（命中，或刚合成成功并移入缓存）：调用方不得删除该文件 */
  cached: boolean
}

export interface TtsResolvedRoute {
  /** 解析到的渠道 profile id（显式设置优先，取不到回落 null，缓存跳过） */
  providerId: string | null
  /** 解析后的实际模型 id（显式 ttsModelId → 渠道首个 speech manifest → 渠默认模型；取不到为 null） */
  modelId: string | null
  /** 实际下发给渠道的合成参数（speed/voice/vol/pitch/emotion） */
  modelParams: Record<string, unknown>
  /** 下发给 invoke 的渠道锁定（仅显式设置时下发） */
  invokeProviderProfileId: string | null
}

/**
 * 渠道默认 TTS 模型口径：与 media-router invoke 的 effectiveModelId 完全同源——
 * 显式 modelId 优先，其后首个声明 audio.speech 的 manifest.modelId（invoke 内
 * resolveManifestMatch 无显式 modelId 时取 candidates[0]），最后回落渠道
 * defaultModel。缓存键必须用这个口径：manifest 增删/换序时 defaultModel 可能
 * 没变但实际请求模型已变，键若只看 defaultModel 会命中旧模型音频。
 */
function effectiveSpeechModelId(provider: MediaProviderProfile | undefined): string | null {
  if (provider == null) return null
  const manifestModelId = provider.mediaModelManifests?.find((manifest) =>
    manifest.capabilities.some((item) => item.id === 'audio.speech'),
  )?.modelId
  return manifestModelId ?? provider.defaultModel ?? null
}

/**
 * 解析 TTS 合成路线（纯函数）：渠道/模型/音色决策一次成型，invoke 与缓存键共用，
 * 保证「配置变化 → 键变化」与「实际请求参数」完全同源。
 */
export function resolveTtsRoute(
  settings: VoiceAssistantSettings,
  providers: MediaProviderProfile[],
  supports: (provider: MediaProviderProfile, capability: 'audio.speech') => boolean,
): TtsResolvedRoute {
  const modelParams: Record<string, unknown> = { speed: settings.ttsSpeed }
  if (settings.ttsVoice.trim().length > 0) modelParams.voice = settings.ttsVoice.trim()
  // MiniMax 专有参数（vol/pitch/emotion）仅对 minimax-hailuo 渠道下发：
  // 其他渠道 manifest 若开启透传会把未知字段传给供应商引发 400，缺失时编译器回落渠道默认。
  // 自动选路必须复用 mediaRouter.supports（内部经 profileSupportsMediaCapability 以模型级
  // manifest 声明优先，无 manifest 旧渠道回退渠道级声明 + adapter）：与 invoke 内部的渠道
  // 选择完全同源，避免渠道级误声明 audio.speech 的 ASR 渠道在此抢先命中、与实际路由到的
  // TTS 渠道不一致（MiniMax 专有参数会错发给另一家渠道）。
  const chosen =
    settings.ttsProviderProfileId != null
      ? providers.find((provider) => provider.id === settings.ttsProviderProfileId)
      : providers.find((provider) => supports(provider, 'audio.speech'))
  if (chosen?.mediaProvider === 'minimax-hailuo') {
    if (settings.ttsVol !== 1) modelParams.vol = settings.ttsVol
    if (settings.ttsPitch !== 0) modelParams.pitch = settings.ttsPitch
    if (settings.ttsEmotion.trim().length > 0) modelParams.emotion = settings.ttsEmotion.trim()
  }
  return {
    providerId: chosen?.id ?? settings.ttsProviderProfileId ?? null,
    modelId: settings.ttsModelId ?? effectiveSpeechModelId(chosen),
    modelParams,
    invokeProviderProfileId: settings.ttsProviderProfileId ?? null,
  }
}

/**
 * 合成一段文本为音频文件。渠道合成任何失败（未配置渠道 / 调用失败 / 无文件产物）
 * 且设置 ttsLocalFallback 开启时，回落操作系统自带语音合成（say/SAPI/espeak-ng）
 * 产 wav 落 ttsDir——播放链路（safe-file + WebAudio + 打断/看门狗/HUD）完全复用，
 * 兜底产物不入磁盘缓存（渠道恢复后自动回到云端合成）。两级都失败抛组合错误，
 * 由调用方决定降级策略（流水线跳句 / IPC 错误响应）。
 */
export async function synthesizeSpeechText(
  target: TtsSynthesisTarget,
  sentence: string,
): Promise<TtsSynthesisResult> {
  try {
    return await synthesizeViaChannel(target, sentence)
  } catch (channelError) {
    if (target.settings.ttsLocalFallback === false) throw channelError
    const channelMessage = channelError instanceof Error ? channelError.message : String(channelError)
    log.warn(`[voice-assistant] tts channel failed, falling back to local system voice: ${channelMessage}`)
    try {
      const local = await synthesizeSpeechLocally({
        text: sentence.slice(0, TTS_SYNTHESIS_MAX_TEXT_CHARS),
        speed: target.settings.ttsSpeed,
        outputDir: target.outputDir,
      })
      return { filePath: local.filePath, provider: `local-fallback:${local.engine}`, cached: false }
    } catch (localError) {
      const localMessage = localError instanceof Error ? localError.message : String(localError)
      log.warn(`[voice-assistant] local tts fallback also failed: ${localMessage}`)
      throw new Error(
        `语音合成失败（渠道与本地兜底均失败）：${channelMessage}｜本地兜底：${localMessage}`,
        { cause: localError },
      )
    }
  }
}

/**
 * 云端渠道路径（原 synthesizeSpeechText 主体）。启用缓存时：命中直接返回缓存文件
 * （零请求）；未命中合成后移入缓存并返回缓存路径，失败（put 返回 null）时回退
 * 临时产物路径。
 */
async function synthesizeViaChannel(
  target: TtsSynthesisTarget,
  sentence: string,
): Promise<TtsSynthesisResult> {
  await mkdir(target.outputDir, { recursive: true })
  const providers = await target.resolveMediaProviders()
  if (providers.length === 0) {
    throw new Error('未配置支持语音合成的多媒体渠道')
  }
  const settings = target.settings
  const route = resolveTtsRoute(settings, providers, (provider, capability) =>
    target.mediaRouter.supports(provider, capability),
  )
  // 渠道/模型任一解析不出（如显式渠道不在列表且无显式模型）时跳过缓存：
  // 键与实际路由不同源，宁可 miss 也不冒错命中风险
  const cache =
    target.useCache === true && target.speechCache != null && route.modelId != null
      ? target.speechCache
      : null
  const cacheKey =
    route.providerId != null && cache != null
      ? computeTtsCacheKey({
          providerId: route.providerId,
          modelId: route.modelId ?? '',
          params: route.modelParams,
          text: sentence,
        })
      : null
  if (cache != null && cacheKey != null) {
    const cached = await cache.get(cacheKey)
    if (cached != null) {
      log.info(
        `[voice-assistant] tts cache hit (key=${cacheKey.slice(0, 8)}…, text=${sentence.slice(0, 16)}…)`,
      )
      return { filePath: cached, provider: route.providerId ?? 'unknown', cached: true }
    }
  }
  const startedAt = Date.now()
  const { output } = await target.mediaRouter.invoke(
    {
      operation: 'text_to_audio',
      capability: 'audio.speech',
      prompt: sentence.slice(0, TTS_SYNTHESIS_MAX_TEXT_CHARS),
      modelParams: route.modelParams,
      outputDir: target.outputDir,
    },
    {
      providers,
      ...(route.invokeProviderProfileId != null
        ? { providerProfileId: route.invokeProviderProfileId }
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
  // put 内部 rename：成功后原 temp 产物即缓存文件本身，生命周期移交 LRU——
  // 必须按 cached=true 上报：否则渲染端把它当临时产物，解码后调 tts-cleanup
  // 删除（缓存目录在 ttsDir 外时被拒并刷「outside ttsDir」告警，在内时把
  // 刚建好的缓存条目直接删掉，缓存永远不命中）。失败回落原临时路径（sweep 兜底清理）
  if (cache != null && cacheKey != null) {
    const cachedPath = await cache.put(cacheKey, filePath)
    if (cachedPath != null) return { filePath: cachedPath, provider: output.provider, cached: true }
  }
  return { filePath, provider: output.provider, cached: false }
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
