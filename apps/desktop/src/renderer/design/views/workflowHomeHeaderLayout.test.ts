import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(fileURLToPath(new URL('./WorkflowView.less', import.meta.url)), 'utf8')
const view = readFileSync(fileURLToPath(new URL('./WorkflowView.tsx', import.meta.url)), 'utf8')

/** 取出某个选择器后面的第一个声明块，避免跨规则误匹配。 */
function blockOf(selector: string, source = styles): string {
  const start = source.indexOf(selector)
  expect(start, `缺少选择器 ${selector}`).toBeGreaterThan(-1)
  const open = source.indexOf('{', start)
  const close = source.indexOf('}', open)
  return source.slice(open, close)
}

/** 取出 @media 条件后面的整个块（按花括号配对，包含嵌套规则）。 */
function mediaBlockOf(query: string): string {
  const start = styles.indexOf(query)
  expect(start, `缺少 @media 查询 ${query}`).toBeGreaterThan(-1)
  const open = styles.indexOf('{', start)
  let depth = 0
  for (let index = open; index < styles.length; index += 1) {
    if (styles[index] === '{') depth += 1
    else if (styles[index] === '}') {
      depth -= 1
      if (depth === 0) return styles.slice(open, index + 1)
    }
  }
  throw new Error(`@media ${query} 花括号未闭合`)
}

describe('workflow home header responsive layout', () => {
  // 回归：标题行容器放不下整行按钮时，标题块会被压成「一列一个字」的竖排
  // （全站 word-break 让它的 min-content 只有一个字符宽），同时操作行横向溢出。
  it('标题行允许换行，操作行整体下移而不是挤压标题块', () => {
    expect(blockOf('.workflow-home-head {')).toContain('flex-wrap: wrap')
  })

  it('标题块有最小可读宽度，不会被按钮挤没', () => {
    const block = blockOf('.workflow-home-title-block {')
    expect(block).toContain('flex: 1 1 240px')
    expect(block).toContain('min-width: min(240px, 100%)')
    expect(block).not.toContain('min-width: 0')
  })

  it('操作行自身也会换行，窄窗口下按钮折行而不是被裁掉', () => {
    expect(blockOf('.workflow-home-head .agents-actions {')).toContain('flex-wrap: wrap')
  })

  it('≤980px 竖排模式下标题块不需要最小宽度（此处的 flex-basis 作用于高度）', () => {
    const media = mediaBlockOf('@media (max-width: 980px)')
    expect(media).toContain('flex-direction: column')
    expect(blockOf('.workflow-home-title-block {', media)).toContain('min-width: 0')
  })

  it('WorkflowView 的标题块确实带上了配套类名', () => {
    expect(view).toContain('<div className="workflow-home-title-block">')
  })
})
