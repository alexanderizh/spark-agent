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
export const SECURITY_CONTACT_URL = `${GITHUB_URL}/security/advisories/new`
export const README_URL = `${GITHUB_URL}#readme`
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`
/** 仓库内 docs/ 目录（与官网文档互补；官网文档面向用户，仓库 docs 面向开发者） */
export const REPO_DOCS_URL = `${GITHUB_URL}/tree/main/docs`
