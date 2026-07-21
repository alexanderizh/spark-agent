/**
 * VideoWorkbenchFramePanel — 关键帧面板。
 *
 * 包含：
 *   - 提取策略选择（场景突变 / I帧 / 均匀采样）+ 参数调节
 *   - 「提取关键帧」按钮 + 进度条
 *   - 关键帧缩略图墙（时间戳 + 点击跳转 + 删除 + 批量导出画布）
 */
import type { ReactElement } from 'react'
import { Button, Segmented, Slider, Tooltip } from 'antd'
import { Icons } from '../../../Icons'
import {
  formatTimestamp,
  type KeyframeStrategy,
  type KeyframeExtractConfig,
  type VideoWorkbenchData,
} from './videoWorkbench.types'

interface Props {
  draft: VideoWorkbenchData
  busy: boolean
  progress: number | null
  progressStage: string
  ffmpegReady: boolean | null
  onExtract: (strategy: KeyframeStrategy) => void
  onConfigChange: (cfg: KeyframeExtractConfig) => void
  onSeek: (sec: number) => void
  onExport: () => void
  onRemoveKeyframe: (index: number) => void
}

const STRATEGY_DESCS: Record<KeyframeStrategy, string> = {
  scene: '检测画面变化大的瞬间，适合教程/演示类视频',
  iframe: '提取编码关键帧，速度最快但数量取决于编码',
  uniform: '固定时间间隔采样，数量可控',
}

export function VideoWorkbenchFramePanel({
  draft,
  busy,
  progress,
  progressStage,
  ffmpegReady,
  onExtract,
  onConfigChange,
  onSeek,
  onExport,
  onRemoveKeyframe,
}: Props): ReactElement {
  const cfg = draft.extractConfig
  const isScene = cfg.strategy === 'scene'
  const isUniform = cfg.strategy === 'uniform'

  return (
    <div className="vwb-frame-panel">
      {/* ── 提取配置 ── */}
      <div className="vwb-section">
        <div className="vwb-section-title">提取策略</div>
        <Segmented
          value={cfg.strategy}
          onChange={(v) => onConfigChange({ ...cfg, strategy: v as KeyframeStrategy })}
          options={[
            { label: '场景突变', value: 'scene' },
            { label: 'I 帧', value: 'iframe' },
            { label: '均匀采样', value: 'uniform' },
          ]}
          block
          size="small"
        />
        <div className="vwb-strategy-desc">{STRATEGY_DESCS[cfg.strategy]}</div>

        {isScene && (
          <div className="vwb-param">
            <label>灵敏度阈值</label>
            <Slider
              min={0.05}
              max={0.8}
              step={0.05}
              value={cfg.threshold}
              onChange={(v) => onConfigChange({ ...cfg, threshold: v })}
              tooltip={{ formatter: (v) => `${v}（越小越敏感）` }}
            />
          </div>
        )}
        {isUniform && (
          <div className="vwb-param">
            <label>采样间隔（秒）</label>
            <Slider
              min={0.5}
              max={60}
              step={0.5}
              value={cfg.intervalSec}
              onChange={(v) => onConfigChange({ ...cfg, intervalSec: v })}
              tooltip={{ formatter: (v) => `${v}秒一帧` }}
            />
          </div>
        )}
        <div className="vwb-param">
          <label>最大帧数</label>
          <Slider
            min={5}
            max={50}
            step={1}
            value={cfg.maxFrames}
            onChange={(v) => onConfigChange({ ...cfg, maxFrames: v })}
            tooltip={{ formatter: (v) => `${v} 张` }}
          />
        </div>

        <Button
          type="primary"
          block
          onClick={() => onExtract(cfg.strategy)}
          loading={busy}
          disabled={ffmpegReady !== true}
          icon={<Icons.Download size={14} />}
        >
          {busy ? (progress != null ? `提取中 ${Math.round(progress)}%` : '提取中…') : '提取关键帧'}
        </Button>
        {busy && progress != null && (
          <div className="vwb-progress">
            <div className="vwb-progress-track">
              <div className="vwb-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="vwb-progress-stage">{progressStage}</span>
          </div>
        )}
      </div>

      {/* ── 缩略图墙 ── */}
      <div className="vwb-section vwb-frames-section">
        <div className="vwb-section-head">
          <span className="vwb-section-title">
            关键帧 <em>{draft.keyframes.length}</em>
          </span>
          {draft.keyframes.length > 0 && (
            <Tooltip title="把关键帧导出为画布图片节点">
              <Button size="small" type="text" onClick={onExport} icon={<Icons.Image size={14} />}>
                导入画布
              </Button>
            </Tooltip>
          )}
        </div>

        {draft.keyframes.length === 0 ? (
          <div className="vwb-frames-empty">
            <Icons.Film size={28} />
            <span>暂无关键帧</span>
            <span className="muted">点击上方按钮按当前策略自动提取</span>
          </div>
        ) : (
          <div className="vwb-frame-grid">
            {draft.keyframes.map((kf) => (
              <div key={kf.index} className="vwb-frame-card">
                <div className="vwb-frame-thumb" onClick={() => onSeek(kf.timestampSec)}>
                  <img src={kf.previewUrl} alt={`帧 ${kf.index}`} loading="lazy" />
                  <span className="vwb-frame-time">{formatTimestamp(kf.timestampSec)}</span>
                  {kf.canvasNodeId && (
                    <Tooltip title="已导入画布">
                      <span className="vwb-frame-imported">
                        <Icons.CheckCircle size={12} />
                      </span>
                    </Tooltip>
                  )}
                </div>
                <button
                  className="vwb-frame-remove"
                  onClick={() => onRemoveKeyframe(kf.index)}
                  title="删除"
                >
                  <Icons.X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
