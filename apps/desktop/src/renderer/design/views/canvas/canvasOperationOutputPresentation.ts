import { readRenderableShotScriptRows } from './canvasShotScriptPresentation'
import type { ParsedShotRow } from './canvasShotTableParse'
import type { CanvasAssetType } from './canvas.types'

export type CanvasTextOutputPresentation =
  | { kind: 'storyboard'; rows: ParsedShotRow[] }
  | { kind: 'json'; text: string }
  | { kind: 'text'; text: string }

export function isReadableCanvasOperationTextOutput(output: {
  type: CanvasAssetType
  text?: string
}): output is { type: 'text' | 'prompt' | 'file'; text: string } {
  if (!output.text?.trim()) return false
  return output.type === 'text' || output.type === 'prompt' || output.type === 'file'
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1]?.trim() ?? trimmed
}

function stripTextFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md|text|plain)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1]?.trim() ?? text
}

/** 将文本产物分类为分镜表、普通 JSON 或普通文本，供卡片和详情工作台共用。 */
export function resolveCanvasTextOutputPresentation(text: string): CanvasTextOutputPresentation {
  const displayText = stripTextFence(text)
  const storyboardRows = readRenderableShotScriptRows(displayText)
  if (storyboardRows.length > 0) return { kind: 'storyboard', rows: storyboardRows }

  const jsonSource = stripJsonFence(displayText)
  if (jsonSource.startsWith('{') || jsonSource.startsWith('[')) {
    try {
      const parsed = JSON.parse(jsonSource) as unknown
      if (parsed != null && typeof parsed === 'object') {
        return { kind: 'json', text: JSON.stringify(parsed, null, 2) }
      }
    } catch {
      // 非完整 JSON 时继续按普通文本展示。
    }
  }

  return { kind: 'text', text: displayText }
}
