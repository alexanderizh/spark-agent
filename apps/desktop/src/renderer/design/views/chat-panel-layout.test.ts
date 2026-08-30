import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('chat side panel layout', () => {
  it.each(['unified-side-panel', 'config-panel-frame'])(
    'keeps the conversation readable while %s is open',
    (panelClass) => {
      const stylesheet = readFileSync(
        fileURLToPath(new URL('./ChatView.less', import.meta.url)),
        'utf8',
      )
      const escapedPanelClass = panelClass.replaceAll('-', '\\-')
      const block =
        stylesheet.match(
          new RegExp(
            `\\.chat-layout:has\\(> \\.${escapedPanelClass}\\) > \\.chat-main\\s*\\{[^}]*\\}`,
          ),
        )?.[0] ?? ''

      expect(block).toContain('flex-shrink: 1')
      // ChatView.less 修正：max(400px, var) 在 --chat-main-min-width:566px 时恒等于 566，
      // 面板打开时对话区无法收缩；改为 min(400px, var) 保证可收缩下限。
      expect(block).toContain('min-width: min(400px, var(--chat-main-min-width))')
      expect(block).not.toContain('min-width: max(400px')
      expect(block).not.toContain('min-width: 0')
    },
  )
})
