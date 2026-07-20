/**
 * VideoWorkbenchOutputPanel — 产物面板。
 *
 * 展示工作台产出的最近 20 条记录（裁剪 / 转码 / 分割 / 关键帧回填 / 后续 concat）。
 * 每条记录显示摘要 + 时间 + 打开/播放按钮。
 *
 * 抽离原因：原 Modal 1214 行过于臃肿，与 FramePanel/EditPanel/ResourcePanel 同层。
 */
import type { ReactElement } from 'react'
import { Icons } from '../../../Icons'
import type { WorkbenchOutput } from './videoWorkbench.types'

interface Props {
  outputs: WorkbenchOutput[]
}

export function VideoWorkbenchOutputPanel({ outputs }: Props): ReactElement {
  if (outputs.length === 0) {
    return (
      <div className="vwb-output-panel">
        <div className="vwb-placeholder">
          <Icons.Package size={28} />
          <span>暂无产物</span>
          <span className="muted">剪辑/转码/分割的产物会在这里展示</span>
        </div>
      </div>
    )
  }
  return (
    <div className="vwb-output-panel">
      <div className="vwb-output-list">
        {outputs.map((out) => (
          <div key={out.id} className="vwb-output-item">
            <div className="vwb-output-icon">
              <Icons.Video size={16} />
            </div>
            <div className="vwb-output-info">
              <div className="vwb-output-summary">{out.summary}</div>
              <div className="vwb-output-time">{new Date(out.createdAt).toLocaleTimeString()}</div>
            </div>
            {out.outputUrl && (
              <a className="vwb-output-play" href={out.outputUrl} target="_blank" rel="noreferrer">
                <Icons.Play size={14} />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
