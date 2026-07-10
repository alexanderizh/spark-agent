/**
 * TweaksPanel — 右下角悬浮主题/主色/密度/视图调节面板
 *
 * 简化版：去掉原设计中与外部 host 的 postMessage 协议；保留拖动、毛玻璃外观、
 * 节段控件、色板等交互。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Select } from '@lobehub/ui'
import { PRIMARIES, useApp } from './AppContext'

const PANEL_CSS = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    background:rgba(250,249,247,.85);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483646;
    width:44px;height:44px;border-radius:50%;border:0;
    background:rgba(20,20,24,.9);color:#fff;cursor:pointer;
    box-shadow:0 4px 16px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center}
  .twk-launcher:hover{transform:translateY(-1px)}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}
  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}
  .twk-field{width:100%}
  .twk-field{min-height:26px;min-width:0}
  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:pointer;padding:4px 6px;line-height:1.2}
  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:pointer;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}
  .twk-chips{display:flex;gap:6px;flex-wrap:wrap}
  .twk-chip{position:relative;appearance:none;width:34px;height:34px;
    padding:0;border:0;border-radius:8px;overflow:hidden;cursor:pointer;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06)}
  .twk-chip:hover{transform:translateY(-1px)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),0 2px 6px rgba(0,0,0,.15)}
  .twk-chip svg{position:absolute;top:9px;left:9px;width:16px;height:16px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));color:#fff}
`

function Row({ label, value, children, inline = false }: { label: string; value?: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  )
}

function Section({ label }: { label: string }) {
  return <div className="twk-sect">{label}</div>
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  const idx = Math.max(0, options.indexOf(value))
  const n = options.length
  return (
    <div className="twk-seg" role="radiogroup">
      <div
        className="twk-seg-thumb"
        style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`, width: `calc((100% - 4px) / ${n})` }}
      />
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="twk-toggle" data-on={value ? '1' : '0'} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <i />
    </button>
  )
}

export function TweaksPanel() {
  const { t, setTweak } = useApp()
  const [open, setOpen] = useState(false)
  const dragRef = useRef<HTMLDivElement | null>(null)
  const offsetRef = useRef({ x: 16, y: 16 })

  const onDragStart = (e: React.MouseEvent) => {
    const panel = dragRef.current
    if (!panel) return
    const r = panel.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    const startRight = window.innerWidth - r.right
    const startBottom = window.innerHeight - r.bottom
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: Math.max(8, startRight - (ev.clientX - sx)),
        y: Math.max(8, startBottom - (ev.clientY - sy)),
      }
      if (panel) {
        panel.style.right = offsetRef.current.x + 'px'
        panel.style.bottom = offsetRef.current.y + 'px'
      }
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  useEffect(() => {
    // 注入样式（只 1 次）
    if (!document.getElementById('twk-panel-css')) {
      const s = document.createElement('style')
      s.id = 'twk-panel-css'
      s.textContent = PANEL_CSS
      document.head.appendChild(s)
    }
  }, [])

  if (!open) {
    return (
      <button className="twk-launcher" onClick={() => setOpen(true)} title="Tweaks">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="2.5" />
          <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4.8a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.8-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-.8a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.8 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
        </svg>
      </button>
    )
  }

  return (
    <div ref={dragRef} className="twk-panel">
      <div className="twk-hd" onMouseDown={onDragStart}>
        <b>Tweaks</b>
        <button className="twk-x" aria-label="关闭" onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)}>✕</button>
      </div>
      <div className="twk-body">
        <Section label="主题" />
        <Row label="模式">
          <Seg value={t.theme} options={['light', 'dark', 'system']} onChange={(v) => setTweak('theme', v)} />
        </Row>
        <Row label="主色">
          <div className="twk-chips" role="radiogroup">
            {Object.keys(PRIMARIES).map((c) => {
              const on = t.primary === c
              return (
                <button
                  key={c}
                  type="button"
                  className="twk-chip"
                  role="radio"
                  aria-checked={on}
                  data-on={on ? '1' : '0'}
                  style={{ background: c }}
                  onClick={() => setTweak('primary', c)}
                  title={PRIMARIES[c]?.name}
                >
                  {on && (
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12l5 5L20 7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </Row>

        <Section label="布局" />
        <Row label="密度">
          <Seg value={t.density} options={['compact', 'regular', 'comfy']} onChange={(v) => setTweak('density', v)} />
        </Row>
        <Section label="视图" />
        <Row label="当前视图">
          <Select
            className="twk-field"
            value={t.view}
            onChange={(value) => setTweak('view', value as Tweaks['view'])}
            options={[
              { label: 'home', value: 'home' },
              { label: 'chat', value: 'chat' },
              { label: 'workflow', value: 'workflow' },
              { label: 'agents', value: 'agents' },
              { label: 'skills', value: 'skills' },
              { label: 'mcp', value: 'mcp' },
              { label: 'settings', value: 'settings' },
            ]}
          />
        </Row>
        <Row label="会话模式">
          {/* workspace 仅为历史状态兼容保留，已废弃；新入口统一使用 vibe。 */}
          <Seg value={t.chatMode} options={['vibe', 'workspace']} onChange={(v) => setTweak('chatMode', v)} />
        </Row>

        <Section label="覆盖层" />
        <Row label="命令面板" inline>
          <Toggle value={t.showPalette} onChange={(v) => setTweak('showPalette', v)} />
        </Row>
        <Row label="审批弹窗" inline>
          <Toggle value={t.showPerm} onChange={(v) => setTweak('showPerm', v)} />
        </Row>
        <Row label="Provider 编辑" inline>
          <Toggle value={t.showProviderEdit} onChange={(v) => setTweak('showProviderEdit', v)} />
        </Row>
        <Row label="模型 Profile 编辑" inline>
          <Toggle value={t.showProfileEdit} onChange={(v) => setTweak('showProfileEdit', v)} />
        </Row>
      </div>
    </div>
  )
}

// 这里仅做 TS 引用，避免 type 引用编译错误
type Tweaks = import('./AppContext').Tweaks
