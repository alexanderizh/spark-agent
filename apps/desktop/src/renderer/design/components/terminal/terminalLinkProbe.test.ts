// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { findLinkAtCell, pickTerminalCell } from './terminalLinkProbe'

/**
 * findLinkAtCell / pickTerminalCell 只依赖 Terminal 的公开 buffer API
 * （buffer.active / getLine / isWrapped / translateToString / viewportY / cols / rows），
 * 用最小 mock 覆盖遍历与偏移逻辑，不需要真实 xterm 实例。
 */
interface MockLine {
  text: string
  isWrapped?: boolean
}

function makeTerm(lines: MockLine[], opts?: { cols?: number; rows?: number; viewportY?: number }) {
  const cols = opts?.cols ?? 80
  const rows = opts?.rows ?? 24
  const viewportY = opts?.viewportY ?? 0
  const term = {
    cols,
    rows,
    buffer: {
      active: {
        viewportY,
        length: lines.length,
        getLine: (y: number) => {
          const line = lines[y]
          if (line == null) return undefined
          return {
            isWrapped: line.isWrapped === true,
            // 模拟 trimRight：去掉行尾空白
            translateToString: (trimRight?: boolean) =>
              trimRight === true ? line.text.replace(/\s+$/, '') : line.text,
          }
        },
      },
    },
  }
  return term as unknown as Terminal
}

describe('findLinkAtCell', () => {
  it('命中单行内的 URL', () => {
    const term = makeTerm([{ text: 'see https://example.com/a?b=1 for details' }])
    // 点击在 URL 中间（col 10）
    expect(findLinkAtCell(term, { row: 0, col: 10 })).toBe('https://example.com/a?b=1')
    // 点击在 URL 起始列
    expect(findLinkAtCell(term, { row: 0, col: 4 })).toBe('https://example.com/a?b=1')
  })

  it('点击 URL 外的位置返回 null', () => {
    const term = makeTerm([{ text: 'see https://example.com for details' }])
    expect(findLinkAtCell(term, { row: 0, col: 1 })).toBeNull()
    expect(findLinkAtCell(term, { row: 0, col: 25 })).toBeNull()
  })

  it('跨软换行的 URL 能拼回完整链接', () => {
    // 第一行结尾是 url 前半段，第二行 isWrapped 续接
    const term = makeTerm([
      { text: 'docs at https://example.com/very/long/path/' },
      { text: 'nested/page.html trailing', isWrapped: true },
    ])
    // 点击第二行中间的 URL 部分（row=1, col=6）
    expect(findLinkAtCell(term, { row: 1, col: 6 })).toBe(
      'https://example.com/very/long/path/nested/page.html',
    )
    // 点击第一行 URL 部分同样命中完整链接
    expect(findLinkAtCell(term, { row: 0, col: 12 })).toBe(
      'https://example.com/very/long/path/nested/page.html',
    )
  })

  it('向上追溯多个软换行行', () => {
    const term = makeTerm([
      { text: 'head https://a.io/x' },
      { text: 'yyyy', isWrapped: true },
      { text: 'zzzz tail', isWrapped: true },
    ])
    expect(findLinkAtCell(term, { row: 2, col: 0 })).toBe('https://a.io/xyyyyzzzz')
  })

  it('点击列超出被 trim 的行尾时夹到行尾（不命中）', () => {
    const term = makeTerm([{ text: 'plain text https://example.com' }])
    // 行尾之后（col 超过文本长度）
    expect(findLinkAtCell(term, { row: 0, col: 79 })).toBeNull()
  })

  it('row 越界时夹到最后一行', () => {
    const term = makeTerm([{ text: 'https://example.com' }])
    expect(findLinkAtCell(term, { row: 999, col: 3 })).toBe('https://example.com')
  })

  it('空 buffer 返回 null', () => {
    const term = makeTerm([])
    expect(findLinkAtCell(term, { row: 0, col: 0 })).toBeNull()
  })
})

describe('pickTerminalCell', () => {
  const makeRowsEl = (rect: { left: number; top: number; width: number; height: number }) => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    } as DOMRect)
    return el
  }

  it('按网格均分换算 cell，并叠加 viewportY 得到 buffer 行', () => {
    const lines = Array.from({ length: 200 }, () => ({ text: 'x' }))
    const term = makeTerm(lines, { cols: 80, rows: 24, viewportY: 120 })
    const rowsEl = makeRowsEl({ left: 10, top: 20, width: 800, height: 480 })
    // 每个 cell 10px 宽、20px 高
    const cell = pickTerminalCell(term, 10 + 25, 20 + 45, rowsEl)
    expect(cell).toEqual({ row: 120 + 2, col: 2 })
  })

  it('点击容器外返回 null', () => {
    const term = makeTerm([], { cols: 80, rows: 24 })
    const rowsEl = makeRowsEl({ left: 0, top: 0, width: 800, height: 480 })
    expect(pickTerminalCell(term, 900, 100, rowsEl)).toBeNull()
    expect(pickTerminalCell(term, 100, -5, rowsEl)).toBeNull()
  })
})
