/**
 * VideoWorkbenchEditPanel — 视频剪辑工具面板。
 *
 * 包含：
 *   - 裁剪：起止时间区间（从时间线手动标记或输入）→ 无损快切/精确切
 *   - 转码：格式选择(mp4/webm/mov/gif) + 编码 + 分辨率 + CRF
 *   - 分割：按固定时长切段
 *   - 合并：选择画布上其他视频节点（需从外部传入可选节点）
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Button, InputNumber, Select, Slider, message } from 'antd'
import { Icons } from '../../../Icons'
import { formatTimestamp, type VideoProbeInfo, type WorkbenchOutput } from './videoWorkbench.types'

type ProgressCb = (p: { percent: number; stage: string }) => void

interface Props {
  sourceVideoPath: string
  probe: VideoProbeInfo | undefined
  busy: boolean
  /** 当前时间线位置（秒），用于「设为起点/终点」 */
  currentTime: number
  onProcess: (
    operation: string,
    params: Record<string, unknown>,
    onProgress: ProgressCb,
  ) => Promise<{ success: boolean; result?: unknown; error?: string }>
  /** 转码/裁剪产物生成后的回调（用于刷新产物列表） */
  onOutput?: (summary: string, outputPath: string, type: WorkbenchOutput['type']) => void
}

