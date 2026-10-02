/**
 * WakeWordDetector — 唤醒词检测器（sherpa-onnx KeywordSpotter 封装）
 *
 * 常驻聆听的轻量本地推理：每 100ms 音频 chunk 约 2ms 解码（RTF≈0.02），
 * 直接主进程事件驱动执行（与 Paraformer 流式解码同架构，不引入 worker）。
 *
 * 唤醒词为 open-vocabulary（免重训）：按设置生成 runtime keywords 文件
 * （`token序列 :boost #threshold @回显`，声调必须正确——「星」是一声 īng）。
 * 所有 token 序列已对 zh-en-3M 模型 tokens.txt 实测验证（macOS TTS 全命中）。
 */

import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'
import type { VoiceAssistantWakeWord } from '@spark/protocol'
import { resolveVoiceKwsPaths, resolveVoiceModelPaths } from '../VoiceIntegrityService.js'

const log = createLogger('voice-kws')

// ─── sherpa-onnx KeywordSpotter 最小类型声明（动态 require） ─────────────────

interface SherpaKeywordStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
}

interface SherpaKeywordResult {
  start_time?: number
  keyword?: string
  tokens?: string[]
  timestamps?: number[]
}

interface SherpaKeywordSpotter {
  createStream(): SherpaKeywordStream
  isReady(stream: SherpaKeywordStream): boolean
  decode(stream: SherpaKeywordStream): void
  reset(stream: SherpaKeywordStream): void
  getResult(stream: SherpaKeywordStream): SherpaKeywordResult
  free?: () => void
}

interface SherpaKeywordSpotterModule {
  KeywordSpotter: new (config: SherpaKeywordSpotterConfig) => SherpaKeywordSpotter
}

interface SherpaKeywordSpotterConfig {
  featConfig?: { sampleRate: number; featureDim: number }
  modelConfig: {
    transducer: { encoder: string; decoder: string; joiner: string }
    tokens: string
    numThreads?: number
    debug?: boolean
    provider?: string
  }
  maxActivePaths?: number
  numTrailingBlanks?: number
  keywordsScore?: number
  keywordsThreshold?: number
  keywordsFile?: string
}

// ─── 唤醒词预设（token 序列与包内 keywords.txt 一致，声调已实测） ────────────

interface WakeWordPreset {
  label: string
  tokens: string
  /** 行内默认 boost（嘿SPARK 需要更高 boost 补偿双语混合） */
  defaultBoost: number
  defaultThreshold: number
}

const WAKE_WORD_PRESETS: Record<VoiceAssistantWakeWord, WakeWordPreset> = {
  'hey-spark': {
    label: '嘿SPARK',
    tokens: 'h ēi S P AA1 R K',
    defaultBoost: 3.0,
    defaultThreshold: 0.1,
  },
  'nihao-xinghuo': {
    label: '你好，星火',
    tokens: 'n ǐ h ǎo x īng h uǒ',
    defaultBoost: 1.5,
    defaultThreshold: 0.15,
  },
  'xinghuo-xinghuo': {
    label: '星火星火',
    tokens: 'x īng h uǒ x īng h uǒ',
    defaultBoost: 1.5,
    defaultThreshold: 0.15,
  },
  'xiaoxing-xiaoxing': {
    label: '小星小星',
    tokens: 'x iǎo x īng x iǎo x īng',
    defaultBoost: 1.5,
    defaultThreshold: 0.15,
  },
}

export interface WakeWordStartOptions {
  wakeWord: VoiceAssistantWakeWord
  /** 用户覆盖（缺省用预设实测值） */
  threshold?: number
  boost?: number
}

export interface WakeWordDetectorDeps {
  /** 命中回调（主线程同步调用，调用方负责状态机路由） */
  onHit: (keyword: string) => void
  /** 推理错误回调（加载失败/解码异常） */
  onError: (message: string) => void
  /** runtime keywords 文件目录（userData/voice-assistant） */
  runtimeDir: string
}

/** KWS 模型是否可用（native + kws 组件均已安装） */
export function isWakeWordModelAvailable(): boolean {
  return resolveVoiceModelPaths() != null && resolveVoiceKwsPaths() != null
}

let cachedModule: SherpaKeywordSpotterModule | null = null

function loadKwsModule(): SherpaKeywordSpotterModule {
  if (cachedModule) return cachedModule
  const paths = resolveVoiceModelPaths()
  if (!paths) throw new Error('语音 native 运行时未就绪，请先在设置中安装语音包')
  const req = createRequire(import.meta.url)
  const mod = req(paths.nativeMain) as SherpaKeywordSpotterModule
  if (typeof mod.KeywordSpotter !== 'function') {
    throw new Error('语音 native 模块缺少 KeywordSpotter 导出')
  }
  cachedModule = mod
  return mod
}

