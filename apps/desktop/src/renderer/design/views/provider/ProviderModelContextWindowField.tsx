import { useCallback, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Icons } from '../../Icons'
import {
  CONTEXT_WINDOW_HARD_MAX,
  CONTEXT_WINDOW_HARD_MIN,
  CONTEXT_WINDOW_SLIDER_MAX,
  CONTEXT_WINDOW_SLIDER_MIN,
  clampNumber,
  contextWindowLogRatio,
  contextWindowRatioToValue,
  formatContextWindowTokens,
  normalizeContextWindowInput,
  snapContextWindowValue,
} from './context-window-math'
import './ProviderModelContextWindowField.less'

/** 行内键盘步进（tokens）：比渠道级滑块更细，便于微调单模型窗口 */
const KEYBOARD_STEP = 4_000

/** 均匀细刻度（每 5% 一格，含两端），与渠道级滑块同一口径 */
const SCALE_TICKS: readonly number[] = Array.from({ length: 21 }, (_, index) => index / 20)

/** 刻度尺标签：对数位置（200K=0%、400K≈43%、1M=100%），与渠道级滑块一致 */
const SCALE_LABELS: ReadonlyArray<{ value: number; ratio: number; label: string }> = [
  { value: CONTEXT_WINDOW_SLIDER_MIN, ratio: 0, label: '200K' },
  { value: 400_000, ratio: contextWindowLogRatio(400_000), label: '400K' },
  { value: CONTEXT_WINDOW_SLIDER_MAX, ratio: 1, label: '1M' },
]

export interface ProviderModelContextWindowFieldProps {
  /** 模型级显式窗口（tokens）；0 = 未配置（回落渠道级） */
  value: number
  /** 渠道级回落值（未配置时展示用，如「默认 · 256K」） */
  fallbackValue: number
  disabled?: boolean
  /** 写回模型级窗口；0 = 恢复默认（回落渠道级） */
  onChange: (contextWindow: number) => void
}

/**
 * 模型级「上下文窗口」控件：还原渠道级滑块设计（胶囊轨道 + 竖条手柄 + 对数刻度尺）。
 *
 * 布局稳定性（本控件的核心约束）：轨道右侧的「值 / 精确输入 / 恢复默认」三态
 * 共用同一个**固定宽度槽**（`--pv-mcw-slot`），槽宽不随状态变化，
 * 因此拖拽、保存、恢复默认过程中轨道几何与手柄位置绝不跳动。
 *
 * - 未配置：值槽显示 `默认 · {渠道级回落值}`，轨道填充与手柄半透明
 * - 拖拽 / 键盘：直接写模型级显式值（磁性吸附 200K/256K/400K/1M）
 * - 点击值：切数字输入（1024 – 10M，与后端 zod 一致），回车提交 / Esc 取消
 * - 恢复默认：值槽内的 ↺ 图标按钮（仅在已自定义时出现，且不改变槽宽）
 */
