/**
 * VideoWorkbenchOutputPanel — 产物面板。
 *
 * 展示工作台产出的最近 20 条记录（裁剪 / 转码 / 分割 / 关键帧回填 / 后续 concat）。
 * 每条记录显示摘要 + 时间 + 打开/播放按钮。
 *
 * 抽离原因：原 Modal 1214 行过于臃肿，与 FramePanel/EditPanel/ResourcePanel 同层。
 */
import type { ReactElement } from 'react'
import { Button } from 'antd'
import { Icons } from '../../../Icons'
import type { WorkbenchOutput } from './videoWorkbench.types'

interface Props {
  outputs: WorkbenchOutput[]
  trackLength: number
  busy: boolean
  onExportTrack: () => void
  onAddToCanvas: (output: WorkbenchOutput) => void
  onReplaceCurrent: (output: WorkbenchOutput) => void
}

export function VideoWorkbenchOutputPanel({
  outputs,
  trackLength,
  busy,
  onExportTrack,
  onAddToCanvas,
  onReplaceCurrent,
}: Props): ReactElement {
  if (outputs.length === 0) {
    return (
      <div className="vwb-output-panel">
        <div className="vwb-output-toolbar">
          <span>编辑结果</span>
          <Button
            size="small"
            type="primary"
            icon={<Icons.Upload size={13} />}
            onClick={onExportTrack}
            disabled={busy || trackLength === 0}
          >
            导出当前轨道
          </Button>
        </div>
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
      <div className="vwb-output-toolbar">
        <span>编辑结果</span>
        <Button
          size="small"
          type="primary"
          icon={<Icons.Upload size={13} />}
          onClick={onExportTrack}
          disabled={busy || trackLength === 0}
        >
          导出当前轨道
        </Button>
      </div>
      <div className="vwb-output-list">
        {outputs.map((out) => (
          <div key={out.id} className="vwb-output-item">
            <div className="vwb-output-icon">
              <Icons.Video size={16} />
            </div>
            <div className="vwb-output-info">
              <div className="vwb-output-summary">{out.summary}</div>
              <div className="vwb-output-time">{new Date(out.createdAt).toLocaleTimeString()}</div>
              {out.canvasNodeId ? <div className="vwb-output-materialized">已入画布</div> : null}
            </div>
            {out.outputUrl && (
              <div className="vwb-output-actions">
                <a
                  className="vwb-output-play"
                  href={out.outputUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="预览产物"
                >
                  <Icons.Play size={14} />
                </a>
                <Button
                  size="small"
                  icon={<Icons.Plus size={12} />}
                  onClick={() => onAddToCanvas(out)}
                  disabled={busy}
                >
                  添加到画布
                </Button>
                <Button
                  size="small"
                  icon={<Icons.Refresh size={12} />}
                  onClick={() => onReplaceCurrent(out)}
                  disabled={busy}
                >
                  替换当前
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
