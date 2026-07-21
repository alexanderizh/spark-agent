// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, icon }: { children?: ReactNode; icon?: ReactNode }) => (
    <button>
      {icon}
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('../../Icons', () => ({
  Icons: new Proxy({}, { get: () => 'span' }),
}))
import {
  CanvasShotScriptEditor,
} from './CanvasShotScriptEditor'
import {
  createStoryboardShot,
  normalizeStoryboardShotIndexes,
} from './canvasStoryboardEditor'

describe('CanvasShotScriptEditor', () => {
  it('renders a master-detail editor instead of a wide table', () => {
    const html = renderToStaticMarkup(
      <CanvasShotScriptEditor
        rows={[
          {
            index: 1,
            title: '雨夜电话',
            durationSec: 8,
            shotSize: '中近景',
            movement: '固定机位',
            sceneLayout: '狭小出租屋，旧书桌靠墙。',
            description: '角色拿起手机，压低声音接通电话。',
          },
        ]}
        characterAssets={[]}
        onRowsChange={() => undefined}
      />,
    )

    expect(html).toContain('镜头序列')
    expect(html).toContain('画面设计')
    expect(html).toContain('摄影光色')
    expect(html).toContain('角色表演')
    expect(html).toContain('对白声音')
    expect(html).toContain('生成控制')
    expect(html).toContain('雨夜电话')
    expect(html).toContain('场景与画面')
    expect(html).not.toContain('<table')
  })

  it('creates and normalizes shot indexes after structural edits', () => {
    const created = createStoryboardShot(3)
    const normalized = normalizeStoryboardShotIndexes([
      { ...created, index: 9 },
      { ...created, index: 12, title: '第二镜' },
    ])

    expect(created).toMatchObject({ index: 3, title: '镜3', description: '' })
    expect(normalized.map((row) => row.index)).toEqual([1, 2])
    expect(normalized[1]?.title).toBe('第二镜')
  })
})
