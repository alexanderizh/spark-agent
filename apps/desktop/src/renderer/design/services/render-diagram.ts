import {
  DEFAULT_DIAGRAM_RENDER_HEIGHT,
  DIAGRAM_RENDER_TYPES,
  MAX_DIAGRAM_RENDER_HEIGHT,
  MAX_DIAGRAM_RENDER_TITLE_LENGTH,
  MIN_DIAGRAM_RENDER_HEIGHT,
  type DiagramRenderType,
} from '@spark/shared'

export const RENDER_DIAGRAM_TOOL_NAME = 'mcp__spark_ui__render_diagram'

/** tool_use 阶段解析得到的渲染输入（type 已归一，含 alias 处理） */
export type RenderDiagramInput = {
  diagramType: DiagramRenderType
  source: string
  title: string
  height: number
}

/** tool_result 阶段从 MCP server normalize 输出解析 */
export type RenderDiagramResult = {
  accepted: boolean
  type?: DiagramRenderType
  source?: string
  title?: string
  height?: number
  warnings?: string[]
  reason?: string
}

const DIAGRAM_TYPE_ALIASES: Record<string, DiagramRenderType> = {
  mindmap: 'markmap',
}

/** 把模型可能给出的 type（含大小写、mindmap 别名）归一为 markmap | mermaid，非法返回 null */
export function normalizeDiagramType(value: unknown): DiagramRenderType | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase()
  const aliased = DIAGRAM_TYPE_ALIASES[key] ?? key
  return (DIAGRAM_RENDER_TYPES as readonly string[]).includes(aliased)
    ? (aliased as DiagramRenderType)
    : null
}

export function isRenderDiagramTool(toolName: string): boolean {
  return toolName.trim().toLowerCase() === RENDER_DIAGRAM_TOOL_NAME
}

function defaultDiagramTitle(diagramType: DiagramRenderType): string {
  return diagramType === 'markmap' ? '思维导图' : '图表'
}

/**
 * 解析 tool_use 阶段的原始 arguments（未经 MCP server 校验）。
 * 任一关键字段非法时返回 null，由调用方决定是否仍展示一个占位 block。
 */
export function parseRenderDiagramInput(input: unknown): RenderDiagramInput | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const diagramType = normalizeDiagramType(record.type)
  if (diagramType == null) return null
  const source = typeof record.source === 'string' ? record.source : ''
  if (source.trim().length === 0) return null
  const rawTitle = typeof record.title === 'string' ? record.title.trim() : ''
  const title = (rawTitle.slice(0, MAX_DIAGRAM_RENDER_TITLE_LENGTH) || defaultDiagramTitle(diagramType))
  const rawHeight = typeof record.height === 'number' ? record.height : DEFAULT_DIAGRAM_RENDER_HEIGHT
  const height = Number.isInteger(rawHeight)
    ? Math.min(MAX_DIAGRAM_RENDER_HEIGHT, Math.max(MIN_DIAGRAM_RENDER_HEIGHT, rawHeight))
    : DEFAULT_DIAGRAM_RENDER_HEIGHT
  // tool_use 阶段不对 source 长度做硬截断（保留原文给源码视图）；
  // 超长 source 由 MCP server 在 tool_result 阶段以 accepted:false 拒绝并转 error 态。
  return {
    diagramType,
    source,
    title,
    height,
  }
}

/** 从 tool_result 输出（MCP server 返回的 normalize 对象，可能层层包裹）中提取结果 */
export function parseRenderDiagramResult(output: unknown): RenderDiagramResult | null {
  const candidates: unknown[] = [output]
  for (let index = 0; index < candidates.length && index < 12; index += 1) {
    let candidate = candidates[index]
    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate) as unknown
      } catch {
        continue
      }
    }
    if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as Record<string, unknown>
    if (typeof record.accepted === 'boolean') {
      const type = normalizeDiagramType(record.type)
      return {
        accepted: record.accepted,
        ...(type != null ? { type } : {}),
        ...(typeof record.source === 'string' ? { source: record.source } : {}),
        ...(typeof record.title === 'string' ? { title: record.title } : {}),
        ...(typeof record.height === 'number' ? { height: record.height } : {}),
        ...(Array.isArray(record.warnings)
          ? { warnings: record.warnings.filter((item): item is string => typeof item === 'string') }
          : {}),
        ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      }
    }
    for (const key of ['structuredContent', 'result', 'data']) {
      if (record[key] != null) candidates.push(record[key])
    }
    if (Array.isArray(record.content)) {
      for (const item of record.content.slice(0, 4)) {
        if (item != null && typeof item === 'object') {
          const text = (item as Record<string, unknown>).text
          if (typeof text === 'string') candidates.push(text)
        }
      }
    }
  }
  return null
}
