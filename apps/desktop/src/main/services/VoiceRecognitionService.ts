import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createLogger } from '@spark/shared'
import type { VoiceLanguage, VoiceRecognitionEvent, VoiceStartRequest } from '@spark/protocol'
import { resolveVoiceModelPaths, resolveVoiceRefinePaths } from './VoiceIntegrityService.js'
import {
  MIN_VOICED_MS_FOR_FINAL,
  VoiceNoiseGate,
  resetVoiceNoiseGateVad,
} from './voice-assistant/VoiceNoiseGate.js'
import { VoiceTransientGuard } from './voice-assistant/VoiceTransientGuard.js'

const log = createLogger('voice-recognition')

// ─── sherpa-onnx-node 最小类型声明（动态 require，真实类型由 native 模块提供）─────────

interface SherpaOnlineStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
  inputFinished(): void
}

interface SherpaOnlineRecognizerResult {
  text: string
  tokens?: string[]
  is_final?: boolean
}

interface SherpaOnlineRecognizer {
  createStream(): SherpaOnlineStream
  isReady(stream: SherpaOnlineStream): boolean
  decode(stream: SherpaOnlineStream): void
  isEndpoint(stream: SherpaOnlineStream): boolean
  reset(stream: SherpaOnlineStream): void
  getResult(stream: SherpaOnlineStream): SherpaOnlineRecognizerResult
}

interface SherpaOnlineRecognizerConfig {
  featConfig?: { sampleRate: number; featureDim: number }
  modelConfig: {
    paraformer?: { encoder: string; decoder: string }
    transducer?: { encoder: string; decoder: string; joiner: string }
    zipformer2Ctc?: { model: string }
    nemoCtc?: { model: string }
    tokens: string
    numThreads?: number
    debug?: boolean
    provider?: string
  }
  decodingMethod?: string
  enableEndpoint?: boolean
  rule1MinTrailingSilence?: number
  rule2MinTrailingSilence?: number
  rule3MinUtteranceLength?: number
  blankPenalty?: number
}

interface SherpaOfflineStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
}

interface SherpaOfflineRecognizerResult {
  text: string
  tokens?: string[]
  timestamps?: number[]
}

interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream
  decode(stream: SherpaOfflineStream): void
  getResult(stream: SherpaOfflineStream): SherpaOfflineRecognizerResult
}

interface SherpaOfflineRecognizerConfig {
  featConfig?: { sampleRate: number; featureDim: number }
  modelConfig: {
    senseVoice?: {
      model: string
      language?: string
      useInverseTextNormalization?: number | boolean
    }
    tokens: string
    numThreads?: number
    debug?: boolean
    provider?: string
  }
  decodingMethod?: string
}

interface SherpaModule {
  OnlineRecognizer: new (config: SherpaOnlineRecognizerConfig) => SherpaOnlineRecognizer
  /** 离线识别器：用于说话结束后整段精修；旧 native 包缺失时精修自动降级。 */
  OfflineRecognizer?: new (config: SherpaOfflineRecognizerConfig) => SherpaOfflineRecognizer
}

interface VoiceModelDescriptor {
  version: string
  encoder: string
  decoder: string
  tokens: string
}

interface VoiceSession {
  sessionId: string
  ownerId: number
  recognizer: SherpaOnlineRecognizer
  stream: SherpaOnlineStream
  sampleRate: number
  /** 上一帧 partial 文本，用于判断是否需要推送（整体替换） */
  lastPartial: string
  /** 语种提示，离线精修时映射到 SenseVoice language 参数 */
  language: VoiceLanguage
  /** 会话内已锁定的分段 final（endpoint 句 + 停止 flush 句），精修失败时由 UI 保留这些文本 */
  finals: string[]
  /** 录音期间缓存的原始 PCM chunk（IPC 结构化克隆产物，可安全持有），供停止后整段精修 */
  pcmChunks: Int16Array[]
  /**
   * pcmChunks 已裁剪的头部采样数（全双工长会话按轮 trim 已消费音频后的累计值）。
   * totalSamples 是会话累计游标（含已裁剪部分，绝不回退）；按绝对采样偏移取区间
   * 时须减去本值得到 chunks 内的相对位置。
   */
  droppedSamples: number
  totalSamples: number
  /**
   * 环境噪音门控：standard/strict 会话为完整门控；noiseGate off/缺省会话为
   * confirm-only 实例（音频流不动，仅 silero 时间轴 + final 接受判定）。
   */
  noiseGate: VoiceNoiseGate | null
  /** 非人声瞬态旁路守卫（仅 confirm-only 会话创建：silero 不可用时的兜底票） */
  transientGuard: VoiceTransientGuard | null
  /** 上一个已接受 final 的音频结束偏移（silero 覆盖率校验区间的起点） */
  lastFinalEndSample: number
  /** 被 confirm-only 三票决策拒绝丢弃的 final 计数（日志观测用） */
  droppedTransientFinals: number
}

