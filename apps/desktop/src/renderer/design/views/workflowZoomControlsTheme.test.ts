import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflowStyles = readFileSync(
  fileURLToPath(new URL('./WorkflowView.less', import.meta.url)),
  'utf8',
)

/** 取出某个选择器后面的第一个声明块，避免跨规则误匹配。 */
function blockOf(selector: string): string {
  const start = workflowStyles.indexOf(selector)
  expect(start, `缺少选择器 ${selector}`).toBeGreaterThan(-1)
  const open = workflowStyles.indexOf('{', start)
  const close = workflowStyles.indexOf('}', open)
  return workflowStyles.slice(open, close)
}

describe('workflow zoom controls theme', () => {
  it('接管 React Flow 控件的底色与前景色，不依赖 vendor 写死的浅色默认值', () => {
    const block = blockOf('.workflow-builder-v2 .wf-flow .react-flow__controls {')

    // 容器自己要有画布之上的悬浮底，否则 transparent 会直接漏出画布底色
    expect(block).toContain('background: var(--panel)')
    expect(block).toContain('border: 1px solid color-mix(in srgb, var(--text) 12%, transparent)')
    // vendor 默认是 #fefefe / #eee / inherit，这里必须显式覆盖为应用令牌
    expect(block).toContain('--xy-controls-button-background-color: transparent')
    expect(block).toContain('--xy-controls-button-background-color-hover: var(--hover)')
    expect(block).toContain('--xy-controls-button-color: var(--text)')
    expect(block).toContain('--xy-controls-button-color-hover: var(--text-strong)')
    expect(block).not.toContain('#fefefe')
    expect(block).not.toContain('#eee')
  })

  it('键盘聚焦态有可见的焦点环', () => {
    const block = blockOf(
      '.workflow-builder-v2 .wf-flow .react-flow__controls-button:focus-visible {',
    )
    expect(block).toContain('outline: none')
    expect(block).toContain('box-shadow: inset 0 0 0 2px var(--primary)')
  })
})
