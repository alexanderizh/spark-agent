/**
 * elementPickerScript — 「选择元素加入会话」的注入脚本与结果格式化。
 *
 * 通信机制：宿主通过 webview.executeJavaScript(script) 注入下方脚本，脚本
 * 返回一个 pending Promise；用户点击元素时 Promise resolve 拾取结果（或
 * Esc / 宿主取消时 resolve null）。宿主侧取消通过注入 CANCEL_SCRIPT 调用
 * 页面里登记的 window.__sparkPickerCancel 完成，无需 preload。
 *
 * 已知限制：仅覆盖主 frame（跨域 iframe 内的点击不被捕获）。
 */

/** 激活拾取模式；求值结果即「用户点击的元素信息 | null」。 */
export const ELEMENT_PICKER_SCRIPT = `(() => {
  if (window.__sparkPickerActive) {
    if (typeof window.__sparkPickerCancel === 'function') window.__sparkPickerCancel()
  }
  return new Promise((resolve) => {
    window.__sparkPickerActive = true
    let settled = false
    const prevCursor = document.documentElement.style.cursor
    const box = document.createElement('div')
    box.setAttribute('style', [
      'position:fixed', 'left:0', 'top:0', 'z-index:2147483647', 'pointer-events:none',
      'border:2px solid #6b8afd', 'background:rgba(107,138,253,0.14)', 'border-radius:3px',
      'display:none'
    ].join(';'))
    const tip = document.createElement('div')
    tip.setAttribute('style', [
      'position:fixed', 'left:0', 'top:0', 'z-index:2147483647', 'pointer-events:none',
      'background:#1f2937', 'color:#fff', 'font:11px ui-monospace,SFMono-Regular,monospace',
      'padding:2px 6px', 'border-radius:3px', 'max-width:480px', 'overflow:hidden',
      'text-overflow:ellipsis', 'white-space:nowrap', 'display:none'
    ].join(';'))
    document.documentElement.appendChild(box)
    document.documentElement.appendChild(tip)
    document.documentElement.style.cursor = 'crosshair'

    const selectorFor = (el) => {
      const parts = []
      let node = el
      let depth = 0
      while (node && node instanceof Element && node !== document.body && depth < 5) {
        let part = node.tagName.toLowerCase()
        if (node.id) {
          parts.unshift('#' + CSS.escape(node.id))
          break
        }
        const parent = node.parentElement
        if (parent != null) {
          const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName)
          if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')'
        }
        const cls = typeof node.className === 'string' ? node.className.trim().split(/\\s+/)[0] : ''
        if (cls) part += '.' + CSS.escape(cls)
        parts.unshift(part)
        node = parent
        depth++
      }
      return parts.join(' > ')
    }

    const describe = (el) => {
      const rect = el.getBoundingClientRect()
      const text = (el.innerText || (typeof el.value === 'string' ? el.value : '') || '')
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 80)
      const link = el.closest ? el.closest('a') : null
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.getAttribute('name'),
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        inputType: el.getAttribute('type'),
        classes:
          typeof el.className === 'string'
            ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3)
            : [],
        text: text || null,
        href: link != null ? link.href : null,
        selector: selectorFor(el),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        pageUrl: location.href,
      }
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      box.remove()
      tip.remove()
      document.documentElement.style.cursor = prevCursor
      window.__sparkPickerActive = false
      window.__sparkPickerCancel = null
    }
    const finish = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    window.__sparkPickerCancel = () => finish(null)

    const onMove = (event) => {
      const el = event.target instanceof Element ? event.target : null
      if (el == null || el === box || el === tip) return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        box.style.display = 'none'
        tip.style.display = 'none'
        return
      }
      box.style.display = 'block'
      box.style.left = rect.left + 'px'
      box.style.top = rect.top + 'px'
      box.style.width = rect.width + 'px'
      box.style.height = rect.height + 'px'
      const label =
        el.tagName.toLowerCase() +
        (el.id ? '#' + el.id : '') +
        (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\\s+/)[0]
          : '')
      tip.style.display = 'block'
      tip.textContent = label
      tip.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 200)) + 'px'
      tip.style.top = Math.max(4, rect.top - 20) + 'px'
    }
    const onClick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const el = event.target instanceof Element ? event.target : null
      finish(el != null ? describe(el) : null)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(null)
      }
    }

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
  })
})()`

/** 宿主侧取消拾取（切 tab / 关开关 / 导航前调用）。 */
export const ELEMENT_PICKER_CANCEL_SCRIPT = `(() => {
  if (typeof window.__sparkPickerCancel === 'function') window.__sparkPickerCancel()
  return null
})()`

/** 拾取脚本回传的元素信息（页面侧 describe() 的结构）。 */
export interface ElementPickInfo {
  tag: string
  id: string | null
  name: string | null
  role: string | null
  ariaLabel: string | null
  inputType: string | null
  classes: string[]
  text: string | null
  href: string | null
  selector: string
  rect: { x: number; y: number; width: number; height: number }
  pageUrl: string
}

/** 浏览器内选中元素的引用（输入框 chip 展示 + 发送时序列化为定位文本块）。 */
export interface BrowserElementReference {
  id: string
  label: string
  tag: string
  id_attr: string | null
  classes: string[]
  text: string | null
  href: string | null
  selector: string
  pageUrl: string
  capturedAt: number
}

/**
 * 把拾取结果转成会话输入框的引用对象（label 供 chip 展示，其余字段发送时
 * 经 formatBrowserReferenceLine 序列化为 agent 可定位的文本块）。
 */
export function buildElementReference(info: ElementPickInfo): BrowserElementReference {
  const classes = (info.classes ?? []).slice(0, 3)
  const text = info.text?.replace(/\s+/g, ' ').trim() ?? ''
  let label = info.tag
  if (info.id != null && info.id !== '') label += `#${info.id}`
  else if (classes.length > 0) label += `.${classes[0]}`
  if (text !== '') {
    const clipped = text.length > 16 ? `${text.slice(0, 16)}…` : text
    label += `「${clipped}」`
  }
  return {
    id: `browser-ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    tag: info.tag,
    id_attr: info.id,
    classes,
    text: text !== '' ? text : null,
    href: info.href,
    selector: info.selector,
    pageUrl: info.pageUrl,
    capturedAt: Date.now(),
  }
}
