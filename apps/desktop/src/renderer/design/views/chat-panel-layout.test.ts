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
      expect(block).toContain('min-width: max(400px, var(--chat-main-min-width))')
      expect(block).not.toContain('min-width: 0')
    },
  )
})
