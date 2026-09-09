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
