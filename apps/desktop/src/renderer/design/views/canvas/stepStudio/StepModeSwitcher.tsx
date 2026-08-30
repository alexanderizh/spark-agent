import type { ReactNode } from 'react'
import type { CanvasProjectMode } from '../canvas.types'
import { Icons } from '../../../Icons'

/**
 * 模式切换器（画布 ⇄ 步骤），画布模式顶栏与步骤模式顶栏共用。
 * 点击即切换：同窗口视图 swap，不重开窗口、不丢会话。
 */
export function StepModeSwitcher({
  mode,
  onSwitch,
  disabled = false,
}: {
  mode: CanvasProjectMode
  onSwitch: (mode: CanvasProjectMode) => void
  disabled?: boolean
}) {
  const options: Array<{ key: CanvasProjectMode; label: string; icon: ReactNode }> = [
    { key: 'canvas', label: '画布', icon: <Icons.Grid size={13} /> },
    { key: 'step', label: '步骤', icon: <Icons.Film size={13} /> },
  ]
  return (
    <div className="step-mode-switcher" role="group" aria-label="创作模式切换">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`step-mode-switcher-option${mode === option.key ? ' is-active' : ''}`}
          aria-pressed={mode === option.key}
          disabled={disabled}
          onClick={() => {
            if (mode !== option.key) onSwitch(option.key)
          }}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
}
