import type { SDKMcpServerConfig } from '../sdk/index.js'

export const TOOL_RESULT_READER_SERVER_NAME = 'spark_tool_results'

export type ToolResultMcpGovernanceOptions = {
  workspaceRootPath: string
  nodeExecutable: string | null
  proxyServerPath: string | null
  readerServer: SDKMcpServerConfig | null
}

/**
 * Wrap stdio MCP servers in Spark's transparent result governor while leaving
 * SDK/HTTP/SSE transports untouched. Server names stay stable, so the model's
 * existing `mcp__<server>__<tool>` namespace and permission rules do not change.
 */
export function governMcpServers(
  source: Record<string, SDKMcpServerConfig>,
  options: ToolResultMcpGovernanceOptions,
): Record<string, SDKMcpServerConfig> {
  const governed: Record<string, SDKMcpServerConfig> = {}
  const nodeExecutable = options.nodeExecutable
  const proxyServerPath = options.proxyServerPath

  for (const [serverName, server] of Object.entries(source)) {
    governed[serverName] =
      nodeExecutable != null && proxyServerPath != null && shouldWrapStdioServer(serverName, server)
        ? createProxyConfig(
            serverName,
            server,
            options.workspaceRootPath,
            nodeExecutable,
            proxyServerPath,
          )
        : server
  }

  if (options.readerServer != null) {
    governed[TOOL_RESULT_READER_SERVER_NAME] = options.readerServer
  }
  return governed
}

function shouldWrapStdioServer(serverName: string, server: SDKMcpServerConfig): boolean {
  if (serverName === TOOL_RESULT_READER_SERVER_NAME) return false
  if (server.env?.SPARK_TOOL_RESULT_PROXY_VERSION === '1') return false
  if (typeof server.command !== 'string' || server.command.length === 0) return false
  if (
    server.url != null ||
    server.type === 'sdk' ||
    server.type === 'http' ||
    server.type === 'sse'
  ) {
    return false
  }
  return server.type == null || server.type === 'stdio'
}

function createProxyConfig(
  serverName: string,
  upstream: SDKMcpServerConfig,
  workspaceRootPath: string,
  nodeExecutable: string,
  proxyServerPath: string,
): SDKMcpServerConfig {
  const upstreamConfig = {
    type: 'stdio',
    command: upstream.command,
    ...(upstream.args != null ? { args: upstream.args } : {}),
    ...(upstream.env != null ? { env: upstream.env } : {}),
    ...(upstream.cwd != null ? { cwd: upstream.cwd } : {}),
  }
  const encodedUpstreamConfig = Buffer.from(JSON.stringify(upstreamConfig), 'utf8').toString(
    'base64url',
  )

  return {
    type: 'stdio',
    command: nodeExecutable,
    args: [proxyServerPath],
    ...(upstream.cwd != null ? { cwd: upstream.cwd } : {}),
    env: {
      SPARK_WORKSPACE_ROOT: workspaceRootPath,
      SPARK_TOOL_RESULT_SERVER_NAME: serverName,
      SPARK_TOOL_RESULT_UPSTREAM_CONFIG: encodedUpstreamConfig,
      SPARK_TOOL_RESULT_PROXY_VERSION: '1',
    },
  }
}
