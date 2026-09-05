import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createLogger } from '@spark/shared'
import type { VoiceLanguage, VoiceRecognitionEvent, VoiceStartRequest } from '@spark/protocol'
import { resolveVoiceModelPaths, resolveVoiceRefinePaths } from './VoiceIntegrityService.js'

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
  totalSamples: number
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
/** 分段解码粒度：段间让出事件循环，避免长音频一次 decode 阻塞主进程数秒 */
const REFINE_SEGMENT_SECONDS = 30

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

function mergePcmChunks(chunks: Int16Array[], totalSamples: number): Int16Array {
  const out = new Int16Array(totalSamples)
  let offset = 0
  for (const chunk of chunks) {
    if (offset + chunk.length > out.length) break
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * 整段离线识别：按 30s 分段 decode（SenseVoice 的原生窗口粒度），段间让出事件循环。
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
      totalSamples: 0,
    }
    sessions.set(sessionId, session)
    emitPending({ type: 'session-started', sessionId, text: '' }, ownerId)
    log.info(`Voice session started: ${sessionId}`)
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
  // PCM 缓存优先于流式解码：即使解码抛错也保留整段音频供停止后精修
  session.pcmChunks.push(samples)
  session.totalSamples += samples.length
  try {
    const float32 = int16ToFloat32(samples)
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
      if (finalText) {
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
  let tailText = ''
  try {
    // 尾部 padding + 最终解码，争取最后一段 partial 落地为 final
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
    tailText = (result.text ?? '').trim()
    if (tailText) {
      session.finals.push(tailText)
      emitPending({ type: 'final', sessionId, text: tailText }, session.ownerId)
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

  const pcm = mergePcmChunks(session.pcmChunks, session.totalSamples)
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
}