type VoiceEventEmitter = (event: VoiceRecognitionEvent, ownerId: number) => void

let cachedModule: SherpaModule | null = null
let cachedRecognizer: { recognizer: SherpaOnlineRecognizer; configKey: string } | null = null
let cachedRefineRecognizer: { recognizer: SherpaOfflineRecognizer; configKey: string } | null = null
let sessionCounter = 0
const sessions = new Map<string, VoiceSession>()

/** 供单元测试注入 mock native 模块，避免依赖真实语音包。 */
let moduleOverride: SherpaModule | null = null
export function setVoiceModuleForTests(mod: SherpaModule | null): void {
  moduleOverride = mod
}

function loadSherpaModule(): SherpaModule {
  if (moduleOverride) return moduleOverride
  if (cachedModule) return cachedModule
  const paths = resolveVoiceModelPaths()
  if (!paths) {
    throw new Error('语音识别运行时未就绪，请先在设置中安装语音包')
  }
  if (!existsSync(paths.nativeMain)) {
    throw new Error(`语音 native 模块入口缺失: ${paths.nativeMain}`)
  }
  const req = createRequire(import.meta.url)
  // require nativeMain 指向 sherpa-onnx-node 的 JS wrapper，内部相对 require .node 二进制
  const mod = req(paths.nativeMain) as SherpaModule
  if (!mod || typeof mod.OnlineRecognizer !== 'function') {
    throw new Error('语音 native 模块加载失败：缺少 OnlineRecognizer 导出')
  }
  cachedModule = mod
  log.info(`Voice native module loaded from ${paths.nativeMain}`)
  return mod
}

function readModelDescriptor(modelDir: string): VoiceModelDescriptor {
  const pkgPath = join(modelDir, 'model-package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`模型描述文件缺失: ${pkgPath}`)
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    version?: unknown
    encoder?: unknown
    decoder?: unknown
    tokens?: unknown
  }
  if (
    typeof pkg.encoder !== 'string' ||
    typeof pkg.decoder !== 'string' ||
    typeof pkg.tokens !== 'string'
  ) {
    throw new Error('model-package.json 缺少 encoder/decoder/tokens 字段')
  }
  const resolveModelFile = (relativePath: string, label: string): string => {
    const root = resolve(modelDir)
    const candidate = resolve(root, relativePath)
    if (candidate === root || !candidate.startsWith(`${root}${sep}`) || !existsSync(candidate)) {
      throw new Error(`model-package.json 中的 ${label} 路径无效`)
    }
    return candidate
  }
  return {
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    encoder: resolveModelFile(pkg.encoder, 'encoder'),
    decoder: resolveModelFile(pkg.decoder, 'decoder'),
    tokens: resolveModelFile(pkg.tokens, 'tokens'),
  }
}

// Paraformer 在线模型的尾部 token 发射有数百毫秒延迟；endpoint 触发时直接 reset 会把
// 还滞留在解码管线里的句尾字吞掉（短句场景每个短句必掉尾字）。
const ENDPOINT_FLUSH_SILENCE_SECONDS = 0.64
// 手动停止时的尾部静音 padding，同样需要覆盖发射延迟，否则最后几个字丢失。
const STOP_TAIL_PADDING_SECONDS = 0.75

