/**
 * VoiceHudQueueBox — HUD 插话队列框（全双工排队输入的展示与动作）
 *
 * 三时机（与 VoiceInputQueue 生命周期一一对应）：
 * - 弱态（draft）：确认窗口中——仅文本 +「停顿确认中…」，无按钮，整框 0.64 透明度
 * - 正态（queued）：已入队——「已听到 · ×N」+ 文本 + 立即发送（主色胶囊）/放弃（轻文字钮）
 * - 只读衔接（takeover）：graceful 边播边处理已启动——「本句播完后衔接新回答」，无按钮
 *
 * 展示最新条（显示最新、动作所指一致）：徽标 ×N 告知还有 N-1 条在排，FIFO 顺序不变。
 * 空队列（无 draft/queued/takeover）不渲染（不占位）。
 */

export interface VoiceHudQueuedInputView {
  id: string
  text: string
  capturedState: string
  createdAt: number
}

export interface VoiceHudQueueBoxProps {
  /** 确认窗口草稿（弱态） */
  draft: { text: string } | null
  /** 已入队条目（正态；展示最新条，徽标用总数） */
  entries: VoiceHudQueuedInputView[]
  /** graceful 衔接中（S8 只读） */
  takeoverPending: boolean
  /** 立即发送 in-flight（防重：双按钮禁用） */
  dispatchInFlight: boolean
  onDispatch: (id: string) => void
  onDiscard: (id: string) => void
}

export function VoiceHudQueueBox({
  draft,
  entries,
  takeoverPending,
  dispatchInFlight,
  onDispatch,
  onDiscard,
}: VoiceHudQueueBoxProps): React.ReactElement | null {
  const latest = entries[entries.length - 1] ?? null
  if (takeoverPending) {
    return (
      <div className="voice-hud-queue is-takeover" role="status">
        <span className="voice-hud-queue-prefix">衔接中</span>
        <p className="voice-hud-queue-text">本句播完后衔接新回答</p>
      </div>
    )
  }
  if (draft != null) {
    return (
      <div className="voice-hud-queue is-draft" role="status">
        <span className="voice-hud-queue-prefix">已听到</span>
        <p className="voice-hud-queue-text">{draft.text}</p>
        <span className="voice-hud-queue-hint">停顿确认中…</span>
      </div>
    )
  }
  if (latest == null) return null
  return (
    <div className="voice-hud-queue is-queued" role="status">
      <span className="voice-hud-queue-prefix">
        已听到
        {entries.length >= 2 ? (
          <i className="voice-hud-queue-badge" aria-hidden="true">
            ×{entries.length}
          </i>
        ) : null}
      </span>
      <p className="voice-hud-queue-text">{latest.text}</p>
      <span className="voice-hud-queue-actions">
        <button
          type="button"
          className="voice-hud-queue-dispatch"
          disabled={dispatchInFlight}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDispatch(latest.id)}
          title="立即处理这条（中止当前回答）"
        >
          <i aria-hidden="true" />
          <span>{dispatchInFlight ? '发送中…' : '立即发送'}</span>
        </button>
        <button
          type="button"
          className="voice-hud-queue-discard"
          disabled={dispatchInFlight}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDiscard(latest.id)}
          title="放弃这条（仅移出队列）"
        >
          放弃
        </button>
      </span>
    </div>
  )
}
