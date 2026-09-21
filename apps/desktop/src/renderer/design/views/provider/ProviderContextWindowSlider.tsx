import { useCallback, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Input } from '@lobehub/ui'
import './ProviderContextWindowSlider.less'

/** 滑块承载范围（对数刻度）：200K → 1M，与预设 200K/256K/400K/1M 对齐 */
export const CONTEXT_WINDOW_SLIDER_MIN = 200_000
export const CONTEXT_WINDOW_SLIDER_MAX = 1_000_000
/** 未显式配置时的运行时回落值（与后端默认口径一致） */
export const CONTEXT_WINDOW_FALLBACK = 256_000
/** 自定义输入的硬边界，与后端 zod 校验保持一致 */
export const CONTEXT_WINDOW_HARD_MIN = 1024
export const CONTEXT_WINDOW_HARD_MAX = 10_000_000

/** 拖拽时的磁性预设：接近时吸附，保证 supportsMillionContext(=1M) 等关键值可精确命中 */
const MAGNET_PRESETS = [200_000, 256_000, 400_000, 1_000_000]
/** 与预设相对偏差在该比例内时吸附 */
const MAGNET_RATIO = 0.03
/** 键盘步进（tokens） */
const KEYBOARD_STEP = 4_000

const LOG_SPAN = Math.log(CONTEXT_WINDOW_SLIDER_MAX / CONTEXT_WINDOW_SLIDER_MIN)

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function logRatio(value: number): number {
  return Math.log(value / CONTEXT_WINDOW_SLIDER_MIN) / LOG_SPAN
}

function ratioToValue(ratio: number): number {
  return CONTEXT_WINDOW_SLIDER_MIN * Math.exp(LOG_SPAN * ratio)
}

/**
 * 吸附取整：统一按 1K 取整；magnet=true（拖拽）时在预设附近磁性吸附，
 * 键盘步进传 false，避免小步长被吸附吞掉（如在 256K 附近按不动）。
 */
function snapValue(value: number, magnet = true): number {
  const snapped = Math.round(value / 1000) * 1000
  if (magnet) {
    for (const preset of MAGNET_PRESETS) {
      if (Math.abs(snapped - preset) / preset <= MAGNET_RATIO) return preset
    }
  }
  return clamp(snapped, CONTEXT_WINDOW_SLIDER_MIN, CONTEXT_WINDOW_SLIDER_MAX)
}

