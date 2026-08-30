/**
 * VideoWorkbenchEditPanel — 视频剪辑工具面板。
 *
 * 时间型剪辑已移动到轨道直接操作；本面板仅保留参数型处理：
 *   - 转码：格式选择(mp4/webm/mov/gif) + 编码 + 分辨率 + CRF
 *   - 分割：按固定时长切段
 *   - 变速、倒放与画面裁剪
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactElement } from 'react'
import { Button, InputNumber, Select, Slider, message } from 'antd'
import { Icons } from '../../../Icons'
import type { VideoProbeInfo, WorkbenchOutput } from './videoWorkbench.types'
import { isVideoCropPixelsWithinBounds } from './videoCropModel'

interface Props {
  probe: VideoProbeInfo | undefined
  busy: boolean
  /** 当前操作进度 0~100，null 表示无活动 */
  progress: number | null
  /** ffmpeg 是否可用（null=检测中 false=不可用 true=可用） */
  ffmpegReady: boolean | null
  /** probe 是否失败（无 ffmpeg / 路径问题） */
  probeFailed: boolean
  /** 视频时长（秒），probe 失败时从 video 元素兜底 */
  fallbackDuration: number
  onProcess: (
    operation: string,
    params: Record<string, unknown>,
  ) => Promise<{ success: boolean; result?: unknown; error?: string }>
  /** 在左侧视频预览区开启可视化裁剪框 */
  onStartCrop: () => void
  /** 转码/裁剪产物生成后的回调（用于刷新产物列表）；一次操作可能产出多个文件（如等分切割） */
  onOutput?: (entries: {
    summary: string
    outputPath: string
    type: WorkbenchOutput['type']
  }[]) => void
}

