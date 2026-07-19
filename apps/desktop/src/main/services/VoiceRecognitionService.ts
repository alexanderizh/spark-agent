import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createLogger } from '@spark/shared'
import type { VoiceRecognitionEvent, VoiceStartRequest } from '@spark/protocol'
import { resolveVoiceModelPaths } from './VoiceIntegrityService.js'

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

interface SherpaModule {
  OnlineRecognizer: new (config: SherpaOnlineRecognizerConfig) => SherpaOnlineRecognizer
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
}

type VoiceEventEmitter = (event: VoiceRecognitionEvent, ownerId: number) => void

let cachedModule: SherpaModule | null = null
let cachedRecognizer: { recognizer: SherpaOnlineRecognizer; configKey: string } | null = null
let sessionCounter = 0
const sessions = new Map<string, VoiceSession>()

function loadSherpaModule(): SherpaModule {
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

function buildRecognizerConfig(
  params: VoiceStartRequest,
  descriptor: VoiceModelDescriptor,
): { config: SherpaOnlineRecognizerConfig; key: string } {
  const sampleRate = params.sampleRate ?? 16000
  const vadSilenceMs = params.vadSilenceMs ?? 600
  const config: SherpaOnlineRecognizerConfig = {
    featConfig: { sampleRate, featureDim: 80 },
    modelConfig: {
      paraformer: { encoder: descriptor.encoder, decoder: descriptor.decoder },
      tokens: descriptor.tokens,
      numThreads: 1,
      debug: false,
      provider: 'cpu',
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: params.enableVad ?? true,
    // rule1: 说话中的句尾静音；rule2: 一直没说话的静音。单位秒。
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
    // 句尾：endpoint 触发，锁定 final 并 reset stream
    if (session.recognizer.isEndpoint(session.stream)) {
      if (text) {
        emitPending({ type: 'final', sessionId, text }, session.ownerId)
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

export function stopVoiceSession(sessionId?: string, ownerId?: number): void {
  if (!sessionId) {
    // ownerId 存在时只停止该 renderer 的会话；内部维护调用可省略 ownerId 停止全部。
    for (const [id, session] of sessions) {
      if (ownerId == null || session.ownerId === ownerId) stopVoiceSession(id, ownerId)
    }
    return
  }
  const session = sessions.get(sessionId)
  if (!session) return
  if (ownerId != null && session.ownerId !== ownerId) return
  try {
    // 尾部 padding + 最终解码，争取最后一段 partial 落地为 final
    const tail = new Float32Array(Math.floor(session.sampleRate * 0.4))
    session.stream.acceptWaveform({ samples: tail, sampleRate: session.sampleRate })
    while (session.recognizer.isReady(session.stream)) {
      session.recognizer.decode(session.stream)
    }
    session.stream.inputFinished()
    while (session.recognizer.isReady(session.stream)) {
      session.recognizer.decode(session.stream)
    }
    const result = session.recognizer.getResult(session.stream)
    const text = (result.text ?? '').trim()
    if (text) emitPending({ type: 'final', sessionId, text }, session.ownerId)
  } catch (err) {
    log.warn(`Voice stop cleanup error (${sessionId}): ${err instanceof Error ? err.message : String(err)}`)
  }
  sessions.delete(sessionId)
  emitPending({ type: 'session-stopped', sessionId, text: '' }, session.ownerId)
  log.info(`Voice session stopped: ${sessionId}`)
}

/** 供测试与诊断使用 */
export function getActiveVoiceSessionCount(): number {
  return sessions.size
}

/** 卸载 native 模块缓存（设置变更/卸载语音包后调用） */
export function resetVoiceEngineCache(): void {
  stopVoiceSession()
  cachedRecognizer = null
  cachedModule = null
}
