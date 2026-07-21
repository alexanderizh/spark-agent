import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(
  fileURLToPath(new URL('./CanvasStage.tsx', import.meta.url)),
  'utf8',
)
const nodeSource = readFileSync(
  fileURLToPath(new URL('./CanvasNode.tsx', import.meta.url)),
  'utf8',
)
const workspaceSource = readFileSync(
  fileURLToPath(new URL('./CanvasWorkspaceView.tsx', import.meta.url)),
  'utf8',
)
const addNodeMenuSource = readFileSync(
  fileURLToPath(new URL('./CanvasAddNodeMenu.tsx', import.meta.url)),
  'utf8',
)
const legacyContextMenuSource = readFileSync(
  fileURLToPath(new URL('./CanvasContextMenu.tsx', import.meta.url)),
  'utf8',
)
const contextMenuStyles = readFileSync(
  fileURLToPath(new URL('./canvasContextMenus.less', import.meta.url)),
  'utf8',
)

describe('canvas pane context menu', () => {
  it('keeps lock and front actions for a single selection only', () => {
    expect(stageSource).toContain(
      'selectedNodeIds.length === 1 && onToggleLockSelectedNodes &&',
    )
    expect(stageSource).toContain(
      'selectedNodeIds.length === 1 && onBringSelectedNodesToFront &&',
    )
  })

  it('renders deletion with the danger color for single and multi selection', () => {
    expect(nodeSource).toMatch(
      /canvas-menu-item canvas-menu-item-danger[\s\S]*?<Icons\.Trash[\s\S]*?删除节点/,
    )
    expect(stageSource).toMatch(
      /className="canvas-menu-item-danger"[\s\S]*?onDeleteSelectedNodes\(\)/,
    )
    expect(contextMenuStyles).toMatch(
      /\.canvas-pane-context-menu button\.canvas-menu-item-danger\s*{[\s\S]*?color:\s*var\(--danger\)/,
    )
  })

  it('applies the scroll boundary class to every node submenu portal', () => {
    expect(nodeSource.match(/popupClassName: 'canvas-node-context-submenu-popup'/g)).toHaveLength(3)
    expect(contextMenuStyles).toMatch(
      /\.canvas-node-context-submenu-popup \.ant-dropdown-menu\s*{[\s\S]*?max-height:\s*min\(440px, calc\(100dvh - 96px\)\)/,
    )
  })

  it('splits resource creation actions between the two task submenus without duplication', () => {
    const taskMenuSource = stageSource.slice(
      stageSource.indexOf('<div className="canvas-pane-context-section-title">任务节点</div>'),
      stageSource.indexOf('<div className="canvas-pane-context-section-title">画布</div>'),
    )
    const filmMenuSource = taskMenuSource.slice(
      taskMenuSource.indexOf('label={CANVAS_FUNCTIONAL_MENU_LABEL}'),
      taskMenuSource.indexOf('label={CANVAS_BASE_TASK_MENU_LABEL}'),
    )
    const baseMenuSource = taskMenuSource.slice(
      taskMenuSource.indexOf('label={CANVAS_BASE_TASK_MENU_LABEL}'),
    )

    expect(taskMenuSource.match(/<CanvasPaneResourceNodeActions/g)).toHaveLength(2)
    expect(taskMenuSource).not.toContain('>资源内容节点</div>')
    expect(filmMenuSource).toContain('onAddImage={handleAddImageFromPane}')
    expect(filmMenuSource).toContain('onAddDirectorStage3D=')
    expect(filmMenuSource).toContain('onAddVideoWorkbench=')
    expect(filmMenuSource).toContain('onInsertAsset=')
    expect(filmMenuSource).not.toContain('onAddText=')
    expect(filmMenuSource).not.toContain('onAddPrompt=')
    expect(baseMenuSource).toContain('onAddText={handleAddTextFromPane}')
    expect(taskMenuSource).not.toContain('新建 Prompt')
    expect(baseMenuSource).not.toContain('onAddPrompt=')
    expect(baseMenuSource).not.toContain('onAddImage=')
    expect(baseMenuSource).not.toContain('onAddDirectorStage3D=')
    expect(baseMenuSource).not.toContain('onInsertAsset=')
    expect(filmMenuSource).toContain('panePipelineOperationGroups.map')
    expect(baseMenuSource).toContain('CANVAS_BASE_CREATE_OPERATION_GROUPS.map')
  })

  it('uses the same categorized task menus for content and functional nodes with outputs', () => {
    expect(nodeSource).toContain('CANVAS_PIPELINE_MENU_GROUPS.flatMap')
    expect(nodeSource).toContain('CANVAS_BASE_CREATE_OPERATION_GROUPS.map')
    expect(workspaceSource).toContain('CANVAS_PIPELINE_MENU_GROUPS.map')
    expect(workspaceSource).toContain('!isGroup && hasResource')
    expect(workspaceSource).not.toContain('!isGroup && !isOperation')
  })

  it('keeps text as the only direct text-like node creation entry', () => {
    expect(addNodeMenuSource).toContain("id: 'resource:text'")
    expect(addNodeMenuSource).not.toContain("id: 'resource:prompt'")
    expect(legacyContextMenuSource).not.toContain("key: 'add_prompt', label: '新建 Prompt'")
    expect(stageSource).not.toContain('onAddPromptAtPosition')
  })
})
