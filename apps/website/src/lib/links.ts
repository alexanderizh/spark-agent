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
export const REPO_DOCS_URL = `${GITHUB_URL}/tree/main/docs`
export const SECURITY_CONTACT_URL = `${GITHUB_URL}/security/advisories/new`
export const README_URL = `${GITHUB_URL}#readme`
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`

export const docLinks = {
  desktopGuide: `${GITHUB_URL}/blob/main/docs/desktop-agent-development-guide.md`,
  agentsWorkflows: `${GITHUB_URL}/blob/main/docs/agents-workflows.md`,
  teamMode: `${GITHUB_URL}/blob/main/docs/%E5%9B%A2%E9%98%9F%E6%A8%A1%E5%BC%8F%E5%BC%80%E5%8F%91.md`,
  canvasMvp: `${GITHUB_URL}/blob/main/docs/ai-infinite-canvas-mvp.md`,
  mediaProviders: `${GITHUB_URL}/blob/main/docs/multimedia-model-providers.md`,
  webSearch: `${GITHUB_URL}/blob/main/docs/builtin-web-search.md`,
  browserAutomation: `${GITHUB_URL}/blob/main/docs/skills/browser-automation.md`,
  remoteConnections: `${GITHUB_URL}/blob/main/docs/remote-connections.md`,
  autoUpdate: `${GITHUB_URL}/blob/main/docs/github-release-auto-update.md`,
  imageProviders: `${GITHUB_URL}/blob/main/docs/image-generation-providers.md`,
  installableSkills: `${GITHUB_URL}/blob/main/docs/builtin-installable-skills.md`,
}
