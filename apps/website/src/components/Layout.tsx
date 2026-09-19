import { useCallback, useEffect, useState } from 'react'
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
import { GITHUB_URL, OPEN_SOURCE_ENABLED } from '../lib/links'
import {
  DOCS_SEARCH_OPEN_EVENT,
  DocsSearchDrawerEntry,
  DocsSearchOverlay,
  DocsSearchTrigger,
  useDocsSearchHotkeys,
} from './DocsSearchCommand'
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

const visibleNav = nav.filter((item) => !item.hidden)

export function Layout({
  children,
  currentPath = '/',
}: {
  children: React.ReactNode
  currentPath?: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const toggleSearch = useCallback(() => setSearchOpen((prev) => !prev), [])
  useDocsSearchHotkeys(toggleSearch)

  // 文档页内的「搜索文档」入口通过全局事件唤起同一个面板
  useEffect(() => {
    const onOpen = () => setSearchOpen(true)
    window.addEventListener(DOCS_SEARCH_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(DOCS_SEARCH_OPEN_EVENT, onOpen)
  }, [])

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
          <Logo size={34} className="brand-mark" title="Spark Work 首页" />
          <span>Spark Work</span>
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
        </nav>
        <div className="nav-actions">
          <DocsSearchTrigger onOpen={() => setSearchOpen(true)} />
          <ThemeToggle />
          {OPEN_SOURCE_ENABLED && (
            <a className="nav-github" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GithubIcon size={15} />
              <span>GitHub</span>
            </a>
          )}
        </div>
        <button
          type="button"
          className="nav-toggle"
          aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={menuOpen}
          aria-controls="primary-nav-drawer"
          onClick={() => setMenuOpen((v) => !v)}
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
          <DocsSearchDrawerEntry
            onOpen={() => {
              setMenuOpen(false)
              setSearchOpen(true)
            }}
          />
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
            {OPEN_SOURCE_ENABLED && (
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
            )}
          </div>
        </div>
      </div>
      <main>{children}</main>
      <Footer />
      {searchOpen && <DocsSearchOverlay onClose={() => setSearchOpen(false)} />}
    </>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        <a className="brand" href="/">
          <Logo size={30} className="brand-mark" title="Spark Work 首页" />
          <span>Spark Work</span>
        </a>
        <p>本地优先的 AI Agent 工作台，覆盖代码开发、团队协作、运行时治理和无限画布创作。</p>
      </div>
      <div className="footer-links">
        <a href="/docs">使用文档</a>
        <a href="/download">下载</a>
        {OPEN_SOURCE_ENABLED && <a href="/open-source">开源</a>}
        <a href="/llms.txt">llms.txt</a>
        <a href="/sitemap.xml">Sitemap</a>
        {OPEN_SOURCE_ENABLED && (
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        )}
      </div>
    </footer>
  )
}
