import { useEffect } from 'react'

// 滚动入场：进入视口加 .is-revealed。
// 仅当 JS 运行时才给 <html> 加 .reveal-ready 启用初始隐藏态，避免无 JS / JS 报错时内容空白。
const REVEAL_SEL =
  '.section, .card, .workflow-step, .timeline-item, .arch-node, .showcase-card, .faq details'

// routeKey 变化（切页）时重新观察当前页面的元素，
// 否则客户端切页会让新页面元素停留在 opacity:0 的隐藏态。
export function useReveal(routeKey?: unknown) {
  useEffect(() => {
    const root = document.documentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const els = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SEL))

    root.classList.add('reveal-ready')

    // 降级：无 IntersectionObserver 或用户要求减少动画 → 全部直接显示
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-revealed'))
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed')
            io.unobserve(entry.target)
          }
        })
      },
      // 阈值放宽到任意像素可见即触发，避免折叠 <details> 等小高度元素因阈值过高漏显。
      { threshold: 0, rootMargin: '0px 0px -5% 0px' },
    )

    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [routeKey])
}
