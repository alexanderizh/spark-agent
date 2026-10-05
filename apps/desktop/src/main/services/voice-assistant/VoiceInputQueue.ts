/**
 * VoiceInputQueue — thinking/speaking 期插话输入队列（主进程）
 *
 * 职责（全双工三分路径的「排队」侧）：
 * - 确认窗口（draft）：播报/思考期 ASR final（已过 EchoGuard）先进草稿，
 *   静默 utteranceConfirmMs 后作为一条输入正式入队；窗口内继续说话
 *   （新 final/partial）撤销计时继续拼接——与 listening 态 handoff 确认
 *   窗口同构，给用户完整的说话空间；
 * - FIFO 容量 3：语音插话是短时行为，超限挤掉最旧并回调告知（HUD 闪烁 + cue）；
 * - 派发时效（TTL）：条目跨打断保留（E9），但日志实锤存在跨打断残留最长
 *   17.7 小时后仍被派发提交的僵尸输入——派发出队时超过 TTL 的条目直接丢弃；
 * - 生命周期事件回调（入队/挤出/派发/丢弃/清空），状态广播由 service 侧消费。
 *
 * 命令与挂起选择态不进本模块（service 侧旁路，R3：控制面不走数据面）。
 */
import { createLogger } from '@spark/shared'

const log = createLogger('voice-assistant')

/** 队列条目派发时效：超过该年龄的条目在出队时直接丢弃不派发（E9 打断后立即
 * 续听补发是秒级恢复，远小于该阈值，不受影响；阈值可按真机日志回归调整） */
export const VOICE_QUEUE_ENTRY_TTL_MS = 5 * 60 * 1000

/** 丢弃日志的内容摘要上限（只用于日志定位，不截断条目本体） */
const EXPIRED_LOG_TEXT_MAX_CHARS = 30

function summarizeEntryText(text: string): string {
  return text.length > EXPIRED_LOG_TEXT_MAX_CHARS
    ? `${text.slice(0, EXPIRED_LOG_TEXT_MAX_CHARS)}…`
    : text
}

/** 入队条目（status 广播与立即发送按钮的数据源） */
export interface QueuedVoiceInput {
  id: string
  text: string
  /** 捕获时的状态（日志/展示用） */
  capturedState: 'thinking' | 'speaking'
  createdAt: number
}

export interface VoiceInputQueueEvents {
  /** 正式入队（evicted 非空 = 容量满挤掉了最旧一条） */
  onEnqueued(entry: QueuedVoiceInput, evicted: QueuedVoiceInput | null): void
  /** 确认窗口状态变化（draft 开启/拼接/收口/撤销；status 广播依据） */
  onDraftChanged(draft: { text: string } | null): void
  /** 确认窗口静默到期，一条输入就绪（三分路径判定的入口） */
  onDraftConfirmed(text: string): void
  /** 条目被移除（放弃按钮 / 派发完成 / 清空逐条） */
  onRemoved(entry: QueuedVoiceInput, cause: 'discarded' | 'dispatched' | 'cleared'): void
  /** 聚合追加：忙碌期新输入并入队尾已有条目（agent 输出期间多段输入不拆轮次） */
  onAppended?(entry: QueuedVoiceInput): void
}

let queueCounter = 0

