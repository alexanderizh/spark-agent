import type { ReactNode } from 'react'
import { navigate } from '../lib/router'

// 任意「非站内相对路径」协议都走原生 <a>：
//   - http(s) / mailto / tel       → 跨域或外部应用
//   - data: / blob:                → 浏览器内联内容，客户端路由接管没意义
//   - javascript: / vbscript:      → JS 协议，强制原生行为避免 navigate('javascript:...') 改写 URL
//   - 协议相对 //host/...          → 走原生，让浏览器按当前 scheme 解析
const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/**
 * 站内导航的客户端路由 Link —— 不触发整页刷新。
 *
 * 行为：
 *   - 同源站内路径 → navigate(to) 走客户端路由
 *   - 跨域 / 协议相对 / 任何带 scheme 的 href → 退化到原生 <a>
 *   - href 有 download / target=_blank / modifier 键 → 也退化
 */
export function Link({
  href,
  children,
  className,
  target,
  rel,
  onClick,
}: {
  href: string
  children: ReactNode
  className?: string
  target?: string
  rel?: string
  onClick?: (e: React.MouseEvent) => void
}) {
  const isExternal = EXTERNAL_HREF.test(href)
  if (isExternal || target === '_blank') {
    return (
      <a href={href} target={target ?? '_blank'} rel={rel ?? 'noreferrer'} className={className} onClick={onClick}>
        {children}
      </a>
    )
  }
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (onClick) onClick(e)
        if (e.defaultPrevented) return
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        navigate(href)
      }}
    >
      {children}
    </a>
  )
}