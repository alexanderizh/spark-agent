import React from 'react'
import { RefreshCw } from 'lucide-react'
import type { UIBlock } from '../../services/event-mapper'
import './StreamReconnectNotice.less'

type StreamReconnectBlock = Extract<UIBlock, { kind: 'runtime_signal' }>

/**
 * 流式断线自动重连的轻量提示行：横线 + 居中文本，样式对齐模型切换提示。
 * 重连是 SDK 自恢复的过程信号，不按错误卡片展示；同一轮的多次尝试
 * 在 event-mapper 里原地合并，这里始终展示最新一次的重试进度。
 */
export function StreamReconnectNotice({ block }: { block: StreamReconnectBlock }) {
  const progress = block.details?.find((detail) => detail.label === '重试进度')?.value
  return (
    <div className="stream-reconnect-notice" role="status" title={block.message}>
      <span className="stream-reconnect-notice-line" />
      <span className="stream-reconnect-notice-content">
        <RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />
        <span>网络连接中断，正在自动重连{progress != null ? `（${progress}）` : ''}</span>
      </span>
      <span className="stream-reconnect-notice-line" />
    </div>
  )
}