export class VoiceInputQueue {
  private entries: QueuedVoiceInput[] = []
  private draftParts: string[] = []
  private draftTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly capacity: number,
    private readonly confirmMs: () => number,
    private readonly events: VoiceInputQueueEvents,
  ) {}

  // ─── 确认窗口（draft） ─────────────────────────────────────────────────────

  /** 播报/思考期捕获一句 final（已过 EchoGuard）：开启/延续确认窗口 */
  feedDraftFinal(text: string, capturedState: 'thinking' | 'speaking'): void {
    if (this.disposed || text.trim().length === 0) return
    this.draftParts.push(text.trim())
    this.armDraftTimer(capturedState)
    this.events.onDraftChanged({ text: this.draftText() })
  }

  /** 窗口内继续说话（partial 活动信号）：撤销计时继续等（拼接语义由 final 驱动） */
  extendDraft(capturedState: 'thinking' | 'speaking'): void {
    if (this.disposed || this.draftParts.length === 0) return
    this.armDraftTimer(capturedState)
  }

  get draft(): { text: string } | null {
    return this.draftParts.length > 0 ? { text: this.draftText() } : null
  }

  private draftText(): string {
    return this.draftParts.join(' ')
  }

  private armDraftTimer(capturedState: 'thinking' | 'speaking'): void {
    if (this.draftTimer != null) clearTimeout(this.draftTimer)
    this.draftTimer = setTimeout(
      () => {
        this.draftTimer = null
        const text = this.draftText()
        this.draftParts = []
        this.events.onDraftChanged(null)
        if (text.trim().length > 0) this.events.onDraftConfirmed(text)
        void capturedState // 仅日志语义，确认回调由 service 判定当前态
      },
      Math.max(150, this.confirmMs()),
    )
  }

  /** 主动放弃当前草稿（打断/窗口收口/审批接管时） */
  cancelDraft(): void {
    if (this.draftTimer != null) {
      clearTimeout(this.draftTimer)
      this.draftTimer = null
    }
    if (this.draftParts.length > 0) {
      this.draftParts = []
      this.events.onDraftChanged(null)
    }
  }

  // ─── 队列本体 ──────────────────────────────────────────────────────────────

  /** 入队（容量满挤最旧）；已 dispose 返回 null（不再接受输入） */
  enqueue(text: string, capturedState: 'thinking' | 'speaking'): QueuedVoiceInput | null {
    if (this.disposed) return null
    const entry: QueuedVoiceInput = {
      id: `viq-${Date.now()}-${++queueCounter}`,
      text: text.trim(),
      capturedState,
      createdAt: Date.now(),
    }
    let evicted: QueuedVoiceInput | null = null
    while (this.entries.length >= this.capacity) {
      const oldest = this.entries.shift()
      if (oldest != null) {
        evicted = oldest
        this.events.onRemoved(oldest, 'cleared')
      }
    }
    this.entries.push(entry)
    this.events.onEnqueued(entry, evicted)
    return entry
  }

  /**
   * 聚合追加（agent 忙碌期语义）：队列非空时把后续输入并入队尾同一条（一句话
   * 被停顿拆成的多段不再各开一条、派发成 N 个独立轮次）；队列空时等同 enqueue
   * 新开一条。容量语义不变（聚合只减条数，不会触发挤出）。聚合追加视为条目
   * 仍活跃：createdAt 刷新到最后一段，TTL 从最后一段起算（用户还在补充说明
   * 的活跃条目不因首段年龄被误杀）。
   */
  appendToTail(text: string, capturedState: 'thinking' | 'speaking'): QueuedVoiceInput | null {
    if (this.disposed) return null
    const trimmed = text.trim()
    if (trimmed.length === 0) return null
    const last = this.entries[this.entries.length - 1]
    if (last == null) return this.enqueue(trimmed, capturedState)
    last.text = last.text.length > 0 ? `${last.text} ${trimmed}` : trimmed
    last.capturedState = capturedState
    last.createdAt = Date.now()
    this.events.onAppended?.(last)
    return last
  }

  /** 队首弹出（派发）：过期条目（超 VOICE_QUEUE_ENTRY_TTL_MS，跨打断残留的
   * 僵尸输入）逐条丢弃不派发并触发 onRemoved(discarded)——手动「立即发送」
   * 走 removeById 不受 TTL 约束；存活条目触发 onRemoved(dispatched)——status
   * 广播随派发即时刷新，否则 graceful 派发后无状态迁移，渲染端 queuedInputs
   * 挂着已派发条目到收尾 */
  dequeueHead(): QueuedVoiceInput | null {
    let entry = this.entries.shift() ?? null
    while (entry != null && Date.now() - entry.createdAt > VOICE_QUEUE_ENTRY_TTL_MS) {
      log.info(
        `[voice-assistant] queued input expired (id=${entry.id}, ageMs=${Date.now() - entry.createdAt}, text=${summarizeEntryText(entry.text)})`,
      )
      this.events.onRemoved(entry, 'discarded')
      entry = this.entries.shift() ?? null
    }
    if (entry != null) this.events.onRemoved(entry, 'dispatched')
    return entry
  }

  /** 按 id 移除（放弃按钮 / 立即发送抢占指定条；cause 区分日志语义） */
  removeById(id: string, cause: 'discarded' | 'dispatched' = 'discarded'): QueuedVoiceInput | null {
    const index = this.entries.findIndex((entry) => entry.id === id)
    if (index < 0) return null
    const [entry] = this.entries.splice(index, 1)
    if (entry != null) this.events.onRemoved(entry, cause)
    return entry ?? null
  }

  /** 最新条（HUD 展示「刚说的那句」；立即发送缺省指向它） */
  latest(): QueuedVoiceInput | null {
    return this.entries[this.entries.length - 1] ?? null
  }

  /** 按 id 查找（立即发送指定条） */
  findById(id: string): QueuedVoiceInput | null {
    return this.entries.find((entry) => entry.id === id) ?? null
  }

  /** 快照（status 广播用，只读） */
  snapshot(): QueuedVoiceInput[] {
    return [...this.entries]
  }

  get size(): number {
    return this.entries.length
  }

  /** 清空（停止聆听命令 / 全双工关闭：逐条记日志） */
  clear(cause: 'cleared' = 'cleared'): QueuedVoiceInput[] {
    const removed = this.entries
    this.entries = []
    this.cancelDraft()
    for (const entry of removed) this.events.onRemoved(entry, cause)
    return removed
  }

  dispose(): void {
    this.disposed = true
    if (this.draftTimer != null) {
      clearTimeout(this.draftTimer)
      this.draftTimer = null
    }
    this.draftParts = []
    this.entries = []
  }
}
