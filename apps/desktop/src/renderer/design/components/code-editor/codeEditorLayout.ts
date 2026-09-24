/**
 * CodeEditor 的尺寸口径。
 *
 * 这些字段原来是 lobehub TextArea（`rows` 由浏览器按字号算高），换成 Monaco 后高度不再自动
 * 推导，因此把字号 / 行高 / 内边距集中在这里：调用方继续沿用原来的 rows 数值，高度换算统一
 * 由本模块决定，保证 8 个字段的视觉节奏一致、后续调一行就能全局生效。
 */

/** 与 `.ct_code_input` 旧口径一致的等宽字号 */
export const CODE_EDITOR_FONT_SIZE = 12
/** 固定行高：显式给定才能让 rows → 高度成为确定性计算，不受字体度量影响 */
export const CODE_EDITOR_LINE_HEIGHT = 18
/** Monaco options.padding.top / bottom（两处必须同源） */
export const CODE_EDITOR_VERTICAL_PADDING = 6
/** Monaco 在有横向溢出时会占用视口底部（滚动条高度），预留出来避免最后一行被压住 */
export const CODE_EDITOR_SCROLLBAR_ALLOWANCE = 10

export const CODE_EDITOR_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** rows（可见行数）→ 编辑器像素高度 */
export function codeEditorHeightForRows(rows: number): number {
  const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 1
  return (
    safeRows * CODE_EDITOR_LINE_HEIGHT +
    CODE_EDITOR_VERTICAL_PADDING * 2 +
    CODE_EDITOR_SCROLLBAR_ALLOWANCE
  )
}
