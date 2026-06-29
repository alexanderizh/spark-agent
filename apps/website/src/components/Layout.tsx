import { useEffect, useState } from 'react'
import {
  BookOpen,
  Code2,
  Download,
  Home,
  Menu,
  Network,
  Spline,
  MessageCircle,
  X,
  type LucideIcon,
} from 'lucide-react'
import { GITHUB_URL } from '../lib/links'
import { GithubIcon } from './GithubIcon'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'

const nav = [
  { label: '首页', href: '/', icon: Home },
  { label: '功能', href: '/features', icon: Code2 },
  { label: '画布', href: '/canvas', icon: Spline },
  { label: '架构', href: '/architecture', icon: Network, hidden: true },
  { label: '下载', href: '/download', icon: Download },
  { label: '文档', href: '/docs', icon: BookOpen },
  { label: '联系', href: '/contact', icon: MessageCircle },
] satisfies Array<{ label: string; href: string; icon: LucideIcon; hidden?: boolean }>

const visibleNav = nav.filter(item => !item.hidden)

export function Layout({ children, currentPath = '/' }: { children: React.ReactNode; currentPath?: string }) {
  const [menuOpen, setMenuOpen] = useState(false)

  // 路由变化时自动收起抽屉
  useEffect(() => {
    setMenuOpen(false)
  }, [currentPath])

  // 打开时锁滚动 + Esc 关闭
  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <>
      <header className={`nav${menuOpen ? ' is-menu-open' : ''}`}>
        <a className="brand" href="/">
          <Logo size={34} className="brand-mark" title="Spark Agent 首页" />
          <span>Spark Agent</span>
        </a>
        <nav>
          {visibleNav.map(({ label, href, icon: Icon }) => {
            const active = href === currentPath
            return (
              <a
                key={href}
                href={href}
                className={active ? 'nav-link is-active' : 'nav-link'}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
              </a>
            )
          })}
          <ThemeToggle />
          <a className="nav-github" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <GithubIcon size={15} />
            <span>GitHub</span>
          </a>
        </nav>
        <button
          type="button"
          className="nav-toggle"
          aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={menuOpen}
          aria-controls="primary-nav-drawer"
          onClick={() => setMenuOpen(v => !v)}
        >
          {menuOpen ? <X size={20} strokeWidth={1.8} /> : <Menu size={20} strokeWidth={1.8} />}
        </button>
      </header>
      <div
        id="primary-nav-drawer"
        className={`nav-drawer${menuOpen ? ' is-open' : ''}`}
        aria-hidden={!menuOpen}
      >
        <div className="nav-drawer-inner">
          {visibleNav.map(({ label, href, icon: Icon }) => {
            const active = href === currentPath
            return (
              <a
                key={href}
                href={href}
                className={active ? 'nav-drawer-link is-active' : 'nav-drawer-link'}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
              </a>
            )
          })}
          <div className="nav-drawer-row">
            <ThemeToggle />
            <a
              className="nav-drawer-github"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              <GithubIcon size={16} />
              <span>GitHub</span>
            </a>
          </div>
        </div>
      </div>
      <main>{children}</main>
      <Footer />
    </>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        <a className="brand" href="/">
          <Logo size={30} className="brand-mark" title="Spark Agent 首页" />
          <span>Spark Agent</span>
        </a>
        <p>本地优先的 AI Agent 工作台，覆盖代码开发、团队协作、运行时治理和无限画布创作。</p>
      </div>
      <div className="footer-links">
        <a href="/docs">使用文档</a>
        <a href="/download">下载</a>
        <a href="/open-source">开源</a>
        <a href="/llms.txt">llms.txt</a>
        <a href="/sitemap.xml">Sitemap</a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
    </footer>
  )
}