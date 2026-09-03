import { useCallback } from 'react'
import { Select, Slider, Switch } from 'antd'
import type { CanvasDepthRenderPreference } from './canvasDepthRenderPreference'

const COLORMAP_OPTIONS = [
  { value: 'none', label: '灰度（默认）' },
  { value: 'turbo', label: '热力彩虹' },
  { value: 'viridis', label: '青绿渐变' },
] as const

type CanvasDepthRenderOptionsProps = {
  value: CanvasDepthRenderPreference
  disabled?: boolean
  /** 紧凑模式：深度专用媒体输入面板使用，小号控件、行距更紧 */
  compact?: boolean
  onChange: (next: CanvasDepthRenderPreference) => void
}

/**
 * 深度视频转换的渲染风格参数：反相、伪彩色、时序平滑、对比度。
 * 数值缺省时由 canvasDepthRenderPreference 保证与历史灰度输出一致。
 */
export function CanvasDepthRenderOptions({
  value,
  disabled,
  compact,
  onChange,
}: CanvasDepthRenderOptionsProps) {
  const update = useCallback(
    (key: keyof CanvasDepthRenderPreference, next: boolean | string | number) =>
      onChange({ ...value, [key]: next } as CanvasDepthRenderPreference),
    [onChange, value],
  )
  const controlSize = compact ? 'small' : 'middle'
  const isDisabled = disabled === true

  const invertRow = (
    <div
      className="canvas-operation-panel-hint"
      style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}
    >
      <span>反相深度</span>
      <Switch
        size={controlSize}
        aria-label="反相深度"
        checked={value.invert}
        disabled={isDisabled}
        onChange={(checked) => update('invert', checked)}
      />
    </div>
  )

  const colormapRow = (
    <div
      className="canvas-operation-panel-hint"
      style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}
    >
      <span>伪彩色</span>
      <Select
        size={controlSize}
        aria-label="伪彩色"
        value={value.colormap}
        disabled={isDisabled}
        options={COLORMAP_OPTIONS.map((option) => ({ ...option }))}
        style={{ width: 132 }}
        onChange={(next) => update('colormap', next)}
      />
    </div>
  )

  const smoothSlider = (
    <div style={{ paddingTop: 6 }}>
      <div
        className="canvas-operation-panel-hint"
        style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}
      >
        <span>时序平滑</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(value.smoothStrength * 100)}%
        </span>
      </div>
      <Slider
        min={0}
        max={1}
        step={0.05}
        value={value.smoothStrength}
        disabled={isDisabled}
        tooltip={{ formatter: (raw) => `${Math.round(Number(raw ?? 0) * 100)}%` }}
        onChange={(next) => update('smoothStrength', next)}
      />
      <div className="canvas-operation-panel-hint">越大画面越稳定；过高会产生运动拖影。</div>
    </div>
  )

  const contrastSlider = (
    <div style={{ paddingTop: 6 }}>
      <div
        className="canvas-operation-panel-hint"
        style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}
      >
        <span>对比度</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value.contrast}</span>
      </div>
      <Slider
        min={0}
        max={10}
        step={0.5}
        value={value.contrast}
        disabled={isDisabled}
        tooltip={{ formatter: (raw) => String(raw ?? '') }}
        onChange={(next) => update('contrast', next)}
      />
      <div className="canvas-operation-panel-hint">越大明暗对比越强，低值呈雾状层次。</div>
    </div>
  )

  if (compact) {
    return (
      <div style={{ marginTop: 10 }}>
        {invertRow}
        {colormapRow}
        {smoothSlider}
        {contrastSlider}
      </div>
    )
  }

  return (
    <div
      className="canvas-operation-panel-section canvas-operation-panel-section-runtime"
      style={{ paddingTop: 0 }}
    >
      <div className="canvas-operation-panel-section-label">深度渲染</div>
      {invertRow}
      {colormapRow}
      {smoothSlider}
      {contrastSlider}
    </div>
  )
}
