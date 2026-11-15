/**
 * 配置栏下拉（助手 / 权限 / 模型共用）。
 *
 * 锚定在 chip 上方（输入区在底部，朝上开才不会被窗口底边裁掉）。
 * 点外部或 Esc 关闭；不接管焦点，调用方保持输入框焦点即可。
 */
import { useEffect, useRef } from 'react'
import { Icons } from '../../Icons'
import type { RemoteSelectOption } from './remoteComposerModel'

export interface RemoteMenuSection {
  title?: string
  options: RemoteSelectOption[]
}

export interface RemoteComposerMenuProps {
  ariaLabel: string
  sections: RemoteMenuSection[]
  /** 没有可选项时的说明（旧版目标端 / 目录为空） */
  emptyHint?: string
  busy: boolean
  /** 右侧贴边（模型 chip 在最右，朝左开） */
  alignRight?: boolean
  onPick: (option: RemoteSelectOption) => void
  onClose: () => void
  /** 置顶切换（仅模型菜单传入）。选项带 pinned 字段（boolean）才渲染置顶按钮。 */
  onTogglePin?: (option: RemoteSelectOption) => void
}

export function RemoteComposerMenu({
  ariaLabel,
  sections,
  emptyHint = '这台电脑没有提供可选项',
  busy,
  alignRight = false,
  onPick,
  onClose,
  onTogglePin,
}: RemoteComposerMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const node = rootRef.current
      if (node != null && event.target instanceof Node && node.contains(event.target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // capture：避免被输入区/滚动容器的 stopPropagation 吞掉
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  const total = sections.reduce((sum, section) => sum + section.options.length, 0)

  return (
    <div
      ref={rootRef}
      className={`rc-config-menu${alignRight ? ' is-right' : ''}`}
      role="menu"
      aria-label={ariaLabel}
    >
      {total === 0 ? (
        <div className="rc-config-empty">{emptyHint}</div>
      ) : (
        sections.map((section, index) => (
          <div className="rc-config-group" key={section.title ?? `s${index}`}>
            {section.title != null && <div className="rc-config-group-title">{section.title}</div>}
            {section.options.map((option) => {
              const pinning = onTogglePin != null && typeof option.pinned === 'boolean'
              const item = (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.selected === true}
                  className={`rc-config-item${option.selected ? ' is-selected' : ''}${
                    option.tone === 'danger' ? ' is-danger' : ''
                  }`}
                  disabled={busy}
                  onClick={() => onPick(option)}
                  title={option.description}
                >
                  <span className="rc-config-item-label">{option.label}</span>
                  {option.description != null && (
                    <span className="rc-config-item-desc">{option.description}</span>
                  )}
                  {option.selected === true && (
                    <span className="rc-config-item-check">
                      <Icons.Check size={12} />
                    </span>
                  )}
                </button>
              )
              if (!pinning) return item
              // 置顶按钮必须是主体的兄弟节点：button 套 button 非法，点击也会串
              const pinned = option.pinned === true
              return (
                <div className="rc-config-item-row" key={option.id}>
                  {item}
                  <button
                    type="button"
                    className={`rc-config-pin${pinned ? ' is-pinned' : ''}`}
                    title={pinned ? '取消置顶' : '置顶'}
                    aria-label={pinned ? `取消置顶 ${option.label}` : `置顶 ${option.label}`}
                    aria-pressed={pinned}
                    disabled={busy}
                    onMouseDown={(event) => {
                      // 防止输入框失焦/文本选中；stopPropagation 防止事件穿过行容器
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onTogglePin(option)
                    }}
                  >
                    {pinned ? <Icons.PinFill size={12} /> : <Icons.Pin size={12} />}
                  </button>
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