/** 供测试注入 mock native 模块 */
export function setKwsModuleForTests(mod: SherpaKeywordSpotterModule | null): void {
  cachedModule = mod
}

export class WakeWordDetector {
  private spotter: SherpaKeywordSpotter | null = null
  private stream: SherpaKeywordStream | null = null
  private active = false

  constructor(private readonly deps: WakeWordDetectorDeps) {}

  isActive(): boolean {
    return this.active
  }

  /** 启动检测：加载模型 + 生成 runtime keywords 文件 */
  async start(options: WakeWordStartOptions): Promise<void> {
    if (this.active) this.stop()
    const kwsPaths = resolveVoiceKwsPaths()
    if (!kwsPaths) {
      throw new Error('唤醒词模型未安装，请先在设置中安装语音包')
    }
    const preset = WAKE_WORD_PRESETS[options.wakeWord] ?? WAKE_WORD_PRESETS['hey-spark']
    const boost = options.boost ?? preset.defaultBoost
    const threshold = options.threshold ?? preset.defaultThreshold
    const keywordsFile = await this.writeRuntimeKeywords(
      `${preset.tokens} :${boost} #${threshold} @${preset.label}`,
    )
    const mod = loadKwsModule()
    this.spotter = new mod.KeywordSpotter({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: kwsPaths.encoderPath,
          decoder: kwsPaths.decoderPath,
          joiner: kwsPaths.joinerPath,
        },
        tokens: kwsPaths.tokensPath,
        numThreads: 1,
        provider: 'cpu',
        debug: false,
      },
      maxActivePaths: 4,
      // 尾部 blank 数 = 命中收口所需的连续尾静音帧数（10ms/帧）。sherpa 默认 1；
      // 此前取 8（80ms）导致唤醒词后无停顿直接连说指令时命中被延迟甚至吞掉
      // （漏唤醒主因之一）。2 保留叠词防抖（星火×2 token 重叠）同时压低收口门槛。
      numTrailingBlanks: 2,
      keywordsFile,
    })
    try {
      this.stream = this.spotter.createStream()
    } catch (error) {
      // createStream 失败：释放已构造的 native 对象再抛出，防泄漏
      try {
        this.spotter?.free?.()
      } catch {
        // 释放失败不掩盖原始错误
      }
      this.spotter = null
      throw error
    }
    this.active = true
    log.info(
      `[voice-assistant] wake word detector started (${preset.label}, boost=${boost}, threshold=${threshold})`,
    )
  }

  stop(): void {
    this.active = false
    this.stream = null
    try {
      this.spotter?.free?.()
    } catch {
      // 释放失败不阻断
    }
    this.spotter = null
  }

  /** 喂入 16k Int16 PCM chunk（与 ASR 同格式）；非活跃时静默丢弃 */
  feed(samples: Int16Array): void {
    if (!this.active || this.spotter == null || this.stream == null) return
    try {
      const float = new Float32Array(samples.length)
      for (let i = 0; i < samples.length; i += 1) {
        float[i] = (samples[i] ?? 0) / 32768
      }
      this.stream.acceptWaveform({ samples: float, sampleRate: 16000 })
      while (this.spotter.isReady(this.stream)) {
        this.spotter.decode(this.stream)
      }
      const result = this.spotter.getResult(this.stream)
      const keyword = result.keyword ?? ''
      if (keyword.length > 0) {
        log.info(`[voice-assistant] wake word hit: ${keyword}`)
        this.spotter.reset(this.stream)
        this.deps.onHit(keyword)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[voice-assistant] wake word decode error: ${message}`)
      this.deps.onError(message)
    }
  }

  private async writeRuntimeKeywords(line: string): Promise<string> {
    await mkdir(this.deps.runtimeDir, { recursive: true })
    const file = join(this.deps.runtimeDir, 'keywords-runtime.txt')
    // 唤醒词/阈值可能变化，每次 start 重写（百字节级文件，开销可忽略）
    await writeFile(file, `${line}\n`, 'utf8')
    return file
  }
}

export function getWakeWordPresetLabel(wakeWord: VoiceAssistantWakeWord): string {
  return (WAKE_WORD_PRESETS[wakeWord] ?? WAKE_WORD_PRESETS['hey-spark']).label
}