export function VideoWorkbenchEditPanel({
  probe,
  busy,
  progress,
  ffmpegReady,
  probeFailed,
  fallbackDuration,
  onProcess,
  onStartCrop,
  onOutput,
}: Props): ReactElement {
  const duration = probe?.durationSec ?? fallbackDuration ?? 0

  // 转码
  const [tcFormat, setTcFormat] = useState<'mp4' | 'webm' | 'mov' | 'gif'>('mp4')
  const [tcCodec, setTcCodec] = useState<'libx264' | 'libx265' | 'libvpx-vp9'>('libx264')
  const [tcCrf, setTcCrf] = useState(23)
  const [tcScale, setTcScale] = useState(100) // 百分比

  // 分割
  const [segSec, setSegSec] = useState(10)

  // 音频分离
  const [audioExtractFormat, setAudioExtractFormat] = useState<'copy' | 'mp3' | 'aac' | 'wav'>(
    'copy',
  )

  // 画面处理
  const [speedFactor, setSpeedFactor] = useState(2)
  const [cropW, setCropW] = useState(probe?.width ?? 0)
  const [cropH, setCropH] = useState(probe?.height ?? 0)
  const [cropX, setCropX] = useState(0)
  const [cropY, setCropY] = useState(0)
  // 用户手动改过宽高后就不再跟随 probe（保留手动值）；否则切换源视频/probe 刷新时
  // 同步到新尺寸，避免拿旧视频的像素值去裁剪新视频而报"超出画面"。
  const cropSizeTouchedRef = useRef(false)
  useEffect(() => {
    if (cropSizeTouchedRef.current) return
    setCropW(probe?.width ?? 0)
    setCropH(probe?.height ?? 0)
  }, [probe?.width, probe?.height])
  const resolvedCropW = cropW || probe?.width || 0
  const resolvedCropH = cropH || probe?.height || 0

  // 当前操作的 loading 文案（busy 时显示）
  const [doingLabel, setDoingLabel] = useState('')

  // busy 时显示进度 loading，结束时销毁；返回清理函数：
  // 本面板随 Tab 条件渲染，操作进行中切 Tab 会卸载，没有清理函数时
  // duration:0 的 loading toast 会永久残留。
  useEffect(() => {
    if (busy && doingLabel) {
      const pct = progress != null ? ` ${Math.round(progress)}%` : ''
      message.loading({ content: `${doingLabel}${pct}…`, key: 'vwb-op', duration: 0 })
    } else {
      message.destroy('vwb-op')
    }
    return () => message.destroy('vwb-op')
  }, [busy, doingLabel, progress])

  /**
   * 通用操作执行器：抽取 6 个 handler 的公共模式。
   * 显示 loading → 调 IPC → 成功记录产物 + toast / 失败 toast。
   */
  const runOp = useCallback(
    async (
      operation: string,
      params: Record<string, unknown>,
      label: string,
      successMsg: string,
      outputSummary: string,
      outputType: WorkbenchOutput['type'],
      extractPath: (r: unknown) => string | string[],
    ): Promise<void> => {
      setDoingLabel(label)
      try {
        const res = await onProcess(operation, params)
        if (res.success && res.result) {
          if (successMsg) message.success(successMsg)
          const paths = extractPath(res.result)
          // 一次操作的多段产物（等分切割）合并成一次批量回调：
          // 单次提交保证一次持久化，且保持分段的时间顺序。
          const entries = (Array.isArray(paths) ? paths : [paths])
            .filter((path): path is string => Boolean(path))
            .map((path) => ({ summary: outputSummary, outputPath: path, type: outputType }))
          if (entries.length > 0) onOutput?.(entries)
        } else {
          message.error(res.error ?? `${label}失败`)
        }
      } catch (err) {
        message.error(`${label}失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setDoingLabel('')
      }
    },
    [onProcess, onOutput],
  )

  const handleTranscode = (): Promise<void> => {
    // 旧版本持久化的 probeInfo 可能缺 width/height，直接乘会把 NaN 传给 ffmpeg。
    const probeSizeValid =
      probe != null && Number.isFinite(probe.width) && probe.width > 0 && Number.isFinite(probe.height) && probe.height > 0
    const resolution =
      tcScale !== 100 && probeSizeValid
        ? {
            w: Math.round((probe.width * tcScale) / 100),
            h: Math.round((probe.height * tcScale) / 100),
          }
        : undefined
    const label = tcFormat === 'gif' ? 'GIF' : `${tcFormat.toUpperCase()}`
    return runOp(
      'transcode',
      { format: tcFormat, videoCodec: tcCodec, crf: tcCrf, ...(resolution ? { resolution } : {}) },
      tcFormat === 'gif' ? '生成 GIF' : `转码 ${label}`,
      `已转码为 ${label}`,
      `转码 ${label}${tcScale !== 100 ? ` ${tcScale}%` : ''}`,
      'transcode',
      (r) => (r as { path: string }).path,
    )
  }

  const handleSegment = (): Promise<void> =>
    runOp(
      'segment',
      { segmentSec: segSec },
      '分割',
      '', // 成功消息在 extractPath 后动态生成
      `分割 × ${segSec}s`,
      'segment',
      (r) => {
        const paths = (r as { paths: string[] }).paths
        message.success(`已分割为 ${paths.length} 段（每段 ${segSec}s）`)
        return paths
      },
    )

  const handleSpeed = (): Promise<void> => {
    const label = speedFactor >= 1 ? `${speedFactor}x 加速` : `${speedFactor}x 慢放`
    return runOp(
      'adjustSpeed',
      { factor: speedFactor },
      `变速`,
      `已${label}`,
      `变速 ${label}`,
      'effect',
      (r) => (r as { path: string }).path,
    )
  }

  const handleReverse = (): Promise<void> =>
    runOp(
      'reverse',
      { reverseAudio: true },
      '倒放',
      '已生成倒放视频',
      '倒放',
      'effect',
      (r) => (r as { path: string }).path,
    )

  const handleExtractAudio = (): Promise<void> => {
    const formatLabel =
      audioExtractFormat === 'copy' ? '原轨' : audioExtractFormat.toUpperCase()
    return runOp(
      'extractAudio',
      { audioFormat: audioExtractFormat },
      '分离音频',
      '已分离音频',
      `分离音频 (${formatLabel})`,
      'audio',
      (r) => (r as { path: string }).path,
    )
  }

  const handleCrop = (): Promise<void> => {
    if (resolvedCropW < 2 || resolvedCropH < 2) {
      message.error('裁剪宽高必须至少为 2×2')
      return Promise.resolve()
    }
    if (!probe) {
      message.error('视频尺寸尚未读取完成，请稍后再试')
      return Promise.resolve()
    }
    if (
      !isVideoCropPixelsWithinBounds(
        { x: cropX, y: cropY, w: resolvedCropW, h: resolvedCropH },
        probe.width,
        probe.height,
      )
    ) {
      message.error('裁剪区域必须至少为 2×2，且不能超出原视频画面')
      return Promise.resolve()
    }
    return runOp(
      'crop',
      { w: resolvedCropW, h: resolvedCropH, x: cropX, y: cropY },
      '画面裁剪',
      `已裁剪画面为 ${resolvedCropW}×${resolvedCropH}`,
      `画面裁剪 ${resolvedCropW}×${resolvedCropH}`,
      'effect',
      (r) => (r as { path: string }).path,
    )
  }

  // ffmpeg 不可用时的提示
  if (ffmpegReady === false) {
    return (
      <div className="vwb-placeholder">
        <Icons.AlertTriangle size={32} />
        <p>FFmpeg 未安装</p>
        <p className="muted">可在工作台顶部直接下载并安装 FFmpeg</p>
      </div>
    )
  }

  // probe 失败但有视频时长（video 元素兜底）—— 部分功能可用
  if (!probe && probeFailed) {
    return (
      <div className="vwb-placeholder">
        <Icons.Video size={32} />
        <p>视频信息探测失败</p>
        <p className="muted">剪辑/转码需要 FFmpeg，关键帧提取可能受限</p>
        <p className="muted">请确认 FFmpeg 已安装，或检查视频文件是否有效</p>
      </div>
    )
  }

  // probe 进行中（非失败）
  if (!probe && !probeFailed) {
    return (
      <div className="vwb-placeholder">
        <Icons.Video size={32} />
        <p>正在探测视频信息…</p>
      </div>
    )
  }

  return (
    <div className="vwb-edit-panel">
      <div className="vwb-edit-panel-hint">
        <Icons.Scissors size={14} />
        <span>时间裁剪、入出点与分割请直接在下方 V1 轨道操作。</span>
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
                → {Math.round((probe.width * tcScale) / 100)}×
                {Math.round((probe.height * tcScale) / 100)}
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
              <span className="vwb-tc-res-hint">将切分为约 {Math.ceil(duration / segSec)} 段</span>
            )}
          </div>
          <Button block onClick={handleSegment} loading={busy} icon={<Icons.Scissors size={14} />}>
            分割视频
          </Button>
        </div>
      </div>

      {/* ── 音频分离 ── */}
      <div className="vwb-section">
        <div className="vwb-section-title">音频分离</div>
        <div className="vwb-tc-controls">
          <div className="vwb-tc-param">
            <label>输出格式</label>
            <Select
              size="small"
              value={audioExtractFormat}
              onChange={(v) => setAudioExtractFormat(v)}
              style={{ width: '100%' }}
              options={[
                { label: '原轨抽取（最快无损）', value: 'copy' },
                { label: 'MP3', value: 'mp3' },
                { label: 'AAC / M4A', value: 'aac' },
                { label: 'WAV（无损）', value: 'wav' },
              ]}
            />
          </div>
          <Button
            block
            onClick={handleExtractAudio}
            loading={busy}
            icon={<Icons.AudioLines size={14} />}
          >
            分离音频
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
          <div className="vwb-crop-label-row">
            <label>画面裁剪区域</label>
            <span>支持预览区框选</span>
          </div>
          <Button
            size="small"
            type="primary"
            ghost
            block
            onClick={onStartCrop}
            loading={busy}
            disabled={busy}
            icon={<Icons.Crop size={14} />}
          >
            在预览区框选并裁剪
          </Button>
          <div className="vwb-crop-manual-hint">也可以输入像素坐标进行精确裁剪</div>
          <div className="vwb-crop-grid">
            <div className="vwb-crop-field">
              <span>X</span>
              <InputNumber
                size="small"
                min={0}
                max={probe?.width ?? 9999}
                value={cropX}
                onChange={(v) => setCropX(Number(v) || 0)}
              />
            </div>
            <div className="vwb-crop-field">
              <span>Y</span>
              <InputNumber
                size="small"
                min={0}
                max={probe?.height ?? 9999}
                value={cropY}
                onChange={(v) => setCropY(Number(v) || 0)}
              />
            </div>
            <div className="vwb-crop-field">
              <span>宽</span>
              <InputNumber
                size="small"
                min={1}
                max={probe?.width ?? 9999}
                value={resolvedCropW}
                onChange={(v) => {
                  cropSizeTouchedRef.current = true
                  setCropW(Number(v) || 0)
                }}
              />
            </div>
            <div className="vwb-crop-field">
              <span>高</span>
              <InputNumber
                size="small"
                min={1}
                max={probe?.height ?? 9999}
                value={resolvedCropH}
                onChange={(v) => {
                  cropSizeTouchedRef.current = true
                  setCropH(Number(v) || 0)
                }}
              />
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
