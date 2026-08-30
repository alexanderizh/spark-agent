/**
 * BrowserToolbar — 浏览器导航工具栏。
 *
 * ‹ › ↻ + 地址栏 + 视口预设菜单（设备）+「选择元素加入会话」开关 + "…" 菜单
 * （在默认浏览器打开 / 打开控制面板 / 复制网址 / 切换面板·独立窗口）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement, FormEvent } from 'react'
import { Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { BROWSER_VIEWPORT_PRESETS } from './browserChromeShared'

/** 统一的工具按钮悬浮提示：@lobehub Tooltip（原生 title 触发太慢）。 */
function ToolbarTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip title={label} placement="bottom" mouseEnterDelay={0.15}>
      {children}
    </Tooltip>
  )
}

export interface BrowserToolbarProps {
  urlInput: string
  onUrlInputChange: (value: string) => void
  /** 地址栏聚焦/失焦（父组件借此判断是否跟随活动 tab 的 URL） */
  onUrlInputFocusChange?: (focused: boolean) => void
  onNavigateSubmit: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  canBack: boolean
  canForward: boolean
  pickerActive: boolean
  onTogglePicker: () => void
  viewportPresetId: string
  onViewportPresetChange: (id: string) => void
  variant: 'panel' | 'window'
  onOpenExternal: () => void
  onOpenDevtools: () => void
  onCopyUrl: () => void
  onSwitchMode: () => void
}

type MenuKind = 'device' | 'more' | null

export function BrowserToolbar({
  urlInput,
  onUrlInputChange,
  onUrlInputFocusChange,
  onNavigateSubmit,
  onBack,
  onForward,
  onReload,
  canBack,
  canForward,
  pickerActive,
  onTogglePicker,
  viewportPresetId,
  onViewportPresetChange,
  variant,
  onOpenExternal,
  onOpenDevtools,
  onCopyUrl,
  onSwitchMode,
}: BrowserToolbarProps): ReactElement {
  const [openMenu, setOpenMenu] = useState<MenuKind>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (openMenu == null) return
    const onDocMouseDown = (event: MouseEvent): void => {
      if (rootRef.current != null && !rootRef.current.contains(event.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [openMenu])

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    onNavigateSubmit()
    inputRef.current?.blur()
  }

  const runMenuAction = (action: () => void): void => {
    setOpenMenu(null)
    action()
  }

  return (
    <div className="browser-toolbar" ref={rootRef} role="toolbar" aria-label="浏览器工具栏">
      <div className="browser-toolbar-nav">
        <ToolbarTooltip label="后退">
          <button
            type="button"
            className="icon-btn"
            aria-label="后退"
            disabled={!canBack}
            onClick={onBack}
          >
            <Icons.ArrowLeft size={15} />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="前进">
          <button
            type="button"
            className="icon-btn"
            aria-label="前进"
            disabled={!canForward}
            onClick={onForward}
          >
            <Icons.ArrowRight size={15} />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="刷新">
          <button type="button" className="icon-btn" aria-label="刷新" onClick={onReload}>
            <Icons.RotateCw size={13} />
          </button>
        </ToolbarTooltip>
      </div>

      <form className="browser-toolbar-url" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="输入网址…"
          aria-label="地址栏"
          value={urlInput}
          onChange={(e) => onUrlInputChange(e.target.value)}
          onFocus={() => onUrlInputFocusChange?.(true)}
          onBlur={() => onUrlInputFocusChange?.(false)}
        />
      </form>

      <div className="browser-toolbar-device-wrap">
        <ToolbarTooltip label="视口尺寸">
          <button
            type="button"
            className={`icon-btn browser-toolbar-device${openMenu === 'device' ? ' is-open' : ''}`}
            aria-label="视口尺寸"
            onClick={() => setOpenMenu((v) => (v === 'device' ? null : 'device'))}
          >
            <Icons.Monitor size={14} />
          </button>
        </ToolbarTooltip>
        {openMenu === 'device' && (
          <div className="browser-menu browser-menu-device" role="menu">
            {BROWSER_VIEWPORT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="menuitemradio"
                aria-checked={preset.id === viewportPresetId}
                className={`browser-menu-item${
                  preset.id === viewportPresetId ? ' is-checked' : ''
                }`}
                onClick={() => runMenuAction(() => onViewportPresetChange(preset.id))}
              >
                <span className="browser-menu-item-label">{preset.label}</span>
                {preset.id === viewportPresetId && <Icons.Check size={12} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <ToolbarTooltip label={pickerActive ? '退出元素选择（Esc）' : '选择元素加入会话'}>
        <button
          type="button"
          className={`icon-btn browser-toolbar-picker${pickerActive ? ' is-active' : ''}`}
          aria-label="选择元素加入会话"
          aria-pressed={pickerActive}
          onClick={onTogglePicker}
        >
          <Icons.Crosshair size={15} />
        </button>
      </ToolbarTooltip>

      <div className="browser-toolbar-more">
        <ToolbarTooltip label="更多操作">
          <button
            type="button"
            className={`icon-btn${openMenu === 'more' ? ' is-open' : ''}`}
            aria-label="更多操作"
            onClick={() => setOpenMenu((v) => (v === 'more' ? null : 'more'))}
          >
            <Icons.More size={14} />
          </button>
        </ToolbarTooltip>
        {openMenu === 'more' && (
          <div className="browser-menu browser-menu-more" role="menu">
            <button
              type="button"
              role="menuitem"
              className="browser-menu-item"
              onClick={() => runMenuAction(onOpenExternal)}
            >
              <Icons.ExternalLink size={13} />
              <span className="browser-menu-item-label">在默认浏览器中打开</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="browser-menu-item"
              onClick={() => runMenuAction(onOpenDevtools)}
            >
              <Icons.Terminal size={13} />
              <span className="browser-menu-item-label">打开控制面板</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="browser-menu-item"
              onClick={() => runMenuAction(onCopyUrl)}
            >
              <Icons.Copy size={13} />
              <span className="browser-menu-item-label">复制当前网址</span>
            </button>
            <div className="browser-menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="browser-menu-item"
              onClick={() => runMenuAction(onSwitchMode)}
            >
              {variant === 'panel' ? <Icons.AppWindow size={13} /> : <Icons.PanelRight size={13} />}
              <span className="browser-menu-item-label">
                {variant === 'panel' ? '在独立窗口中打开' : '作为右侧面板打开'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
