import { Icons } from '../../Icons'

/**
 * 语音轮分割线：语音助手唤醒轮的 user 消息上方渲染「语音输入」，
 * 标识该轮来自快捷键唤醒的语音对话（转写文本 + TTS 播报）。
 * 样式复用 goal-iteration-divider 的中性态（styles/views.css），与定时任务唤醒分割线同构。
 */
export function VoiceTurnDivider() {
  return (
    <div className="goal-iteration-divider voice-turn-divider" role="separator" aria-label="语音输入">
      <div className="goal-iteration-divider-row">
        <span className="goal-iteration-divider-line" />
        <span className="goal-iteration-divider-label">
          <Icons.Mic size={12} className="voice-turn-divider-mic" />
          <span>语音输入</span>
        </span>
        <span className="goal-iteration-divider-line" />
      </div>
    </div>
  )
}
