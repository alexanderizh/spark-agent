import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SessionReasoningEffort } from '@spark/protocol'
import { Icons } from '../../Icons'
import { ComposerSelectLabelTicker } from './ComposerSelectLabelTicker'
import { ReasoningMaxParticles } from './ReasoningMaxParticles'

type ReasoningOption = {
  value: SessionReasoningEffort
  label: string
  description: string
}

export function ComposerReasoningControl({
  value,
  options,
  fastMode,
  showFastMode,
  disabled = false,
  onChange,
  onFastModeChange,
}: {
  value: SessionReasoningEffort
  options: ReasoningOption[]
  fastMode: boolean
  showFastMode: boolean
  disabled?: boolean
  onChange: (value: SessionReasoningEffort) => void | Promise<void>
  onFastModeChange: (enabled: boolean) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current != null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const activeOption = options[activeIndex] ?? options[0]
  const maxIndex = Math.max(1, options.length - 1)
  const isMax = value === 'max'
  const edgeInset = 8
  const getInsetPosition = (index: number) => {
    const ratio = index / maxIndex
    return `calc(${ratio * 100}% + ${edgeInset - edgeInset * 2 * ratio}px)`
  }
  const activePosition = getInsetPosition(activeIndex)

  const commitValue = (nextValue: SessionReasoningEffort) => {
    setOpen(false)
    if (nextValue !== value) void onChange(nextValue)
  }

  const moveBy = (delta: number) => {
    const nextIndex = Math.min(maxIndex, Math.max(0, activeIndex + delta))
    const next = options[nextIndex]
    if (next != null) void onChange(next.value)
  }

  const selectByPointer = (clientX: number, rect: DOMRect) => {
    const rawRatio = (clientX - rect.left) / rect.width
    const nextIndex = Math.min(maxIndex, Math.max(0, Math.round(rawRatio * maxIndex)))
    const next = options[nextIndex]
    if (next != null) void onChange(next.value)
  }

  const title = disabled
    ? '会话运行中不可切换'
    : `推理强度：${activeOption?.description ?? activeOption?.label ?? value}${
        fastMode && showFastMode ? '；OpenAI 快速模式已开启' : ''
      }`

  return (
    <div
      ref={rootRef}
      className={`composer-select composer-menu-select composer-reasoning-select variant-enriched${disabled ? ' is-disabled' : ''}${open ? ' is-open' : ''}${fastMode && showFastMode ? ' is-fast-mode' : ''}${isMax ? ' is-max' : ''}`}
      title={title}
    >
      <span className="composer-select-icon">
        <Icons.Brain size={14} />
      </span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || options.length === 0}
        title={disabled ? '会话运行中不可切换' : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ComposerSelectLabelTicker label={activeOption?.label ?? value} />
        {fastMode && showFastMode && <span className="composer-fast-mode-indicator">Fast</span>}
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className={`composer-menu composer-reasoning-menu${isMax ? ' is-max' : ''}`}>
          <div className="composer-reasoning-head">
            <div className="composer-reasoning-title">
              <span>推理强度</span>
              <strong>{activeOption?.label ?? value}</strong>
            </div>
          </div>
          <div className="composer-reasoning-description">
            {activeOption?.description ?? '调整模型用于分析和推理的强度'}
          </div>
          <div className="composer-reasoning-axis" aria-hidden="true">
            <span>响应更快</span>
            <span>更强</span>
          </div>
          <div
            className="composer-reasoning-slider"
            role="slider"
            tabIndex={0}
            aria-label="推理强度"
            aria-valuemin={0}
            aria-valuemax={maxIndex}
            aria-valuenow={activeIndex}
            aria-valuetext={activeOption?.label ?? value}
            style={{ '--reasoning-fill-width': activePosition } as CSSProperties}
            onPointerDown={(event) => {
              if (disabled) return
              event.currentTarget.setPointerCapture(event.pointerId)
              selectByPointer(event.clientX, event.currentTarget.getBoundingClientRect())
            }}
            onPointerMove={(event) => {
              if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return
              selectByPointer(event.clientX, event.currentTarget.getBoundingClientRect())
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault()
                moveBy(-1)
              } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault()
                moveBy(1)
              } else if (event.key === 'Home') {
                event.preventDefault()
                const first = options[0]
                if (first != null) void onChange(first.value)
              } else if (event.key === 'End') {
                event.preventDefault()
                const last = options[maxIndex]
                if (last != null) void onChange(last.value)
              }
            }}
          >
            <span className="composer-reasoning-slider-fill" />
            {isMax && <ReasoningMaxParticles />}
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                className={`composer-reasoning-step${index === activeIndex ? ' active' : ''}`}
                style={{ '--reasoning-step-left': getInsetPosition(index) } as CSSProperties}
                title={`${option.label} · ${option.description}`}
                aria-label={option.label}
                onClick={() => commitValue(option.value)}
              >
                <span className="composer-reasoning-dot" />
              </button>
            ))}
            <span
              className="composer-reasoning-thumb"
              style={{ '--reasoning-step-left': activePosition } as CSSProperties}
            />
          </div>
          {showFastMode && (
            <div className="composer-fast-mode-section">
              <div className="composer-fast-mode-copy">
                <div className="composer-fast-mode-title">
                  <span>快速模式</span>
                  <span className="composer-fast-mode-cost">更高费用</span>
                </div>
              </div>
              <button
                type="button"
                className={`composer-fast-mode-switch${fastMode ? ' is-active' : ''}`}
                role="switch"
                aria-checked={fastMode}
                aria-label="OpenAI 快速模式"
                disabled={disabled}
                onClick={() => void onFastModeChange(!fastMode)}
              >
                <span />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
