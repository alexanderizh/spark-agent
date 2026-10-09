import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('SessionWorkflowPicker styles', () => {
  it('uses an opaque application surface for the workflow menu', () => {
    const styles = readFileSync(new URL('./SessionWorkflowPicker.less', import.meta.url), 'utf8')

    expect(styles).toMatch(/background: var\(--panel\);/)
    expect(styles).not.toContain('--color-bg-elevated')
    expect(styles).not.toContain('#fff')
  })

  it('matches the composer permission/reasoning menu visual language', () => {
    const styles = readFileSync(new URL('./SessionWorkflowPicker.less', import.meta.url), 'utf8')

    // 与权限策略 / 推理强度弹窗同一套容器视觉：无 1px 边框、--r-md 圆角、--shadow-lg 阴影
    expect(styles).toContain('box-shadow: var(--shadow-lg)')
    expect(styles).toMatch(/\.session-workflow-menu\s*\{[^}]*border-radius: var\(--r-md\);/)
    expect(styles).not.toMatch(/\.session-workflow-menu\s*\{[^}]*border:\s*1px/)
    expect(styles).toMatch(/\.session-workflow-option\s*\{[^}]*border-radius: var\(--r-sm\);/)
  })

  it('uses a compact icon trigger and truncates workflow option text', () => {
    const styles = readFileSync(new URL('./SessionWorkflowPicker.less', import.meta.url), 'utf8')

    expect(styles).toMatch(/\.session-workflow-trigger\s*\{[\s\S]*?width: 29px;/)
    expect(styles).toMatch(/\.session-workflow-trigger\.is-selected\s*\{/)
    expect(styles).toMatch(
      /\.session-workflow-option-label\s*\{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
    )
    expect(styles).toMatch(
      /\.session-workflow-option-description\s*\{[\s\S]*?flex: 0 0 auto;[\s\S]*?white-space: nowrap;/,
    )
  })

  it('highlights the selected trigger with real theme tokens', () => {
    const styles = readFileSync(new URL('./SessionWorkflowPicker.less', import.meta.url), 'utf8')
    // 只看触发器那一段规则（到菜单容器规则为止）
    const triggerBlock = styles.slice(
      styles.indexOf('.session-workflow-trigger'),
      styles.indexOf('.session-workflow-menu {'),
    )

    // 选中态必须用本项目真实存在的主题色 token：--primary 图标 + --selected(--primary-soft) 浅底
    expect(triggerBlock).toMatch(
      /\.session-workflow-trigger\.is-selected\s*\{[^}]*color: var\(--primary\);/,
    )
    expect(triggerBlock).toMatch(
      /\.session-workflow-trigger\.is-selected\s*\{[^}]*background: var\(--selected\);/,
    )
    // --color-* 系列 token 本项目未定义，声明整条失效会让选中/hover/焦点态全部静默消失
    expect(triggerBlock).not.toMatch(/var\(--color-/)
    // hover / 展开的高亮不能盖掉选中态（排除 .is-selected 后仍有更高特异性）
    expect(triggerBlock).toMatch(
      /\.session-workflow-trigger:hover:not\(:disabled\),[\s\S]*?:not\(\.is-selected\)\s*\{/,
    )
  })

  it('pins the failure notice to the top of the scrollable menu', () => {
    const styles = readFileSync(new URL('./SessionWorkflowPicker.less', import.meta.url), 'utf8')

    // 报错必须吸顶：菜单可滚动，放末尾会被滚出可视区（用户点完看不到失败原因）。
    expect(styles).toMatch(/\.session-workflow-error\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0;/)
    // 吸顶块需要与菜单同色，否则滚动时下层文字会透出来。
    expect(styles).toMatch(/\.session-workflow-error\s*\{[\s\S]*?background: var\(--panel\);/)
    // 通栏收口用分割线，不引入卡片式边框盒子。
    expect(styles).toMatch(
      /\.session-workflow-error\s*\{[\s\S]*?border-bottom: 1px solid var\(--border\);/,
    )
  })

  // 锚定 ContextMeter：picker 必须唯一渲染在外层参数条上（ContextMeter 之前），
  // 不得被挪进菜单内部或重复渲染。曾断言「紧跟 debug 开关之后」，但 Picker 自引入
  // 提交（72f9fa8c9）起就稳定位于 debug 开关之前，该断言从未成立过，此处按实际
  // 渲染顺序修正（debug 开关与 picker 的先后无视觉约束）。
  it('places the picker once in the outer parameter bar before the context meter', () => {
    const source = readFileSync(new URL('../ComposerV2.tsx', import.meta.url), 'utf8')
    const pickerOccurrences = source.match(/<SessionWorkflowPicker/g) ?? []
    const workflowPickerIndex = source.indexOf('<SessionWorkflowPicker')
    const contextMeterIndex = source.indexOf('<ContextMeterWithPopup', workflowPickerIndex)

    expect(pickerOccurrences).toHaveLength(1)
    expect(workflowPickerIndex).toBeGreaterThan(-1)
    expect(contextMeterIndex).toBeGreaterThan(workflowPickerIndex)
  })
})
