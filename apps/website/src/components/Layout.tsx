import {
  BookOpen,
  Code2,
  Download,
  GitBranch,
  LayoutDashboard,
  Map,
  MessageCircle,
  Network,
  PanelRight,
  type LucideIcon,
} from 'lucide-react'
import { GITHUB_URL } from '../lib/links'
import { Logo } from './Logo'

const nav = [
  { label: '功能', href: '/features', icon: Code2 },
  { label: '画布', href: '/canvas', icon: LayoutDashboard },
  { label: '架构', href: '/architecture', icon: Network },
  { label: '下载', href: '/download', icon: Download },
  { label: '文档', href: '/docs', icon: BookOpen },
  { label: '路线图', href: '/roadmap', icon: Map },
  { label: '开源', href: '/open-source', icon: GitBranch },
  { label: '联系', href: '/contact', icon: MessageCircle },
] satisfies Array<{ label: string; href: string; icon: LucideIcon }>

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="nav">
        <a className="brand" href="/">
          <Logo size={34} className="brand-mark" title="Spark Agent 首页" />
          <span>Spark Agent</span>
        </a>
        <nav>
          {nav.map(({ label, href, icon: Icon }) => (
            <a key={href} href={href}>
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
          <a className="nav-github" href={GITHUB_URL}>
            <PanelRight size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>GitHub</span>
          </a>
        </nav>
      </header>
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
        <a href="/llms.txt">llms.txt</a>
        <a href="/llms-full.txt">llms-full.txt</a>
        <a href="/sitemap.xml">Sitemap</a>
        <a href={GITHUB_URL}>GitHub</a>
      </div>
    </footer>
  )
}
