/**
 * ChipList — 通用 chip 列表编辑器（input + 添加 + chip 列表）
 *
 * 设计要点
 * ─────────
 * - 适用于"添加 / 删除 / 显示一组短字符串"的场景（如 model ID 列表）。
 * - 锁定项（locked）不可删除，会渲染为带星标 / 不同底色的 chip。
 * - 输入框支持 Enter / 右侧 + 按钮添加；空白 / 重复值会被拒绝。
 * - chip 数量超过 maxVisible 时整体可滚动（maxHeight 默认 168px，约 6 行）。
 * - 风格与 .spark-input 一致（同 border / focus / radius），但作为一个整体卡片渲染，
 *   视觉上比"textarea + 列表"更 C 端。
 */
import { useState, useCallback, useRef, type KeyboardEvent } from 'react'
import { Icons } from '../Icons'

type ChipListProps = {
  value: string[]
  onChange: (next: string[]) => void
  /** 锁定项（不可删除，会作为 "primary" chip 高亮） */
  locked?: string[]
  /** placeholder */
  placeholder?: string
  /** chip 列表的最大高度（超过则内部滚动），默认 168 */
  maxHeight?: number
  /** 列表为空时显示的文字 */
  emptyText?: string
  /** 输入框 + 按钮不允许时禁用 */
  disabled?: boolean
  /** 紧凑模式（更小 padding、字号） */
  compact?: boolean
  /** 添加按钮 / chip 右上角的 aria-label 覆盖 */
  addLabel?: string
  removeLabel?: string
  /** 校验：返回 false 拒绝添加（默认会 trim & 查重） */
  validate?: (raw: string) => boolean
  /** 整体 className */
  className?: string
  /**
   * 点击 chip（默认模型切换）回调：
   * - 传入时，chip 会变成可点击的"切换默认"按钮。
   * - 父组件拿到被点击的 id 后通常将其设为 defaultModel（并把该 id 排在 modelIds 最前）。
   * - 默认模型自身再次点击不会有任何副作用（已经是默认）。
   */
  onSelectDefault?: (id: string) => void
  /** 可点击 chip 的提示文本（仅 onSelectDefault 存在时生效） */
  selectHint?: string
}

export function ChipList({
  value,
  onChange,
  locked = [],
  placeholder = '输入后按 Enter 添加…',
  maxHeight = 168,
  emptyText = '尚未添加任何条目',
  disabled = false,
  compact = false,
  addLabel = '添加',
  removeLabel = '删除',
  validate,
  className = '',
  onSelectDefault,
  selectHint = '点击切换为默认模型',
}: ChipListProps) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const lockedSet = new Set(locked)
  const lockedArr = value.filter((v) => lockedSet.has(v))
  const mutableArr = value.filter((v) => !lockedSet.has(v))

  const tryAdd = useCallback(
    (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return false
      if (validate && !validate(trimmed)) return false
      if (value.includes(trimmed)) return false
      // 保留锁定项在前的顺序
      onChange([...lockedArr, ...mutableArr, trimmed])
      return true
    },
    [lockedArr, mutableArr, onChange, validate, value],
  )

  const handleAdd = () => {
    if (tryAdd(draft)) {
      setDraft('')
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      // 空输入时按 Backspace 删除最后一个可删除项
      e.preventDefault()
      const next = mutableArr.slice(0, -1)
      onChange([...lockedArr, ...next])
    }
  }

  const handleRemove = (id: string) => {
    if (lockedSet.has(id)) return
    onChange(value.filter((v) => v !== id))
  }

  const isEmpty = value.length === 0

  return (
    <div
      className={`chip-list ${compact ? 'chip-list-compact' : ''} ${className}`}
      onClick={() => inputRef.current?.focus()}
    >
      <div className="chip-list-input-row">
        <input
          ref={inputRef}
          type="text"
          className="chip-list-input"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="chip-list-add"
          onClick={(e) => {
            e.stopPropagation()
            handleAdd()
          }}
          disabled={disabled || draft.trim() === ''}
          title={addLabel}
          aria-label={addLabel}
        >
          <Icons.Plus size={13} />
          <span>{addLabel}</span>
        </button>
      </div>

      <div
        className={`chip-list-area ${isEmpty ? 'chip-list-empty' : ''}`}
        style={isEmpty ? undefined : { maxHeight }}
      >
        {isEmpty ? (
          <div className="chip-list-empty-text">{emptyText}</div>
        ) : (
          <div className="chip-list-chips">
            {value.map((id) => {
              const isLocked = lockedSet.has(id)
              const clickable = !!onSelectDefault
              return (
                <span
                  key={id}
                  className={`chip ${isLocked ? 'chip-locked' : ''} ${clickable ? 'chip-clickable' : ''}`}
                  title={clickable ? (isLocked ? `${id}（默认模型）` : `${selectHint}: ${id}`) : id}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-pressed={clickable ? isLocked : undefined}
                  onClick={
                    clickable
                      ? () => {
                          // remove 按钮的 click 会 stopPropagation，所以这里只处理"切换默认"
                          if (isLocked) return
                          onSelectDefault(id)
                        }
                      : undefined
                  }
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && !isLocked) {
                            e.preventDefault()
                            onSelectDefault(id)
                          }
                        }
                      : undefined
                  }
                >
                  {isLocked && (
                    <span className="chip-locked-star" aria-hidden>
                      <Icons.Star size={10} />
                    </span>
                  )}
                  <span className="chip-label">{id}</span>
                  {!isLocked && (
                    <button
                      type="button"
                      className="chip-remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemove(id)
                      }}
                      title={removeLabel}
                      aria-label={`${removeLabel} ${id}`}
                    >
                      <Icons.X size={10} />
                    </button>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default ChipList