export function VideoWorkbenchEditPanel({
  sourceVideoPath,
  probe,
  busy,
  currentTime,
  onProcess,
  onOutput,
}: Props): ReactElement {
  const duration = probe?.durationSec ?? 0
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(duration)
  const [trimCopy, setTrimCopy] = useState(true)

  // 转码
  const [tcFormat, setTcFormat] = useState<'mp4' | 'webm' | 'mov' | 'gif'>('mp4')
  const [tcCodec, setTcCodec] = useState<'libx264' | 'libx265' | 'libvpx-vp9' | 'copy'>('libx264')
  const [tcCrf, setTcCrf] = useState(23)
  const [tcScale, setTcScale] = useState(100) // 百分比

  // 分割
  const [segSec, setSegSec] = useState(10)

  // 画面处理
  const [speedFactor, setSpeedFactor] = useState(2)
  const [cropW, setCropW] = useState(probe?.width ?? 0)
  const [cropH, setCropH] = useState(probe?.height ?? 0)
  const [cropX, setCropX] = useState(0)
  const [cropY, setCropY] = useState(0)

  const handleTrim = async (): Promise<void> => {
    if (trimEnd <= trimStart) {
      message.error('结束时间必须大于起始时间')
      return
    }
    const reqId = Math.random().toString(36).slice(2, 10)
    const res = await onProcess('trim', { startSec: trimStart, endSec: trimEnd, copy: trimCopy }, (p) => {
      message.loading({ content: `裁剪中 ${Math.round(p.percent)}%`, key: reqId, duration: 0 })
    })
    message.destroy(reqId)
    if (res.success && res.result) {
      const { path } = res.result as { path: string }
      message.success(`已裁剪 ${formatTimestamp(trimStart)} ~ ${formatTimestamp(trimEnd)}`)
      onOutput?.(`裁剪 ${formatTimestamp(trimStart)}-${formatTimestamp(trimEnd)}`, path, 'trim')
    } else {
      message.error(res.error ?? '裁剪失败')
    }
  }

  const handleTranscode = async (): Promise<void> => {
    const resolution = tcScale !== 100 && probe
      ? { w: Math.round((probe.width * tcScale) / 100), h: Math.round((probe.height * tcScale) / 100) }
      : undefined
    const reqId = Math.random().toString(36).slice(2, 10)
    const res = await onProcess(
      'transcode',
      { format: tcFormat, videoCodec: tcCodec, crf: tcCrf, ...(resolution ? { resolution } : {}) },
      (p) => {
        message.loading({ content: `转码中 ${Math.round(p.percent)}%`, key: reqId, duration: 0 })
      },
    )
    message.destroy(reqId)
    if (res.success && res.result) {
      const { path } = res.result as { path: string }
      const label = tcFormat === 'gif' ? 'GIF' : `${tcFormat.toUpperCase()} (${tcCodec})`
      message.success(`已转码为 ${label}`)
      onOutput?.(`转码 ${label}${tcScale !== 100 ? ` ${tcScale}%` : ''}`, path, 'transcode')
    } else {
      message.error(res.error ?? '转码失败')
    }
  }

  const handleSegment = async (): Promise<void> => {
    const reqId = Math.random().toString(36).slice(2, 10)
    const res = await onProcess('segment', { segmentSec: segSec }, (p) => {
      message.loading({ content: `分割中 ${Math.round(p.percent)}%`, key: reqId, duration: 0 })
    })
    message.destroy(reqId)
    if (res.success && res.result) {
      const { paths } = res.result as { paths: string[] }
      message.success(`已分割为 ${paths.length} 段（每段 ${segSec}s）`)
      onOutput?.(`分割 ${paths.length} 段 × ${segSec}s`, paths[0] ?? '', 'concat')
    } else {
      message.error(res.error ?? '分割失败')
    }
  }

  const handleSpeed = async (): Promise<void> => {
    const reqId = Math.random().toString(36).slice(2, 10)
    const res = await onProcess('adjustSpeed', { factor: speedFactor }, (p) => {
      message.loading({ content: `变速中 ${Math.round(p.percent)}%`, key: reqId, duration: 0 })
    })
    message.destroy(reqId)
    if (res.success && res.result) {
      const { path } = res.result as { path: string }
      const label = speedFactor >= 1 ? `${speedFactor}x 加速` : `${speedFactor}x 慢放`
      message.success(`已${label}`)
      onOutput?.(`变速 ${label}`, path, 'effect')
    } else {
      message.error(res.error ?? '变速失败')
    }
  }

  const handleReverse = async (): Promise<void> => {
    const reqId = Math.random().toString(36).slice(2, 10)
    const res = await onProcess('reverse', { reverseAudio: true }, (p) => {
      message.loading({ content: `倒放中 ${Math.round(p.percent)}%`, key: reqId, duration: 0 })
    })
    message.destroy(reqId)
    if (res.success && res.result) {
      const { path } = res.result as { path: string }
      message.success('已生成倒放视频')
      onOutput?.('倒放', path, 'effect')
    } else {
      message.error(res.error ?? '倒放失败')
    }
  }

  const handleCrop = async (): Promise<void> => {
    if (cropW <= 0 || cropH <= 0) {
      message.error('裁剪宽高必须大于 0')
      return
    }
    const reqId = Math.random().toString(36).slice(2, 10)
    const res = await onProcess('crop', { w: cropW, h: cropH, x: cropX, y: cropY }, (p) => {
      message.loading({ content: `裁剪画面中 ${Math.round(p.percent)}%`, key: reqId, duration: 0 })
    })
    message.destroy(reqId)
    if (res.success && res.result) {
      const { path } = res.result as { path: string }
      message.success(`已裁剪画面为 ${cropW}×${cropH}`)
      onOutput?.(`画面裁剪 ${cropW}×${cropH}`, path, 'effect')
    } else {
      message.error(res.error ?? '画面裁剪失败')
    }
  }

  if (!probe) {
    return (
      <div className="vwb-placeholder">
        <Icons.Video size={32} />
        <p>正在探测视频信息…</p>
      </div>
    )
  }

  return (
    <div className="vwb-edit-panel">
      {/* ── 裁剪 ── */}
      <div className="vwb-section">
        <div className="vwb-section-title">裁剪片段</div>
        <div className="vwb-trim-controls">
          <div className="vwb-trim-field">
            <label>起点</label>
            <div className="vwb-trim-input-row">
              <InputNumber
                size="small"
                min={0}
                max={duration}
                step={0.1}
                value={trimStart}
                onChange={(v) => setTrimStart(Number(v) || 0)}
                style={{ flex: 1 }}
              />
              <Button size="small" type="text" onClick={() => setTrimStart(Math.round(currentTime * 10) / 10)}>
                设为当前
              </Button>
            </div>
          </div>
          <div className="vwb-trim-field">
            <label>终点</label>
            <div className="vwb-trim-input-row">
              <InputNumber
                size="small"
                min={trimStart}
                max={duration}
                step={0.1}
                value={trimEnd}
                onChange={(v) => setTrimEnd(Number(v) || duration)}
                style={{ flex: 1 }}
              />
              <Button size="small" type="text" onClick={() => setTrimEnd(Math.round(currentTime * 10) / 10)}>
                设为当前
              </Button>
            </div>
          </div>
          <div className="vwb-trim-duration">
            时长：{formatTimestamp(trimEnd - trimStart)}
          </div>
          <div className="vwb-trim-copy-toggle">
            <Button
              size="small"
              type={trimCopy ? 'primary' : 'default'}
              onClick={() => setTrimCopy(true)}
            >
              无损快切
            </Button>
            <Button
              size="small"
              type={!trimCopy ? 'primary' : 'default'}
              onClick={() => setTrimCopy(false)}
            >
              精确切
            </Button>
          </div>
          <Button
            type="primary"
            block
            onClick={handleTrim}
            loading={busy}
            disabled={trimEnd <= trimStart}
            icon={<Icons.Scissors size={14} />}
          >
            裁剪
          </Button>
        </div>
      </div>

      {/* ── 转码 ── */}
      <div className="vwb-section">
        <div className="vwb-section-title">转码 / 格式转换</div>
        <div className="vwb-tc-controls">
          <div className="vwb-tc-row">
            <div className="vwb-tc-field">
              <label>格式</label>
              <Select
                size="small"
                value={tcFormat}
                onChange={(v) => setTcFormat(v)}
                style={{ width: '100%' }}
                options={[
                  { label: 'MP4', value: 'mp4' },
                  { label: 'WebM', value: 'webm' },
                  { label: 'MOV', value: 'mov' },
                  { label: 'GIF 动图', value: 'gif' },
                ]}
              />
            </div>
            <div className="vwb-tc-field">
              <label>视频编码</label>
              <Select
                size="small"
                value={tcCodec}
                onChange={(v) => setTcCodec(v)}
                style={{ width: '100%' }}
                disabled={tcFormat === 'gif'}
                options={[
                  { label: 'H.264 (libx264)', value: 'libx264' },
                  { label: 'H.265 (libx265)', value: 'libx265' },
                  { label: 'VP9 (libvpx-vp9)', value: 'libvpx-vp9' },
                ]}
              />
            </div>
          </div>
          {tcFormat !== 'gif' && (
            <div className="vwb-tc-param">
              <label>质量 CRF（越小越高）</label>
              <Slider min={18} max={32} step={1} value={tcCrf} onChange={setTcCrf} />
            </div>
          )}
          <div className="vwb-tc-param">
            <label>缩放比例</label>
            <Slider
              min={10}
              max={100}
              step={5}
              value={tcScale}
              onChange={setTcScale}
              tooltip={{ formatter: (v) => `${v}%` }}
            />
            {tcScale !== 100 && probe && (
              <span className="vwb-tc-res-hint">
                → {Math.round((probe.width * tcScale) / 100)}×{Math.round((probe.height * tcScale) / 100)}
              </span>
            )}
          </div>
          <Button
            type="primary"
            block
            onClick={handleTranscode}
            loading={busy}
            icon={<Icons.Refresh size={14} />}
          >
            {tcFormat === 'gif' ? '生成 GIF' : '转码'}
          </Button>
        </div>
      </div>

      {/* ── 分割 ── */}
      <div className="vwb-section">
        <div className="vwb-section-title">等分切割</div>
        <div className="vwb-seg-controls">
          <div className="vwb-tc-param">
            <label>每段时长（秒）</label>
            <Slider min={2} max={120} step={1} value={segSec} onChange={setSegSec} />
            {duration > 0 && (
              <span className="vwb-tc-res-hint">
                将切分为约 {Math.ceil(duration / segSec)} 段
              </span>
            )}
          </div>
          <Button block onClick={handleSegment} loading={busy} icon={<Icons.Scissors size={14} />}>
            分割视频
          </Button>
        </div>
      </div>

      {/* ── 画面处理 ── */}
      <div className="vwb-section">
        <div className="vwb-section-title">画面处理</div>

        {/* 变速 */}
        <div className="vwb-effect-row">
          <div className="vwb-tc-param">
            <label>播放速度</label>
            <Slider
              min={0.25}
              max={4}
              step={0.25}
              value={speedFactor}
              onChange={setSpeedFactor}
              tooltip={{ formatter: (v) => `${v}x` }}
            />
          </div>
          <Button size="small" onClick={handleSpeed} loading={busy} disabled={busy}>
            {speedFactor >= 1 ? '加速' : '慢放'}
          </Button>
        </div>

        {/* 倒放 */}
        <div className="vwb-effect-row">
          <span className="vwb-effect-label">视频倒放</span>
          <Button size="small" onClick={handleReverse} loading={busy} disabled={busy}>
            生成倒放
          </Button>
        </div>

        {/* 画面裁剪 */}
        <div className="vwb-crop-controls">
          <label>画面裁剪区域</label>
          <div className="vwb-crop-grid">
            <div className="vwb-crop-field">
              <span>X</span>
              <InputNumber size="small" min={0} max={probe.width} value={cropX} onChange={(v) => setCropX(Number(v) || 0)} />
            </div>
            <div className="vwb-crop-field">
              <span>Y</span>
              <InputNumber size="small" min={0} max={probe.height} value={cropY} onChange={(v) => setCropY(Number(v) || 0)} />
            </div>
            <div className="vwb-crop-field">
              <span>宽</span>
              <InputNumber size="small" min={1} max={probe.width} value={cropW} onChange={(v) => setCropW(Number(v) || 0)} />
            </div>
            <div className="vwb-crop-field">
              <span>高</span>
              <InputNumber size="small" min={1} max={probe.height} value={cropH} onChange={(v) => setCropH(Number(v) || 0)} />
            </div>
          </div>
          <Button size="small" block onClick={handleCrop} loading={busy} disabled={busy}>
            裁剪画面
          </Button>
        </div>
      </div>
    </div>
  )
}