export function ProviderModelContextWindowField({
  value,
  fallbackValue,
  disabled = false,
  onChange,
}: ProviderModelContextWindowFieldProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')

  const isDefault = !(value > 0)
  const effective = isDefault ? fallbackValue : value
  const displayValue = clampNumber(effective, CONTEXT_WINDOW_SLIDER_MIN, CONTEXT_WINDOW_SLIDER_MAX)
  const ratio = contextWindowLogRatio(displayValue)

  const valueFromClientX = useCallback((clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return null
    const nextRatio = clampNumber((clientX - rect.left) / rect.width, 0, 1)
    return snapContextWindowValue(contextWindowRatioToValue(nextRatio))
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
      const next = valueFromClientX(event.clientX)
      if (next !== null) onChange(next)
    },
    [disabled, onChange, valueFromClientX],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging || disabled) return
      const next = valueFromClientX(event.clientX)
      if (next !== null) onChange(next)
    },
    [dragging, disabled, onChange, valueFromClientX],
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
      if (disabled) return
      let next: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        next = snapContextWindowValue(displayValue - KEYBOARD_STEP, false)
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        next = snapContextWindowValue(displayValue + KEYBOARD_STEP, false)
      } else if (event.key === 'Home') {
        next = CONTEXT_WINDOW_SLIDER_MIN
      } else if (event.key === 'End') {
        next = CONTEXT_WINDOW_SLIDER_MAX
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        next = 0
      }
      if (next !== null) {
        event.preventDefault()
        onChange(next)
      }
    },
    [disabled, displayValue, onChange],
  )

  const commitDraft = useCallback(() => {
    const raw = Number(draftText)
    if (draftText.trim() === '' || !Number.isFinite(raw) || raw <= 0) {
      // 空 / 非数 / <=0：视为恢复默认（与「未配置」语义一致）
      onChange(0)
    } else {
      const normalized = normalizeContextWindowInput(raw)
      onChange(normalized ?? CONTEXT_WINDOW_HARD_MAX)
    }
    setEditing(false)
  }, [draftText, onChange])

  const scaleLabels = useMemo(
    () =>
      SCALE_LABELS.map((item) => ({
        ...item,
        active: !isDefault && value === item.value,
      })),
    [isDefault, value],
  )

  const valueLabel = isDefault
    ? `默认 · ${formatContextWindowTokens(effective)}`
    : formatContextWindowTokens(value)

  return (
    <div
      className={`pv_mcw${disabled ? ' is-disabled' : ''}${isDefault ? ' is-default' : ''}`}
      data-state={isDefault ? 'default' : 'custom'}
    >
      <div className="pv_mcw_row">
        <div
          ref={trackRef}
          className={`pv_mcw_track${dragging ? ' is-dragging' : ''}`}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label="模型上下文窗口"
          aria-valuemin={CONTEXT_WINDOW_SLIDER_MIN}
          aria-valuemax={CONTEXT_WINDOW_SLIDER_MAX}
          aria-valuenow={displayValue}
          aria-valuetext={valueLabel}
          aria-disabled={disabled}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleKeyDown}
        >
          <div className="pv_mcw_fill" style={{ width: `${ratio * 100}%` }} />
          <div className="pv_mcw_handle" style={{ left: `${ratio * 100}%` }} />
        </div>
        {/* 固定宽度槽：值 / 精确输入 / 值+恢复默认，三态同宽 → 轨道不位移 */}
        <div className="pv_mcw_slot">
          {editing ? (
            <input
              className="pv_mcw_input"
              type="number"
              min={CONTEXT_WINDOW_HARD_MIN}
              max={CONTEXT_WINDOW_HARD_MAX}
              step={1024}
              value={draftText}
              placeholder="tokens"
              disabled={disabled}
              autoFocus
              onChange={(event) => setDraftText(event.target.value)}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitDraft()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                }
              }}
            />
          ) : (
            <>
              <button
                type="button"
                className="pv_mcw_value"
                disabled={disabled}
                title="点击输入精确值（1024 – 10M）"
                onClick={() => {
                  setDraftText(value > 0 ? String(value) : '')
                  setEditing(true)
                }}
              >
                {valueLabel}
              </button>
              {!isDefault && (
                <button
                  type="button"
                  className="pv_mcw_reset"
                  disabled={disabled}
                  aria-label="恢复默认上下文窗口"
                  title="恢复默认（回落渠道级上下文窗口）"
                  onClick={() => onChange(0)}
                >
                  <Icons.RotateCcw size={12} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="pv_mcw_scale" aria-hidden="true">
        {SCALE_TICKS.map((tick) => (
          <span key={tick} className="pv_mcw_tick" style={{ left: `${tick * 100}%` }} />
        ))}
        {scaleLabels.map((item) => (
          <span
            key={item.label}
            className={`pv_mcw_scale_label${item.ratio === 0 ? ' is-start' : ''}${
              item.ratio === 1 ? ' is-end' : ''
            }${item.active ? ' is-active' : ''}`}
            style={{ left: `${item.ratio * 100}%` }}
          >
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}
