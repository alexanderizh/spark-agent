import { DownloadPanel } from '../components/DownloadPanel'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
export function DownloadPage() {
  return (
    <>
      <Seo
        seo={{
          title: '下载 Spark Agent - 跨平台 AI 桌面应用',
          description:
            '下载 Spark Agent macOS、Windows、Linux 版本。页面会自动识别系统并推荐版本中心直链。',
          path: '/download',
          keywords: [
            'Spark Agent 下载',
            'AI 桌面应用下载',
            '跨平台 AI 工具',
            'macOS AI',
            'Windows AI',
            'Linux AI',
          ],
        }}
      />
      <Section
        eyebrow="Download"
        title="跨平台下载"
        intro="自动识别你的系统并高亮推荐版本；优先使用版本中心返回的安装包直链。"
      >
        <DownloadPanel />
      </Section>
      <Section title="安装提示">
        <div className="grid cards">
          <article className="card">
            <h3>macOS</h3>
            <p>下载 DMG 后拖入 Applications。如遇安全提示，请在系统设置中允许打开。</p>
          </article>
          <article className="card">
            <h3>Windows</h3>
            <p>建议使用 Windows 10/11 x64，并从版本中心获取正式安装包。</p>
          </article>
          <article className="card">
            <h3>Linux</h3>
            <p>AppImage 可能需要添加执行权限；deb/rpm 以 Release 产物为准。</p>
          </article>
        </div>
      </Section>
    </>
  )
}