function buildRecognizerConfig(
  params: VoiceStartRequest,
  descriptor: VoiceModelDescriptor,
): { config: SherpaOnlineRecognizerConfig; key: string } {
  const sampleRate = params.sampleRate ?? 16000
  const vadSilenceMs = params.vadSilenceMs ?? 800
  const config: SherpaOnlineRecognizerConfig = {
    featConfig: { sampleRate, featureDim: 80 },
    modelConfig: {
      paraformer: { encoder: descriptor.encoder, decoder: descriptor.decoder },
      tokens: descriptor.tokens,
      // 2 线程解码降低积压，partial 吐字更快；单线程在连续语音下容易滞后于实时。
      numThreads: 2,
      debug: false,
      provider: 'cpu',
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: params.enableVad ?? true,
    // rule1: 说话中的句尾静音；rule2: 一直没说话的静音。单位秒。
    // 800ms：0.6s 会把正常换气停顿切段，且切段后模型需要重新热身，段首字容易糊。
    rule1MinTrailingSilence: vadSilenceMs / 1000,
    rule2MinTrailingSilence: (vadSilenceMs / 1000) * 2,
    rule3MinUtteranceLength: 20,
  }
  const key = `${descriptor.version}|${sampleRate}|${vadSilenceMs}|${params.enableVad ?? true}`
  return { config, key }
}

function getOrCreateRecognizer(
  mod: SherpaModule,
  params: VoiceStartRequest,
): { recognizer: SherpaOnlineRecognizer; configKey: string } {
  const paths = resolveVoiceModelPaths()
  if (!paths) throw new Error('语音识别运行时未就绪')
  const descriptor = readModelDescriptor(paths.modelDir)
  const { config, key } = buildRecognizerConfig(params, descriptor)
  if (cachedRecognizer && cachedRecognizer.configKey === key) {
    return { recognizer: cachedRecognizer.recognizer, configKey: key }
  }
  const recognizer = new mod.OnlineRecognizer(config)
  cachedRecognizer = { recognizer, configKey: key }
  log.info(`Voice recognizer created (model ${descriptor.version}, key ${key})`)
  return { recognizer, configKey: key }
}

/**
 * 对话识别器预热（语音助手 standby 期调用）：按真实 start 参数提前构造
 * OnlineRecognizer 命中 cachedRecognizer 缓存，把「唤醒→聆听」切换窗口内的
 * WASM/模型加载阻塞（日志实锤 main-blocked #1，首次可达数秒）挪到用户还没
 * 开口的空闲期。参数必须与后续 startVoiceSession 逐字段一致（缓存键含
 * sampleRate/vadSilenceMs/enableVad），否则预热无效只是多一次构造。
 * 尽力而为：模型未安装/运行时缺失时静默返回 false，绝不抛错——预热失败
 * 只退化为原有行为（start 时同步构造），不是故障。
 */
export function warmupVoiceRecognizer(params: VoiceStartRequest): boolean {
  try {
    const mod = loadSherpaModule()
    getOrCreateRecognizer(mod, params)
    return true
  } catch (err) {
    log.debug(
      `Voice recognizer warmup skipped: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

/** Int16 PCM (little-endian) -> Float32 [-1, 1] */
function int16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = (samples[i] ?? 0) / 32768
  }
  return out
}

// ─── 离线精修（方案A：流式预览 + 停止后整段重识别替换）─────────────────────────
//
// 录音期间 feedVoiceAudio 同步缓存 PCM；停止后若已安装 SenseVoice 离线精修模型，
// 对整段音频用 OfflineRecognizer 重新解码并以 refined 事件推送整段文本。
// 精修是可选增强：模型缺失、加载失败或音频异常时静默回退流式结果。

/** 短于该时长（约 5 帧）没有精修价值，直接保留流式结果 */
const MIN_REFINE_AUDIO_SECONDS = 0.3
/** 超长音频不做精修：避免离线解码长时间占用主进程与过大内存 */
const MAX_REFINE_AUDIO_SECONDS = 600
/** 分段解码粒度：段间让出事件循环，避免长音频一次 decode 阻塞主进程数秒。
 * 30s 粒度下单段 decode 仍会同步阻塞主进程数秒（日志实锤 main-blocked #2），
 * 调小到 5s：单段阻塞压到亚秒级，段间 setImmediate 让出间隙足以消化积压的
 * IPC 消息（采集 chunk/打断指令），段数增多带来的总耗时差异远小于阻塞感收益。 */
const REFINE_SEGMENT_SECONDS = 5

function senseVoiceLanguage(language: VoiceLanguage): string {
  return language === 'auto' ? '' : language
}

function getOrCreateRefineRecognizer(
  mod: SherpaModule,
  language: VoiceLanguage,
): SherpaOfflineRecognizer | null {
  if (typeof mod.OfflineRecognizer !== 'function') return null
  const paths = resolveVoiceRefinePaths()
  if (!paths) return null
  const lang = senseVoiceLanguage(language)
  const key = `${paths.version}|${lang}`
  if (cachedRefineRecognizer && cachedRefineRecognizer.configKey === key) {
    return cachedRefineRecognizer.recognizer
  }
  const recognizer = new mod.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: paths.modelPath,
        language: lang,
        useInverseTextNormalization: 1,
      },
      tokens: paths.tokensPath,
      numThreads: 2,
      debug: false,
      provider: 'cpu',
    },
    decodingMethod: 'greedy_search',
  })
  cachedRefineRecognizer = { recognizer, configKey: key }
  log.info(`Voice refine recognizer created (model ${paths.version}, language '${lang}')`)
  return recognizer
}

/** ASCII 词字符之间拼接时补空格，保持英文可读；中文直接连接。 */
function needsJoinSpace(left: string, right: string): boolean {
  const tail = left[left.length - 1] ?? ''
  const head = right[0] ?? ''
  return /[A-Za-z0-9]/.test(tail) && /[A-Za-z0-9]/.test(head)
}

function smartJoinSegments(segments: string[]): string {
  let out = ''
  for (const segment of segments) {
    if (!segment) continue
    out = out ? out + (needsJoinSpace(out, segment) ? ' ' : '') + segment : segment
  }
  return out
}

/**
 * 整段离线识别：按 REFINE_SEGMENT_SECONDS 分段 decode，段间让出事件循环。
 * 返回 null 表示精修不可用（native 包过旧 / 模型未安装），调用方回退流式结果。
 */
async function refineTranscript(
  samples: Int16Array,
  sampleRate: number,
  language: VoiceLanguage,
): Promise<string | null> {
  const mod = loadSherpaModule()
  const recognizer = getOrCreateRefineRecognizer(mod, language)
  if (!recognizer) return null
  const float32 = int16ToFloat32(samples)
  const segmentSamples = Math.max(1, Math.floor(sampleRate * REFINE_SEGMENT_SECONDS))
  const segments: string[] = []
  for (let offset = 0; offset < float32.length; offset += segmentSamples) {
    const slice = float32.subarray(offset, Math.min(offset + segmentSamples, float32.length))
    if (slice.length === 0) break
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate, samples: slice })
    recognizer.decode(stream)
    const text = (recognizer.getResult(stream).text ?? '').trim()
    if (text) segments.push(text)
    await new Promise<void>((resolveSegment) => setImmediate(resolveSegment))
  }
  return smartJoinSegments(segments)
}

/**
 * endpoint 触发时补一段静音并再解码一轮，把在线模型滞留的尾部 token 逼出来。
 * 必须在 reset 之前调用，否则句尾字丢失。
 */
function flushTailTokens(session: VoiceSession): string {
  try {
    const silence = new Float32Array(
      Math.floor(session.sampleRate * ENDPOINT_FLUSH_SILENCE_SECONDS),
    )
    session.stream.acceptWaveform({ samples: silence, sampleRate: session.sampleRate })
    while (session.recognizer.isReady(session.stream)) {
      session.recognizer.decode(session.stream)
    }
    return (session.recognizer.getResult(session.stream).text ?? '').trim()
  } catch {
    // flush 失败时退回最后已知 partial，不能因 flush 阻断 final
    return session.lastPartial
  }
}

export interface VoiceSessionHandle {
  success: boolean
  sessionId: string | null
  error: string | null
}

export function startVoiceSession(params: VoiceStartRequest, ownerId: number): VoiceSessionHandle {
  for (const [id, session] of sessions) {
    if (session.ownerId === ownerId) stopVoiceSession(id, ownerId)
  }
  const sessionId = `voice-${process.pid}-${++sessionCounter}`
  try {
    const mod = loadSherpaModule()
    const { recognizer } = getOrCreateRecognizer(mod, params)
    const stream = recognizer.createStream()
    // 人声聚焦门控：会话启动时创建并复位（silero 单例跨会话复用，reset 隔离状态）
    let noiseGate: VoiceNoiseGate | null = null
    let transientGuard: VoiceTransientGuard | null = null
    if (params.noiseGate === 'standard' || params.noiseGate === 'strict') {
      noiseGate = new VoiceNoiseGate({
        mode: params.noiseGate,
        onSpeechActivity: (active) => {
          emitPending({ type: 'speech-activity', sessionId, speechActive: active }, ownerId)
        },
      })
      noiseGate.reset()
    } else {
      // noiseGate off/缺省（语音输入与默认语音助手会话）：confirm-only 实例——
      // 音频流零改动（v1 能量置零伤识别率的教训），仅旁路产出 silero 人声
      // 时间轴供 final 级瞬态过滤；silero 模型缺失时由 VoiceTransientGuard 兜底
      noiseGate = new VoiceNoiseGate({ mode: 'standard', confirmOnly: true })
      noiseGate.reset()
      transientGuard = new VoiceTransientGuard({ sampleRate: params.sampleRate ?? 16000 })
      transientGuard.reset()
    }
    const session: VoiceSession = {
      sessionId,
      ownerId,
      recognizer,
      stream,
      sampleRate: params.sampleRate ?? 16000,
      lastPartial: '',
      language: params.language ?? 'auto',
      finals: [],
      pcmChunks: [],
      droppedSamples: 0,
      totalSamples: 0,
      noiseGate,
      transientGuard,
      lastFinalEndSample: 0,
      droppedTransientFinals: 0,
    }
    sessions.set(sessionId, session)
    emitPending({ type: 'session-started', sessionId, text: '' }, ownerId)
    log.info(
      `Voice session started: ${sessionId}${transientGuard ? ' (confirm-only transient guard)' : params.noiseGate ? ` (noise-gate ${params.noiseGate})` : ''}`,
    )
    return { success: true, sessionId, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Failed to start voice session: ${message}`)
    emitPending({ type: 'error', sessionId, message }, ownerId)
    return { success: false, sessionId: null, error: message }
  }
}

export function feedVoiceAudio(sessionId: string, samples: Int16Array, ownerId: number): void {
  const session = sessions.get(sessionId)
  if (!session || session.ownerId !== ownerId) return
  // 逐 chunk 同步 acceptWaveform+decode 的取舍：Paraformer 流式对 ~100ms chunk 的
  // 特征提取+解码远小于 chunk 间隔（不积压），而合帧（累计 ≥200ms 再喂）会直接
  // 抬高 partial 吐字延迟且无阻塞收益——日志里的 decode 阻塞来自离线精修的长段
  // decode（已按 5s 分段修复），流式路径维持逐 chunk 喂入不引入识别延迟劣化。
  // 瞬态守卫旁路只读分析（喂原始音频，绝不修改/丢样）：guard 的 fedSamples 与
  // session.totalSamples 在 confirm-only 会话（音频原样直通）逐 chunk 同步推进，
  // 绝对偏移区间查询跨轮 trim 不回退，与精修切片坐标系一致
  session.transientGuard?.process(samples)
  // 门控先于一切：低能量/非人声 chunk 置零（长度不变，时间推进保留），噪音内容不进识别与精修
  const gated = session.noiseGate?.process(samples) ?? samples
  // PCM 缓存优先于流式解码：即使解码抛错也保留整段音频供停止后精修
  session.pcmChunks.push(gated)
  session.totalSamples += gated.length
  try {
    const float32 = int16ToFloat32(gated)
    session.stream.acceptWaveform({ samples: float32, sampleRate: session.sampleRate })
    while (session.recognizer.isReady(session.stream)) {
      session.recognizer.decode(session.stream)
    }
    const result = session.recognizer.getResult(session.stream)
    const text = (result.text ?? '').trim()
    // partial: 文本变化时推送（UI 整体替换当前句）
    if (text && text !== session.lastPartial) {
      session.lastPartial = text
      emitPending({ type: 'partial', sessionId, text }, session.ownerId)
    }
    // 句尾：endpoint 触发，先补静音解码逼出滞留的尾部 token，再锁定 final 并 reset stream
    if (session.recognizer.isEndpoint(session.stream)) {
      const finalText = flushTailTokens(session)
      if (finalText && acceptFinalByVotes(session, session.totalSamples)) {
        session.finals.push(finalText)
        emitPending({ type: 'final', sessionId, text: finalText }, session.ownerId)
      }
      session.recognizer.reset(session.stream)
      session.lastPartial = ''
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Voice feed error (${sessionId}): ${message}`)
    emitPending({ type: 'error', sessionId, message }, session.ownerId)
  }
}

/**
 * final 接受判定（三票决策，confirm-only 会话；完整门控会话保持覆盖率语义）：
 * 1) silero 可用 → 区间 silero 人声绝对时长 ≥120ms 才接受（点击瞬态即便
 *    骗过 silero 也远短于该时长；正常中文单字 150-300ms）；
 * 2) silero 不可用（模型缺失/加载失败）→ VoiceTransientGuard 人声段时间轴
 *    兜底（纯 TS DSP 永在，不依赖 native）；
 * 3) guard 区间不可知（fedSamples 未覆盖查询终点/历史已超窗裁剪）→ 放行
 *    （数据缺失不误杀——宁可放行模糊 final，不可误杀真人声）。
 * 完整门控（standard/strict）会话走 shouldAcceptFinal 的 silero 覆盖率档位
 * 语义。区间起点 = 上一个已接受 final 的结束偏移（totalSamples 绝对游标，
 * 跨轮 trim 不回退，与 guard.fedSamples 同坐标系）。拒绝时丢弃 final 不 emit。
 */
function acceptFinalByVotes(session: VoiceSession, endSample: number): boolean {
  const gate = session.noiseGate
  if (gate == null) return true
  const from = session.lastFinalEndSample
  if (session.transientGuard == null) {
    const accepted = gate.shouldAcceptFinal(from, endSample)
    if (accepted) {
      session.lastFinalEndSample = endSample
    }
    return accepted
  }
  const voicedMs = gate.voicedMsSince(from, endSample)
  if (voicedMs != null) {
    if (voicedMs >= MIN_VOICED_MS_FOR_FINAL) {
      session.lastFinalEndSample = endSample
      return true
    }
    session.droppedTransientFinals += 1
    log.info(
      `[voice-recognition] final dropped #${session.droppedTransientFinals}: silero voiced ${voicedMs.toFixed(0)}ms below ${MIN_VOICED_MS_FOR_FINAL}ms in [${from}, ${endSample}) (confirm-only, ${session.sessionId})`,
    )
    return false
  }
  const guard = session.transientGuard
  if (!guard.isRangeKnown(from, endSample)) {
    session.lastFinalEndSample = endSample
    return true
  }
  if (guard.hasVoicedSpanSince(from, endSample)) {
    session.lastFinalEndSample = endSample
    return true
  }
  session.droppedTransientFinals += 1
  log.info(
    `[voice-recognition] final dropped #${session.droppedTransientFinals}: no voiced span in [${from}, ${endSample}) (transient guard fallback, ${session.sessionId})`,
  )
  return false
}

// feedVoiceAudio 是同步高频调用，emit 通过外部注入避免循环依赖
let activeEmitter: VoiceEventEmitter | null = null

export function setVoiceEventEmitter(emit: VoiceEventEmitter | null): void {
  activeEmitter = emit
}

function emitPending(event: VoiceRecognitionEvent, ownerId: number): void {
  try {
    activeEmitter?.(event, ownerId)
  } catch {
    // 事件推送失败不得影响识别主流程
  }
}

/**
 * 停止识别会话。
 *
 * mode='flush'（默认）：仅流式收尾（补尾部静音锁定最后一句 final）后立即结束。
 * mode='refine'：流式收尾后，若精修条件满足（模型已安装、音频时长合理），
 *   保留音频数据异步离线重识别，事件顺序为 final -> refined -> session-stopped；
 *   精修不可用或失败时退化为 flush 行为（final -> session-stopped）。
 *
 * 返回是否进入离线精修（供 IPC 响应告知渲染端进入"优化中"状态）。
 */
export function stopVoiceSession(
  sessionId?: string,
  ownerId?: number,
  mode: 'flush' | 'refine' = 'flush',
): boolean {
  if (!sessionId) {
    // ownerId 存在时只停止该 renderer 的会话；内部维护调用可省略 ownerId 停止全部。
    for (const [id, session] of sessions) {
      if (ownerId == null || session.ownerId === ownerId) stopVoiceSession(id, ownerId)
    }
    return false
  }
  const session = sessions.get(sessionId)
  if (!session) return false
  if (ownerId != null && session.ownerId !== ownerId) return false
  try {
    // 尾部 padding + 最终解码，争取最后一段 partial 落地为 final。
    // 覆盖率校验区间只算真实音频（padding 是合成静音，先快照真实结束偏移）
    const realEndSample = session.totalSamples
    session.noiseGate?.flushSilero()
    const tail = new Float32Array(Math.floor(session.sampleRate * STOP_TAIL_PADDING_SECONDS))
    session.stream.acceptWaveform({ samples: tail, sampleRate: session.sampleRate })
    while (session.recognizer.isReady(session.stream)) {
      session.recognizer.decode(session.stream)
    }
    session.stream.inputFinished()
    while (session.recognizer.isReady(session.stream)) {
      session.recognizer.decode(session.stream)
    }
    const result = session.recognizer.getResult(session.stream)
    const tailText = (result.text ?? '').trim()
    if (tailText) {
      // 三票决策（区间只算真实音频：realEndSample 在合成尾静音前快照）
      const accepted = acceptFinalByVotes(session, realEndSample)
      if (accepted) {
        session.finals.push(tailText)
        emitPending({ type: 'final', sessionId, text: tailText }, session.ownerId)
      }
    }
  } catch (err) {
    log.warn(
      `Voice stop cleanup error (${sessionId}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  // 会话先出表：精修期间允许开启新会话，互不影响（精修数据由下方闭包持有）
  sessions.delete(sessionId)

  const durationSeconds = session.totalSamples / session.sampleRate
  const shouldRefine =
    mode === 'refine' &&
    session.finals.length > 0 &&
    durationSeconds >= MIN_REFINE_AUDIO_SECONDS &&
    durationSeconds <= MAX_REFINE_AUDIO_SECONDS &&
    // 同步确认精修模型可用，保证返回值与实际行为一致（渲染端据此决定是否等待 refined）
    resolveVoiceRefinePaths() != null
  if (!shouldRefine) {
    emitPending({ type: 'session-stopped', sessionId, text: '' }, session.ownerId)
    log.info(`Voice session stopped: ${sessionId}`)
    return false
  }

  // 从缓存剩余部分起切片（droppedSamples=0 时等价于原全量 merge；全双工窗口
  // 会话被按轮 trim 过时，这里只拿剩余部分，避免尾部数据错位填入数组开头）
  const pcm = slicePcmInterval(session, session.droppedSamples, session.totalSamples)
  const { language, ownerId: sessionOwner, sampleRate } = session
  // 精修结束后才推送 session-stopped，渲染端据此保持"优化中"状态
  void refineTranscript(pcm, sampleRate, language)
    .then((refinedText) => {
      // 精修结果必须优于流式拼接才有替换意义：空结果直接保留流式文本
      if (refinedText) {
        emitPending({ type: 'refined', sessionId, text: refinedText }, sessionOwner)
      } else {
        log.info(`Voice refine returned empty text, keeping streaming result (${sessionId})`)
      }
    })
    .catch((err) => {
      // 精修失败静默回退流式结果，不打扰用户
      log.warn(
        `Voice refine failed (${sessionId}): ${err instanceof Error ? err.message : String(err)}`,
      )
    })
    .finally(() => {
      emitPending({ type: 'session-stopped', sessionId, text: '' }, sessionOwner)
      log.info(`Voice session stopped (refined): ${sessionId}`)
    })
  return true
}

/** 会话当前音频游标（已喂入总采样数；会话不存在返回 null）——全双工按轮切区间精修的边界源 */
export function getVoiceSessionSampleCursor(sessionId: string): number | null {
  return sessions.get(sessionId)?.totalSamples ?? null
}

/**
 * 按区间离线精修（全双工窗口专用）：对会话缓存 PCM 的 [fromSample, 当前游标)
 * 切片做 SenseVoice 重识别，不动会话本身（流式解码照常进行，跨轮复用的窗口
 * 会话因此无需停止）。切片增量收集（只拷贝区间涉及的 chunk，不 merge 全量——
 * 窗口会话跨轮存活，全量拷贝是 O(总时长)，长对话下每轮精修都翻倍变慢），
 * 先裁剪前后静音（门控置零段无转写价值，徒增解码时长）再送离线解码。
 * 返回 null = 精修不可用/区间无效/纯静音，调用方回退流式结果。
 */
export async function refineVoiceSessionInterval(
  sessionId: string,
  ownerId: number,
  fromSample: number,
): Promise<string | null> {
  const session = sessions.get(sessionId)
  if (!session || session.ownerId !== ownerId) return null
  const endSample = session.totalSamples
  const start = Math.max(0, Math.floor(fromSample))
  const minSamples = Math.floor(session.sampleRate * MIN_REFINE_AUDIO_SECONDS)
  if (endSample - start < minSamples) return null
  const pcm = slicePcmInterval(session, start, endSample)
  if (pcm.length < minSamples) return null
  // 裁剪前后静音：全双工窗口内门控置零段（TTS 回声压制/轮间停顿）占大头，
  // 原样送解码会把数倍时长的静音卷进离线推理，拖慢按轮精修
  let first = -1
  let last = -1
  for (let i = 0; i < pcm.length; i += 1) {
    if (pcm[i] !== 0) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) return null
  const pad = Math.floor(session.sampleRate * 0.1)
  const voiced = pcm.subarray(Math.max(0, first - pad), Math.min(pcm.length, last + 1 + pad))
  if (voiced.length < minSamples) return null
  try {
    const text = await refineTranscript(voiced, session.sampleRate, session.language)
    return text != null && text.trim().length > 0 ? text.trim() : null
  } catch (err) {
    log.warn(
      `Voice interval refine failed (${sessionId}): ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

/**
 * 裁剪会话 PCM 缓存中 keepFromSample 之前的部分（全双工窗口会话按轮消费后的
 * 内存回收）：完全在界前的整 chunk 直接丢弃，跨界 chunk 修剪头段保留尾部。
 * 流式解码不受影响（pcmChunks 是精修旁路缓存）；totalSamples 是累计游标
 * 不回退，droppedSamples 累计已裁剪量供后续按绝对偏移切片换算。调用方须
 * 保证无在途 refineVoiceSessionInterval（其区间可能覆盖被裁部分）——安全点
 * 是轮次收口后的下一轮开始前。
 */
export function trimVoiceSessionPcmCache(
  sessionId: string,
  ownerId: number,
  keepFromSample: number,
): boolean {
  const session = sessions.get(sessionId)
  if (!session || session.ownerId !== ownerId) return false
  const keep = Math.max(session.droppedSamples, Math.floor(keepFromSample))
  if (keep <= session.droppedSamples) return false
  let dropped = session.droppedSamples
  while (session.pcmChunks.length > 0) {
    const head = session.pcmChunks[0]
    if (head == null) break
    const headEnd = dropped + head.length
    if (headEnd <= keep) {
      session.pcmChunks.shift()
      dropped = headEnd
    } else if (dropped < keep) {
      // 跨界 chunk：丢弃头段，保留 [keep, headEnd) 尾部
      session.pcmChunks[0] = head.subarray(keep - dropped)
      dropped = keep
      break
    } else {
      break
    }
  }
  if (dropped === session.droppedSamples) return false
  session.droppedSamples = dropped
  return true
}

/** 增量收集 [fromSample, endSample) 的 PCM（绝对采样偏移 → chunks 相对位置） */
function slicePcmInterval(
  session: VoiceSession,
  fromSample: number,
  endSample: number,
): Int16Array {
  const from = Math.max(fromSample, session.droppedSamples)
  if (endSample <= from) return new Int16Array(0)
  const out = new Int16Array(endSample - from)
  let offset = session.droppedSamples
  let written = 0
  for (const chunk of session.pcmChunks) {
    const chunkStart = offset
    const chunkEnd = offset + chunk.length
    offset = chunkEnd
    if (chunkEnd <= from) continue
    if (chunkStart >= endSample) break
    const copyFrom = Math.max(0, from - chunkStart)
    const copyTo = Math.min(chunk.length, endSample - chunkStart)
    if (copyTo <= copyFrom) continue
    out.set(chunk.subarray(copyFrom, copyTo), written)
    written += copyTo - copyFrom
  }
  return written === out.length ? out : out.subarray(0, written)
}

/** 供测试与诊断使用 */
export function getActiveVoiceSessionCount(): number {
  return sessions.size
}

/** 卸载 native 模块缓存（设置变更/卸载语音包后调用） */
export function resetVoiceEngineCache(): void {
  stopVoiceSession()
  cachedRecognizer = null
  cachedRefineRecognizer = null
  cachedModule = null
  resetVoiceNoiseGateVad()
}
