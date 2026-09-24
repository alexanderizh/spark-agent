/**
 * CodeEditor 的诊断摘要（“第 N 行：…”）。
 *
 * Monaco 的校验结果经 @monaco-editor/react 的 onValidate 回传为 marker 列表。表单字段下方
 * 空间有限，照搬整份列表会变成报错墙，所以这里只挑第一条错误做摘要，并附上错误总数。
 *
 * 更要紧的是**降噪**：语言服务的“语义类”误报不能当缺陷展示给用户——
 *  - JSON：Monaco 的 JSON 校验只做语法级判断（未配置 schema 时不会做语义校验），全部保留；
 *  - TS/JS：只保留语法错误码（TS 诊断码 1000–1999 为 grammar 级）。语义类（>= 2000）在
 *    Monaco 那套“读不到 disk 上 node_modules / tsconfig / 全局类型”的环境里必然误报，
 *    不进摘要（波浪线仍在，hover 仍能看到原文，只是不再往字段下方加一行红字）；
 *  - shell / yaml / JSON 模板等没有语言服务的语言：不产出摘要。
 *
 * 只依赖 marker 的结构形状（不 import monaco 类型），便于单测与在无 monaco 环境复用。
 */

export interface CodeEditorMarkerLike {
  severity: number
  message: string
  startLineNumber: number
  startColumn: number
  code?: string | number | { value: string | number } | undefined
}

export interface CodeEditorDiagnosticSummary {
  line: number
  column: number
  /** 首条错误的原文（Monaco / 语言服务给的英文诊断） */
  message: string
  /** 本次校验中的错误总数（含未展示的） */
  total: number
}

/** monaco.MarkerSeverity.Error */
const MARKER_SEVERITY_ERROR = 8
/** TS/JS 语法错误码区间（grammar 级） */
const TS_SYNTAX_CODE_MIN = 1000
const TS_SYNTAX_CODE_MAX = 1999

const JSON_LANGUAGES = new Set(['json', 'jsonc'])
const TS_LANGUAGES = new Set(['typescript', 'javascript'])

function markerCodeNumber(code: CodeEditorMarkerLike['code']): number | null {
  if (typeof code === 'number') return code
  if (code != null && typeof code === 'object' && typeof code.value === 'number') return code.value
  return null
}

/** 该 marker 是否应进入摘要（错误级别 + 该语言下不会误报）。 */
export function isReportableDiagnostic(language: string, marker: CodeEditorMarkerLike): boolean {
  if (marker.severity !== MARKER_SEVERITY_ERROR) return false
  if (JSON_LANGUAGES.has(language)) return true
  if (TS_LANGUAGES.has(language)) {
    const code = markerCodeNumber(marker.code)
    return code != null && code >= TS_SYNTAX_CODE_MIN && code <= TS_SYNTAX_CODE_MAX
  }
  return false
}

/** 汇总一次校验结果；没有需要展示的错误时返回 null。 */
export function diagnoseCodeEditor(
  language: string,
  markers: readonly CodeEditorMarkerLike[],
): CodeEditorDiagnosticSummary | null {
  const errors = markers.filter((marker) => isReportableDiagnostic(language, marker))
  // marker 数组顺序由 Monaco 内部决定，这里显式按位置排序，保证摘要是就近的第一处
  errors.sort(
    (left, right) =>
      left.startLineNumber - right.startLineNumber || left.startColumn - right.startColumn,
  )
  const first = errors[0]
  if (first == null) return null
  return {
    line: first.startLineNumber,
    column: first.startColumn,
    message: first.message,
    total: errors.length,
  }
}

/** 摘要的展示文案；多行诊断压成单行，避免撑高字段。 */
export function formatCodeEditorDiagnostic(summary: CodeEditorDiagnosticSummary): string {
  const message = summary.message.replace(/\s+/gu, ' ').trim()
  const head = `第 ${summary.line} 行：${message}`
  return summary.total > 1 ? `${head}（共 ${summary.total} 处）` : head
}
