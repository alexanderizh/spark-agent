import type { CanvasPipelineRole } from './canvas.types'
import { parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import { formatStoryboardRowsAsMarkdown } from './canvasTextInputPresentation'

export type CanvasSemanticTextValidation =
  | { ok: true; text: string; storyboardRows?: ParsedShotRow[] }
  | {
      ok: false
      code: 'invalid_screenplay_output' | 'invalid_storyboard_output'
      message: string
    }

const SCREENPLAY_SCENE_HEADING =
  /^(?:#{1,6}\s*)?(?:【\s*)?(?:场\s*(?:\d+|[一二三四五六七八九十百]+)|(?:INT|EXT)\.)[^\n]*(?:内景|外景|INT\.|EXT\.)/im

export function isValidScreenplayText(text: string): boolean {
  const value = text.trim()
  if (!value || !SCREENPLAY_SCENE_HEADING.test(value)) return false
  return /(?:：|:)/.test(value) || /出场人物/.test(value)
}

export function validateCanvasSemanticTextOutput(
  role: CanvasPipelineRole | undefined,
  text: string,
): CanvasSemanticTextValidation {
  const value = text.trim()
  if (role === 'screenplay') {
    if (!isValidScreenplayText(value)) {
      return {
        ok: false,
        code: 'invalid_screenplay_output',
        message: '剧本结果缺少可识别的场次标题或角色对白，未加载为剧本节点。',
      }
    }
    return { ok: true, text: value }
  }
  if (role === 'shot') {
    const storyboardRows = parseShotTable(value)
    if (storyboardRows.length === 0) {
      return {
        ok: false,
        code: 'invalid_storyboard_output',
        message: '分镜结果不包含可解析的 shots JSON 或分镜表，未加载为分镜节点。',
      }
    }
    return {
      ok: true,
      text: formatStoryboardRowsAsMarkdown(storyboardRows),
      storyboardRows,
    }
  }
  return { ok: true, text: value }
}
