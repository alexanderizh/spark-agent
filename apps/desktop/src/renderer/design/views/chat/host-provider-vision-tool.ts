export const HOST_PROVIDER_VISION_TOOL_NAME = 'spark_host_provider_vision'

export function isHostProviderVisionTool(toolName: string): boolean {
  return toolName === HOST_PROVIDER_VISION_TOOL_NAME
}

/** event-mapper 会把结构化工具输出包装成 Markdown JSON 代码块。 */
export function parseHostProviderVisionOutput(output: string | undefined): Record<string, unknown> {
  if (output == null) return {}
  const fenced = output.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/iu)
  const source = fenced?.[1] ?? output
  try {
    const value = JSON.parse(source) as unknown
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
