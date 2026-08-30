import type { ParsedShotRow } from './canvasShotTableParse'

export function createStoryboardShot(index: number): ParsedShotRow {
  return {
    index,
    title: `镜${index}`,
    description: '',
  }
}

export function normalizeStoryboardShotIndexes(rows: ParsedShotRow[]): ParsedShotRow[] {
  return rows.map((row, index) => ({ ...row, index: index + 1 }))
}
