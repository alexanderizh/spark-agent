import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readCanvasSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas inline node rename integration', () => {
  it('routes ordinary node titles through the inline editor and patchNodes', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')

    expect(workspace).toContain(
      "import { CanvasInlineNodeTitleEditor } from './CanvasInlineNodeTitleEditor'",
    )
    expect(workspace).toContain(
      'onRenameNode: (title: string | null) => Promise<void> | void',
    )
    expect(workspace).toContain('<CanvasInlineNodeTitleEditor')
    expect(workspace).toContain('onRenameNode={renameInlinePanelNodeStable}')
    expect(workspace).toContain('await patchNodes([nodeId], { title })')
  })

  it('keeps operation node titles on their existing settings path', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')

    expect(workspace).toContain('isOperation ? (')
    expect(workspace).toContain('<span>{operationTitle}</span>')
    expect(workspace).toContain('<CanvasInlineNodeTitleEditor')
  })

  it('keeps the inline title control within the existing toolbar height', () => {
    const styles = readCanvasSource('./CanvasInlineNodeTitleEditor.less')

    expect(styles).toContain('.canvas-inline-node-title-trigger')
    expect(styles).toContain('.canvas-inline-node-title-input.ant-input')
    expect(styles).toContain('height: 28px')
    expect(styles).toContain('text-overflow: ellipsis')
  })
})