/** 200K → "200K"；1M/1.5M/10M → "1M"/"1.5M"/"10M" */
export function formatContextWindowTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`
  }
  return `${Math.round(value / 1000)}K`
}

export interface ProviderContextWindowSliderProps {
  /** contextWindow tokens；0 = 未显式配置（默认） */
  value: number
  /** value=0 时运行时是否按 1M 回落（旧数据兼容：只开过 1M 开关） */
  supportsMillionContext: boolean
  /** 自定义输入意图：范围外数值 / 用户点「自定义」时为 true，与 value 数值解耦 */
  isCustom: boolean
  disabled?: boolean
  onChange: (contextWindow: number) => void
  onIsCustomChange: (custom: boolean) => void
}

/** 刻度尺标签：对数位置（200K=0%、400K≈43%、1M=100%） */
const SCALE_LABELS: Array<{ value: number; ratio: number; label: string }> = [
  { value: CONTEXT_WINDOW_SLIDER_MIN, ratio: 0, label: '200K' },
  { value: 400_000, ratio: logRatio(400_000), label: '400K' },
  { value: CONTEXT_WINDOW_SLIDER_MAX, ratio: 1, label: '1M' },
]

/**
 * 渠道模型的「上下文窗口」滑块：胶囊轨道 + 竖条手柄 + 对数刻度尺。
 * - 拖拽 / 键盘 = 直接写显式值（磁性吸附 200K/256K/400K/1M）
 * - 默认态（value=0）轨道半透明，手柄停在运行时回落值处
 * - 「自定义」保留范围外（<200K 或 >1M，上限 10M）与精确输入能力
 */
export function ProviderContextWindowSlider({
  value,
  supportsMillionContext,
  isCustom,
  disabled = false,
  onChange,
  onIsCustomChange,
}: ProviderContextWindowSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)

  // 滑块呈现值：显式值 > 运行时回落（1M 开关或 256K）；范围外夹到端点
  const effective = value > 0 ? value : supportsMillionContext ? CONTEXT_WINDOW_SLIDER_MAX : CONTEXT_WINDOW_FALLBACK
  const displayValue = clamp(effective, CONTEXT_WINDOW_SLIDER_MIN, CONTEXT_WINDOW_SLIDER_MAX)
  const ratio = logRatio(displayValue)
  const isDefault = value <= 0 && !isCustom

  const emitValue = useCallback(
    (next: number) => {
      onChange(next)
    },
    [onChange],
  )

  const valueFromClientX = useCallback((clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return null
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    return snapValue(ratioToValue(ratio))
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || isCustom) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
      const next = valueFromClientX(event.clientX)
      if (next !== null) emitValue(next)
    },
    [disabled, isCustom, emitValue, valueFromClientX],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging || disabled) return
      const next = valueFromClientX(event.clientX)
      if (next !== null) emitValue(next)
    },
    [dragging, disabled, emitValue, valueFromClientX],
  )

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setDragging(false)
    },
    [dragging],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled || isCustom) return
      let next: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        next = snapValue(displayValue - KEYBOARD_STEP, false)
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        next = snapValue(displayValue + KEYBOARD_STEP, false)
      } else if (event.key === 'Home') {
        next = CONTEXT_WINDOW_SLIDER_MIN
      } else if (event.key === 'End') {
        next = CONTEXT_WINDOW_SLIDER_MAX
      }
      if (next !== null) {
        event.preventDefault()
        emitValue(next)
      }
    },
    [disabled, isCustom, displayValue, emitValue],
  )

  const ticks = useMemo(() => {
    // 均匀细刻度（每 5% 一格，含两端），与图示刻度尺一致
    return Array.from({ length: 21 }, (_, index) => index / 20)
  }, [])

  const valueLabel = isDefault ? `默认（${supportsMillionContext ? '1M' : '256K'}）` : formatContextWindowTokens(value)

  return (
    <div className={`pv_cw${disabled ? ' is-disabled' : ''}`}>
      <div className="pv_cw_head">
        {isCustom ? (
          <Input
            className="pv_cw_input"
            size="middle"
            type="number"
            min={CONTEXT_WINDOW_HARD_MIN}
            max={CONTEXT_WINDOW_HARD_MAX}
            step={1024}
            value={value > 0 ? String(value) : ''}
            placeholder="tokens（1024 – 10M）"
            disabled={disabled}
            onChange={(e) => {
              const raw = Number((e.target as HTMLInputElement).value)
              // 空 / 非数 / <=0 → 0 视为暂未输入，保持自定义模式（由 isCustom 维持）；
              // 上限与后端 zod .max 一致，避免提交时才报错。
              let next = 0
              if (Number.isFinite(raw) && raw > 0) {
                next = Math.min(Math.floor(raw), CONTEXT_WINDOW_HARD_MAX)
              }
              emitValue(next)
            }}
          />
        ) : (
          <span className={`pv_cw_value${isDefault ? ' is-default' : ''}`}>{valueLabel}</span>
        )}
        <div className="pv_cw_actions">
          {isCustom ? (
            <button
              type="button"
              className="pv_cw_action"
              disabled={disabled}
              onClick={() => {
                onIsCustomChange(false)
                // 暂未输入（0）时回落 256K，保证退出自定义后滑块有合法呈现值
                if (value <= 0) emitValue(CONTEXT_WINDOW_FALLBACK)
              }}
            >
              返回滑块
            </button>
          ) : (
            <>
              <button
                type="button"
                className="pv_cw_action"
                disabled={disabled}
                onClick={() => onIsCustomChange(true)}
              >
                自定义
              </button>
              {!isDefault && (
                <button
                  type="button"
                  className="pv_cw_action"
                  disabled={disabled}
                  onClick={() => emitValue(0)}
                >
                  恢复默认
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div
        ref={trackRef}
        className={`pv_cw_track${dragging ? ' is-dragging' : ''}${isDefault ? ' is-default' : ''}`}
        role="slider"
        tabIndex={disabled || isCustom ? -1 : 0}
        aria-label="上下文窗口"
        aria-valuemin={CONTEXT_WINDOW_SLIDER_MIN}
        aria-valuemax={CONTEXT_WINDOW_SLIDER_MAX}
        aria-valuenow={displayValue}
        aria-valuetext={formatContextWindowTokens(displayValue)}
        aria-disabled={disabled || isCustom}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      >
        <div className="pv_cw_fill" style={{ width: `${ratio * 100}%` }} />
        <div className="pv_cw_handle" style={{ left: `${ratio * 100}%` }} />
      </div>

      <div className="pv_cw_scale" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} className="pv_cw_tick" style={{ left: `${tick * 100}%` }} />
        ))}
        {SCALE_LABELS.map((item) => {
          const active = !isDefault && value === item.value
          return (
            <span
              key={item.label}
              className={`pv_cw_scale_label${item.ratio === 0 ? ' is-start' : ''}${
                item.ratio === 1 ? ' is-end' : ''
              }${active ? ' is-active' : ''}`}
              style={{ left: `${item.ratio * 100}%` }}
            >
              {item.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
