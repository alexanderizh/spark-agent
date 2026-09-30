// @vitest-environment jsdom

/**
 * WikiSettingsPanel 展示契约测试。
 *
 * 固化两条与「设置页视觉一致性」直接相关的断言：
 *   1. 根节点挂 `.settings-section` —— 与其他设置分区（通用 / 外观 / 记忆 …）
 *      共用同一份宽度规则（max-width 980 + 居中 + 窄屏铺满），不再私有一套。
 *   2. 每个分组标题与设置项标题都渲染一个 Tooltip 包裹的 ⓘ 图标，
 *      且 Tooltip 内容是协议里的 description —— 说明文字不再平铺在标题下方。
 *
 * 依赖按现有测试惯例 mock（参照 provider-manifest-contract-editor.test.tsx）：
 * @lobehub/ui / antd 控件降级为原生元素，避免 emoji 数据与真实浮层行为干扰断言。
 *
 * 渲染节奏：组件的 IPC 读取在 useEffect 的 async IIFE 里，同步 `act(render)` 后
 * 需要让出微任务队列才能收敛；收尾必须 unmount 并再次让出，否则 React 的调度
 * 任务会在 jsdom 环境拆除后访问 window，抛出 unhandled error。
 */

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WIKI_SETTING_DEFINITIONS, WIKI_SETTING_GROUPS } from '@spark/protocol'

// 告知 React 当前处于 act 测试环境，否则每次 act() 都打印告警
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ── mock：@lobehub/ui 只用到 Button ── */
vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode
    onClick?: () => void
    'aria-label'?: string
  }) =>
    React.createElement(
      'button',
      { type: 'button', onClick, 'aria-label': ariaLabel, 'data-mock': 'lobe-button' },
      children,
    ),
}))

/* ── mock：antd 控件降级；Tooltip 保留 title 供断言 ── */
vi.mock('antd', () => ({
  Switch: ({
    checked,
    disabled,
    onChange,
  }: {
    checked?: boolean
    disabled?: boolean
    onChange?: (v: boolean) => void
  }) =>
    React.createElement('input', {
      type: 'checkbox',
      checked: checked === true,
      disabled: disabled === true,
      onChange: (e) => onChange?.((e.target as HTMLInputElement).checked),
      'data-mock': 'antd-switch',
    }),
  InputNumber: ({
    value,
    disabled,
    onChange,
  }: {
    value?: number
    disabled?: boolean
    onChange?: (v: number) => void
  }) =>
    React.createElement('input', {
      type: 'number',
      value: value ?? 0,
      disabled: disabled === true,
      onChange: (e) => onChange?.(Number((e.target as HTMLInputElement).value)),
      'data-mock': 'antd-input-number',
    }),
  Select: ({
    value,
    disabled,
    onChange,
    options,
  }: {
    value?: string
    disabled?: boolean
    onChange?: (v: string) => void
    options?: Array<{ label: string; value: string }>
  }) =>
    React.createElement(
      'select',
      {
        value,
        disabled: disabled === true,
        onChange: (e) => onChange?.((e.target as HTMLSelectElement).value),
        'data-mock': 'antd-select',
      },
      options?.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label)),
    ),
  Spin: () => React.createElement('span', { 'data-mock': 'antd-spin' }, 'loading'),
  // Tooltip 直接渲染 children，把 title 摊到 data 属性上供断言
  Tooltip: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement(
      'span',
      { 'data-mock': 'antd-tooltip', 'data-tip': typeof title === 'string' ? title : '' },
      children,
    ),
}))

/* ── mock：Icons.HelpCircle 用可识别元素 ── */
vi.mock('../design/Icons', () => ({
  Icons: {
    HelpCircle: ({ size, className }: { size?: number; className?: string }) =>
      React.createElement('svg', {
        'data-mock': 'icons-help-circle',
        'data-size': size,
        className,
      }),
    RotateCcw: ({ size }: { size?: number }) =>
      React.createElement('svg', { 'data-mock': 'icons-rotate-ccw', 'data-size': size }),
  },
}))

/* ── mock：Toast ── */
vi.mock('../design/components/Toast', () => ({
  useToast: () => ({ toast: { error: vi.fn(), success: vi.fn() } }),
}))

/* ── mock：less 由 vite 处理，Node 下无意义 ── */
vi.mock('../design/views/wiki/wiki.less', () => ({}))

let container: HTMLDivElement
let root: Root

/** 让出 microtask，等组件 useEffect 里的 IPC 读取收敛 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 渲染面板并等待异步状态收敛 */
async function renderPanel(): Promise<void> {
  const { WikiSettingsPanel } = await import('../design/views/wiki/WikiSettingsPanel')
  act(() => {
    root.render(React.createElement(WikiSettingsPanel))
  })
  await tick()
  await tick()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  ;(window as unknown as { spark: unknown }).spark = {
    invoke: vi.fn(() => Promise.resolve({ settings: {} })),
    on: vi.fn(() => () => {}),
  }
})

afterEach(async () => {
  act(() => {
    root.unmount()
  })
  await tick()
  container.remove()
})

describe('WikiSettingsPanel 展示契约', () => {
  it('根节点与其他设置分区共用 settings-section 宽度规则', async () => {
    await renderPanel()
    const rootEl = container.querySelector('.wiki_set_root')
    expect(rootEl).not.toBeNull()
    expect(rootEl?.classList.contains('settings-section')).toBe(true)
  })

  it('每个分组标题都带 ⓘ，内容是协议里的分组描述', async () => {
    await renderPanel()
    const groupTitles = Array.from(container.querySelectorAll('.wiki_set_group_title'))
    expect(groupTitles).toHaveLength(WIKI_SETTING_GROUPS.length)

    WIKI_SETTING_GROUPS.forEach((group, index) => {
      const tip = groupTitles[index]?.querySelector('[data-mock="antd-tooltip"]')
      expect(tip, `分组 ${group.label} 缺少 ⓘ Tooltip`).not.toBeNull()
      expect(tip?.getAttribute('data-tip')).toBe(group.description)
      expect(tip?.querySelector('[data-mock="icons-help-circle"]')).not.toBeNull()
    })
  })

  it('每个设置项标题都带 ⓘ，内容是协议里的设置项描述', async () => {
    await renderPanel()
    const labels = Array.from(container.querySelectorAll('.wiki_set_label'))
    expect(labels).toHaveLength(WIKI_SETTING_DEFINITIONS.length)

    labels.forEach((labelEl) => {
      const tip = labelEl.querySelector('[data-mock="antd-tooltip"]')
      const label = (labelEl.textContent ?? '').trim()
      expect(tip, `设置项「${label}」缺少 ⓘ Tooltip`).not.toBeNull()
      expect(tip?.querySelector('[data-mock="icons-help-circle"]')).not.toBeNull()

      // 反查协议定义：标题必须能唯一命中，且 Tooltip 文案就是该定义的 description
      const def = WIKI_SETTING_DEFINITIONS.find((d) => d.label === label)
      expect(def, `标题「${label}」未在协议定义中找到`).toBeDefined()
      expect(tip?.getAttribute('data-tip')).toBe(def?.description)
    })
  })

  it('不再渲染平铺的描述区块', async () => {
    await renderPanel()
    expect(container.querySelectorAll('.wiki_set_desc')).toHaveLength(0)
    expect(container.querySelectorAll('.wiki_set_group_desc')).toHaveLength(0)
  })
})
