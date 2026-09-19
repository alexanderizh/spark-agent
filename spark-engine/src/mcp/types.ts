export interface SparkMcpStdioServerConfig {
  readonly type?: 'stdio'
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
}

export interface SparkMcpHttpServerConfig {
  readonly type: 'http'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

export type SparkMcpServerConfig = SparkMcpStdioServerConfig | SparkMcpHttpServerConfig

export type SparkMcpServerMap = Readonly<Record<string, SparkMcpServerConfig>>

export type SparkMcpConnectionStatus = 'connected' | 'failed'

export interface SparkMcpServerStatus {
  readonly name: string
  readonly runtimeStatus: SparkMcpConnectionStatus
  /** Discovered tool count; 0 when discovery failed. */
  readonly toolCount: number
  /**
   * Tool-discovery failure reason (mirrors Codex app-server McpServerStatus.
   * toolsError): non-empty when the transport connected but tools/list failed,
   * null when a tool catalog — including an empty one — was returned.
   */
  readonly toolsError: string | null
}
