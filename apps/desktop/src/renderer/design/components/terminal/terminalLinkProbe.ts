/**
 * terminalLinkProbe — 把鼠标点击位置换算成 xterm buffer cell，并挖出所在逻辑行的 URL。
 *
 * 背景：xterm 的 Linkifier（hover 检测链接）是内部实现，没有公开「当前 hover 链接」
 * 的 API。终端右键菜单需要「打开链接 / 复制链接地址」，因此这里只用公开 buffer API
 * （getLine / isWrapped / translateToString）自行定位：软换行拼接逻辑行 → 计算点击
 * cell 的字符偏移 → 正则匹配覆盖该偏移的 URL。
 */
import type { Terminal } from '@xterm/xterm'

/** 与 @xterm/addon-web-links 内置正则保持同一识别范围（分组仅用于协议部分） */
const URL_PATTERN =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g

/** 向上/向下追溯软换行时的防护上限，避免异常 buffer 下死循环 */
const MAX_WALK_LINES = 2048

export interface TerminalCellRef {
  /** 0-based buffer 行（含 scrollback，可直接传给 buffer.getLine） */
  row: number
  /** 0-based 列 */
  col: number
}

/**
 * 用 rows 容器几何 + cols/rows 均分换算点击 cell。
 * 终端是等宽网格，均分足够准确；点击落在网格外（padding/滚动条）返回 null。
 */
export function pickTerminalCell(
  term: Terminal,
  clientX: number,
  clientY: number,
  rowsEl: HTMLElement,
): TerminalCellRef | null {
  const rect = rowsEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null
  }
  const col = Math.floor(((clientX - rect.left) / rect.width) * term.cols)
  const visualRow = Math.floor(((clientY - rect.top) / rect.height) * term.rows)
  if (col < 0 || col >= term.cols || visualRow < 0 || visualRow >= term.rows) return null
  const row = term.buffer.active.viewportY + visualRow
  if (row < 0 || row >= term.buffer.active.length) return null
  return { row, col }
}

/**
 * 找出点击 cell 所在逻辑行（含软换行拼接）里覆盖该位置的 URL；没有则返回 null。
 */
export function findLinkAtCell(term: Terminal, ref: TerminalCellRef): string | null {
  const buffer = term.buffer.active
  if (buffer.length === 0) return null
  const row = Math.max(0, Math.min(ref.row, buffer.length - 1))

  // 1) 向上找逻辑行顶部：isWrapped=true 表示本行是上一行的软换行延续
  let top = row
  let guard = 0
  while (top > 0 && guard++ < MAX_WALK_LINES) {
    const line = buffer.getLine(top)
    if (line == null || line.isWrapped !== true) break
    top--
  }

  // 2) 拼接逻辑行并记录点击 cell 的字符偏移；遇到非 wrapped 的下一行即结束
  const parts: string[] = []
  let offset = -1
  guard = 0
  for (let y = top; y < buffer.length && guard++ < MAX_WALK_LINES; y++) {
    const line = buffer.getLine(y)
    if (line == null) break
    const text = line.translateToString(true)
    if (y === row) {
      const before = parts.join('').length
      // 点击可能落在行尾截断的空白里，夹到已渲染文本范围内
      offset = before + Math.max(0, Math.min(ref.col, text.length))
    }
    parts.push(text)
    if (buffer.getLine(y + 1)?.isWrapped !== true) break
  }
  if (offset < 0) return null

  const joined = parts.join('')
  URL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_PATTERN.exec(joined)) != null) {
    if (offset >= match.index && offset < match.index + match[0].length) {
      return match[0]
    }
  }
  return null
}
