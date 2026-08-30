import { isShotScriptText, parseShotTable, type ParsedShotRow } from './canvasShotTableParse'

/**
 * Return rows that are safe to render with the storyboard presentation.
 *
 * A single parsed row is still a storyboard: splitting a storyboard by shot
 * intentionally produces one-row text nodes that must keep the same table
 * presentation as the source node.
 */
export function readRenderableShotScriptRows(text: string | null | undefined): ParsedShotRow[] {
  if (!text || !isShotScriptText(text)) return []
  // 任务结果可能只返回镜号/标题，其余字段留空；显式保留这种可编辑镜头，
  // 避免格式化后的空白镜头又在展示层被过滤掉。
  const rows = parseShotTable(text, { allowEmptyRows: true })
  return rows.length > 0 ? rows : []
}

export function isRenderableShotScriptText(text: string | null | undefined): boolean {
  return readRenderableShotScriptRows(text).length > 0
}
