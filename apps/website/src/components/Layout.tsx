import { GITHUB_URL } from '../lib/links'

const nav = [
  ['功能', '/features'],
  ['无限画布', '/canvas'],
  ['架构', '/architecture'],
  ['下载', '/download'],
  ['文档', '/docs'],
  ['路线图', '/roadmap'],
  ['开源', '/open-source'],
  ['联系', '/contact'],
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="nav">
        <a className="brand" href="/">
          <span className="brand-mark">⚡</span>Spark Agent
        </a>
        <nav>
          {nav.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
          <a className="nav-github" href={GITHUB_URL}>
            GitHub
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
        <b>Spark Agent</b>
        <p>本地优先的 AI 内容创作工作台。</p>
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
