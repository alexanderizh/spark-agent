import agentsWorkflows from './docs-pages/agents-workflows'
import autoUpdate from './docs-pages/auto-update'
import boardView from './docs-pages/board-view'
import browserAutomation from './docs-pages/browser-automation'
import builtinTools from './docs-pages/builtin-tools'
import canvasMvp from './docs-pages/canvas-mvp'
import canvasVideoWorkbench from './docs-pages/canvas-video-workbench'
import codeDevelopment from './docs-pages/code-development'
import connectors from './docs-pages/connectors'
import computerUse from './docs-pages/computer-use'
import credentialsAndSecrets from './docs-pages/credentials-and-secrets'
import dataAndBackup from './docs-pages/data-and-backup'
import customTools from './docs-pages/custom-tools'
import desktopGuide from './docs-pages/desktop-guide'
import governance from './docs-pages/governance'
import hooksV2 from './docs-pages/hooks-v2'
import imageProviders from './docs-pages/image-providers'
import longTermMemory from './docs-pages/long-term-memory'
import mcpSkills from './docs-pages/mcp-skills'
import mediaProviders from './docs-pages/media-providers'
import optionalCapabilities from './docs-pages/optional-capabilities'
import quickStart from './docs-pages/quick-start'
import remoteConnections from './docs-pages/remote-connections'
import sessionFlow from './docs-pages/session-flow'
import sessionScheduledTasks from './docs-pages/session-scheduled-tasks'
import sparkCli from './docs-pages/spark-cli'
import subApps from './docs-pages/sub-apps'
import teamMode from './docs-pages/team-mode'
import webSearch from './docs-pages/web-search'
import workflowUsage from './docs-pages/workflow-usage'
import type { DocsPageContent } from './docs-pages/_shared'

/**
 * 文档正文的同步注册表。
 *
 * 官网会在构建期预渲染全部公开文档，因此正文必须能在服务端首轮 render 时取得。
 * 客户端仍由 Vite 对共享依赖做拆包，不再以“先渲染空壳、挂载后再请求正文”为代价。
 */
export const docsPageRegistry: Readonly<Record<string, DocsPageContent>> = {
  'quick-start': quickStart,
  'code-development': codeDevelopment,
  'agents-workflows': agentsWorkflows,
  'team-mode': teamMode,
  'canvas-mvp': canvasMvp,
  'media-providers': mediaProviders,
  'image-providers': imageProviders,
  'web-search': webSearch,
  'browser-automation': browserAutomation,
  'remote-connections': remoteConnections,
  'auto-update': autoUpdate,
  'mcp-skills': mcpSkills,
  governance,
  'hooks-v2': hooksV2,
  'desktop-guide': desktopGuide,
  'builtin-tools': builtinTools,
  'workflow-usage': workflowUsage,
  'custom-tools': customTools,
  'credentials-and-secrets': credentialsAndSecrets,
  connectors,
  'computer-use': computerUse,
  'sub-apps': subApps,
  'board-view': boardView,
  'long-term-memory': longTermMemory,
  'session-flow': sessionFlow,
  'session-scheduled-tasks': sessionScheduledTasks,
  'canvas-video-workbench': canvasVideoWorkbench,
  'optional-capabilities': optionalCapabilities,
  'data-and-backup': dataAndBackup,
  'spark-cli': sparkCli,
}

export function getDocsPageContent(slug: string): DocsPageContent | undefined {
  return docsPageRegistry[slug]
}
