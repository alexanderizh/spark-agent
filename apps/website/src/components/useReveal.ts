import { useEffect } from 'react'

// 滚动入场：进入视口加 .is-revealed。
// 仅当 JS 运行时才给 <html> 加 .reveal-ready 启用初始隐藏态，避免无 JS / JS 报错时内容空白。
const REVEAL_SEL =
  '.section, .card, .workflow-step, .timeline-item, .arch-node, .showcase-card, .faq details'

// routeKey 变化（切页）时重新观察当前页面的元素，
// 否则客户端切页会让新页面元素停留在 opacity:0 的隐藏态。
//
// 同时用 MutationObserver 监听 <body> 子树，给后续动态插入的 .card 等元素加 reveal ——
// 否则同页内部状态变化（筛选 chip / 搜索框 / 折叠面板）会让新出现的卡片停留在隐藏态。
//
// 对动态插入的元素直接加 .is-revealed（不走 IntersectionObserver 动画）：
// 这些是用户交互触发的新内容，需要立即可见；如果走 IO 动画，
// 不在初始视口内的元素要等用户滚动才 reveal，会有明显延迟。
export function useReveal(routeKey?: unknown) {
  useEffect(() => {
    const root = document.documentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const root2 = document.body

    root.classList.add('reveal-ready')

    // 降级：无 IntersectionObserver / 用户要求减少动画 / 或者标记 skip-anim 的元素 → 立即显示
    const revealNow = (el: Element) => {
      ;(el as HTMLElement).classList.add('is-revealed')
    }
    const handleNew = (el: Element) => {
      if (reduce || !('IntersectionObserver' in window)) {
        revealNow(el)
      } else {
        revealNow(el)
      }
    }

    // 处理单个 ElementNode，匹配 REVEAL_SEL 才处理
    const processNode = (n: Node) => {
      if (n.nodeType !== Node.ELEMENT_NODE) return
      const el = n as Element
      if ((el as HTMLElement).matches?.(REVEAL_SEL)) handleNew(el)
      el.querySelectorAll?.(REVEAL_SEL).forEach(handleNew)
    }

    // 立即观察当前已有的元素（routeKey 变化时这些是新页面的元素）
    // 走 IntersectionObserver 做入场动画
    if (!reduce && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-revealed')
              io.unobserve(entry.target)
            }
          })
        },
        { threshold: 0, rootMargin: '0px 0px -5% 0px' },
      )
      root2.querySelectorAll<HTMLElement>(REVEAL_SEL).forEach((el) => io.observe(el))
      // routeKey 变化时 disconnect（effect cleanup 会跑）
      // 监听后续动态插入
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          m.addedNodes.forEach(processNode)
        }
      })
      mo.observe(root2, { childList: true, subtree: true })
      return () => {
        io.disconnect()
        mo.disconnect()
      }
    }

    // 降级路径：全部直接显示
    root2.querySelectorAll<HTMLElement>(REVEAL_SEL).forEach(revealNow)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach(processNode)
    })
    mo.observe(root2, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [routeKey])
}
