import type { SDKMcpServerConfig } from '../../sdk/index.js'
import { BROWSER_TOOL_NAMES } from '../browser-automation-prompt.js'
import {
  DEBUG_TOOL_NAMES,
  PLATFORM_TOOL_NAMES,
  PRESENT_FILES_TOOL_NAMES,
  QUICK_REPLIES_TOOL_NAMES,
  RENDER_DIAGRAM_TOOL_NAMES,
  RENDER_HTML_TOOL_NAMES,
  SEARCH_TOOL_NAMES,
  SUB_APP_TOOL_NAMES,
  TOOL_RESULT_TOOL_NAMES,
} from '../session-mcp-tooling-helpers.js'
import { SPARK_MEDIA_TOOL_NAMES } from '../media/media-mcp-contract.js'

export interface SparkEngineMcpSources {
  readonly customServers: Readonly<Record<string, SDKMcpServerConfig>>
  readonly imageServer?: SDKMcpServerConfig
  readonly mediaServer?: SDKMcpServerConfig
  readonly teamServer?: SDKMcpServerConfig
  readonly teamToolNames?: readonly string[]
  readonly platformServer?: SDKMcpServerConfig
  readonly pluginServer?: SDKMcpServerConfig
  readonly pluginToolNames?: readonly string[]
  readonly searchServer?: SDKMcpServerConfig
  readonly subAppServer?: SDKMcpServerConfig
  readonly filesServer?: SDKMcpServerConfig
  readonly uiServer?: SDKMcpServerConfig
  readonly browserServer?: SDKMcpServerConfig
  readonly computerServer?: SDKMcpServerConfig
  readonly computerToolNames?: readonly string[]
  readonly debugServer?: SDKMcpServerConfig
  readonly memoryServer?: SDKMcpServerConfig
  readonly sessionServer?: SDKMcpServerConfig
  readonly toolResultServer?: SDKMcpServerConfig
}

export interface SparkEngineMcpRuntime {
  readonly servers: Record<string, SDKMcpServerConfig>
  /** Built-in host tools that should not wait for a second interactive approval. */
  readonly allowedTools: readonly string[]
}

const SPARK_BUILTIN_SERVER_NAMES = new Set([
  'spark_image',
  'spark_media',
  'spark_team',
  'spark_platform',
  'spark_plugins',
  'spark_search',
  'spark_app',
  'spark_files',
  'spark_ui',
  'spark_browser',
  'spark_computer',
  'spark_debug',
  'spark_memory',
  'spark_session',
  'spark_tool_results',
])

/**
 * Converts the host's richer MCP catalog into the transports Spark supports.
 * Spark consumes stdio and Streamable HTTP; legacy SSE and in-process SDK
 * servers are intentionally skipped instead of making the whole turn fail.
 */
export function buildSparkEngineMcpRuntime(sources: SparkEngineMcpSources): SparkEngineMcpRuntime {
  const servers: Record<string, SDKMcpServerConfig> = {}
  const allowedTools: string[] = []

  for (const [name, server] of Object.entries(sources.customServers)) {
    if (SPARK_BUILTIN_SERVER_NAMES.has(name)) continue
    addServer(servers, name, server)
  }

  addBuiltin(servers, allowedTools, 'spark_image', sources.imageServer, [
    'mcp__spark_image__generate_image',
  ])
  addBuiltin(servers, allowedTools, 'spark_media', sources.mediaServer, SPARK_MEDIA_TOOL_NAMES)
  addBuiltin(servers, allowedTools, 'spark_team', sources.teamServer, sources.teamToolNames)
  addBuiltin(servers, allowedTools, 'spark_platform', sources.platformServer, PLATFORM_TOOL_NAMES)
  addBuiltin(servers, allowedTools, 'spark_plugins', sources.pluginServer, sources.pluginToolNames)
  addBuiltin(servers, allowedTools, 'spark_search', sources.searchServer, SEARCH_TOOL_NAMES)
  addBuiltin(servers, allowedTools, 'spark_app', sources.subAppServer, SUB_APP_TOOL_NAMES)
  addBuiltin(servers, allowedTools, 'spark_files', sources.filesServer, PRESENT_FILES_TOOL_NAMES)
  addBuiltin(servers, allowedTools, 'spark_ui', sources.uiServer, [
    ...QUICK_REPLIES_TOOL_NAMES,
    ...RENDER_HTML_TOOL_NAMES,
    ...RENDER_DIAGRAM_TOOL_NAMES,
  ])
  addBuiltin(servers, allowedTools, 'spark_browser', sources.browserServer, BROWSER_TOOL_NAMES)
  addBuiltin(
    servers,
    allowedTools,
    'spark_computer',
    sources.computerServer,
    sources.computerToolNames,
  )
  addBuiltin(servers, allowedTools, 'spark_debug', sources.debugServer, DEBUG_TOOL_NAMES)
  addBuiltin(servers, allowedTools, 'spark_memory', sources.memoryServer, [
    'mcp__spark_memory__search_memory',
    'mcp__spark_memory__recall_memory',
  ])
  addBuiltin(servers, allowedTools, 'spark_session', sources.sessionServer, [
    'mcp__spark_session__set_worktree_state',
  ])
  addBuiltin(
    servers,
    allowedTools,
    'spark_tool_results',
    sources.toolResultServer,
    TOOL_RESULT_TOOL_NAMES,
  )

  return { servers, allowedTools: [...new Set(allowedTools)] }
}

function addBuiltin(
  servers: Record<string, SDKMcpServerConfig>,
  allowedTools: string[],
  name: string,
  server: SDKMcpServerConfig | undefined,
  toolNames: readonly string[] | undefined,
): void {
  if (!addServer(servers, name, server)) return
  if (toolNames !== undefined) allowedTools.push(...toolNames)
}

function addServer(
  servers: Record<string, SDKMcpServerConfig>,
  name: string,
  server: SDKMcpServerConfig | undefined,
): boolean {
  if (server === undefined || !isValidSparkServerName(name) || !isSparkSupportedMcpServer(server))
    return false
  servers[name] = server
  return true
}

function isValidSparkServerName(value: string): boolean {
  return value.length > 0 && value.length <= 96 && /^[A-Za-z0-9._:-]+$/u.test(value)
}

function isSparkSupportedMcpServer(server: SDKMcpServerConfig): boolean {
  if (server.type === 'sse' || server.type === 'sdk') return false
  if (server.type === 'http') return typeof server.url === 'string' && server.url.trim().length > 0
  return typeof server.command === 'string' && server.command.trim().length > 0
}
