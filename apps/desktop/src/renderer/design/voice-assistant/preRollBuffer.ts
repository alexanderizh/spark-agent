/**
 * pre-roll 环形音频缓冲（纯逻辑，无 DOM 依赖）。
 *
 * KWS 常驻采集期间在渲染端缓存最近约 2.5s 对话规格音频（16kHz/Int16），
 * 「唤醒→对话」切换时由采集控制器同步回放给主进程，补齐唤醒词命中判定
 * 延迟期间的正文字头（首句丢失修复）。缓冲只在内存滚动覆盖：不落盘、
 * 不上传，超过容量即丢弃最旧 chunk。
 */

/** 默认缓冲时长：覆盖唤醒词说完→ASR 接上的典型切换空窗（含 KWS 命中判定延迟） */
export const PRE_ROLL_SECONDS = 2.5
/** 对话喂流固定 16kHz 单声道 Int16 */
export const PRE_ROLL_SAMPLE_RATE = 16000

export class PreRollBuffer {
  private chunks: Int16Array[] = []
  private totalSamples = 0

  constructor(
    private readonly maxSamples: number = Math.floor(PRE_ROLL_SAMPLE_RATE * PRE_ROLL_SECONDS),
  ) {}

  /** 压入新 chunk 并按容量丢弃最旧内容（单 chunk 超容量时只保留其尾部） */
  push(samples: Int16Array): void {
    if (samples.length === 0 || this.maxSamples <= 0) return
    this.chunks.push(samples)
    this.totalSamples += samples.length
    while (this.totalSamples > this.maxSamples && this.chunks.length > 1) {
      const dropped = this.chunks.shift()
      this.totalSamples -= dropped?.length ?? 0
    }
    if (this.chunks.length === 1) {
      const head = this.chunks[0]
      if (head != null && head.length > this.maxSamples) {
        this.chunks[0] = head.subarray(head.length - this.maxSamples)
        this.totalSamples = this.maxSamples
      }
    }
  }

  /** 当前缓冲快照（按时间序；不消费缓冲，回放后继续滚动供下次唤醒使用） */
  snapshot(): Int16Array[] {
    return this.chunks.slice()
  }

  /** 已缓冲采样数 */
  get samples(): number {
    return this.totalSamples
  }

  clear(): void {
    this.chunks = []
    this.totalSamples = 0
  }
}
