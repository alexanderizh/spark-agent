/**
 * 开源可见性总开关：项目暂时转为闭源，官网所有指向源码仓库的开源入口
 * （导航/页脚 GitHub、/open-source、联系页反馈卡片、文档 GitHub 源链、
 * 下载「历史版本」GitHub Releases 入口、SEO codeRepository）均以此开关控制。
 * 恢复开源时改回 true 即可整体还原（个别文案与 sitemap/llms 静态文件需手动找回）。
 */
export const OPEN_SOURCE_ENABLED = false

export const GITHUB_URL = 'https://github.com/alexanderizh/spark-agent'
export const RELEASES_URL = `${GITHUB_URL}/releases`
/**
 * 自建版本中心的 API 基地址，浏览器侧（lib/releases.ts）会优先读这个值，
 * 留空时回退到 window.location.origin。同样的变量也供构建期 scripts/fetch-downloads.mjs 使用。
 */
export const RELEASES_API_BASE = (
  (import.meta.env.VITE_RELEASES_API_BASE as string | undefined) || ''
).replace(/\/$/, '')
export const ISSUES_URL = `${GITHUB_URL}/issues`
export const DISCUSSIONS_URL = `${GITHUB_URL}/discussions`
export const SITE_URL = 'https://spark-agent.dev'
/** 联系邮箱（与桌面端「联系我们」一致） */
export const CONTACT_EMAIL = 'open@yiqibyte.com'
/** QQ 开发讨论群加群链接（也是二维码扫码值） */
export const QQ_GROUP_URL = 'https://qm.qq.com/q/diT40hGAyQ'
/** QQ 开发讨论群群号 */
export const QQ_GROUP_NO = '1041461465'
export const SECURITY_CONTACT_URL = `${GITHUB_URL}/security/advisories/new`
export const README_URL = `${GITHUB_URL}#readme`
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`
/** 仓库内 docs/ 目录（与官网文档互补；官网文档面向用户，仓库 docs 面向开发者） */
export const REPO_DOCS_URL = `${GITHUB_URL}/tree/main/docs`
