import {
  isShotScriptText,
  parseShotTable,
  type ParsedShotRow,
} from './canvasShotTableParse'

/**
 * Return rows that are safe to render with the storyboard presentation.
 *
 * A single parsed row is still a storyboard: splitting a storyboard by shot
 * intentionally produces one-row text nodes that must keep the same table
 * presentation as the source node.
 */
export function readRenderableShotScriptRows(
  text: string | null | undefined,
): ParsedShotRow[] {
  if (!text || !isShotScriptText(text)) return []
  const rows = parseShotTable(text)
  return rows.length > 0 ? rows : []
}

export function isRenderableShotScriptText(text: string | null | undefined): boolean {
  return readRenderableShotScriptRows(text).length > 0
}
