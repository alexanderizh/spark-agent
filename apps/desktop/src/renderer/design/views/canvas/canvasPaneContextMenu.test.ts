import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(
  fileURLToPath(new URL('./CanvasStage.tsx', import.meta.url)),
  'utf8',
)
const nodeSource = readFileSync(fileURLToPath(new URL('./CanvasNode.tsx', import.meta.url)), 'utf8')
const workspaceSource = readFileSync(
  fileURLToPath(new URL('./CanvasWorkspaceView.tsx', import.meta.url)),
  'utf8',
)
const floatingToolbarSource = readFileSync(
  fileURLToPath(new URL('./CanvasFloatingNodeToolbar.tsx', import.meta.url)),
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
    expect(stageSource).toContain('selectedNodeIds.length === 1 && onToggleLockSelectedNodes &&')
    expect(stageSource).toContain('selectedNodeIds.length === 1 && onBringSelectedNodesToFront &&')
  })

  it('renders deletion with the danger color for single and multi selection', () => {
    expect(nodeSource).toMatch(
      /canvas-menu-item canvas-menu-item-danger[\s\S]*?<Icons\.Trash[\s\S]*?删除节点/,
    )
    expect(stageSource).toMatch(
      /className="canvas-menu-item-danger"[\s\S]*?onDeleteSelectedNodes\(\)/,
    )
    expect(contextMenuStyles).toMatch(
      /\.canvas-pane-context-menu button\.canvas-menu-item-danger[\s\S]*?{\s*color:\s*var\(--danger\)/,
    )
  })

  it('applies the scroll boundary class to every node submenu portal', () => {
    expect(nodeSource.match(/popupClassName: 'canvas-node-context-submenu-popup'/g)).toHaveLength(2)
    expect(contextMenuStyles).toMatch(
      /\.canvas-node-context-submenu-popup \.ant-dropdown-menu\s*{[\s\S]*?max-height:\s*min\(440px, calc\(100dvh - 96px\)\)/,
    )
  })

  it('uses one charcoal menu surface with a compact second-level density', () => {
    expect(contextMenuStyles).toMatch(
      /\.canvas-pane-context-menu,[\s\S]*?\.canvas-node-context-submenu-popup \.ant-dropdown-menu\s*\{[\s\S]*?background: var\(--canvas-cinema-surface-4/,
    )
    expect(contextMenuStyles).toMatch(
      /\.canvas-pane-context-menu button,[\s\S]*?\.canvas-node-context-menu\.ant-dropdown-menu \.ant-dropdown-menu-item[\s\S]*?min-height: 38px[\s\S]*?font-size: 14px/,
    )
    expect(contextMenuStyles).toMatch(
      /\.canvas-pane-context-submenu-panel button,[\s\S]*?\.canvas-node-context-submenu-popup \.ant-dropdown-menu \.ant-dropdown-menu-item[\s\S]*?height: 34px[\s\S]*?font-size: 13px/,
    )
    expect(contextMenuStyles).toContain(
      '.canvas-pane-context-submenu-panel .canvas-pane-context-section-title',
    )
    expect(contextMenuStyles).toContain(
      '.canvas-pane-context-submenu-panel button > .canvas-pane-context-op-icon',
    )
    expect(contextMenuStyles).toContain('max-width: min(192px, calc(100dvw - 40px));')
    expect(contextMenuStyles).toContain('max-width: min(240px, calc(100dvw - 32px));')
  })

  it('keeps functional resource actions separate from flat base task entries', () => {
    const taskMenuSource = stageSource.slice(
      stageSource.indexOf('<div className="canvas-pane-context-section-title">任务节点</div>'),
      stageSource.indexOf('<div className="canvas-pane-context-section-title">画布</div>'),
    )
    const filmMenuSource = taskMenuSource.slice(
      taskMenuSource.indexOf('label={CANVAS_FUNCTIONAL_MENU_LABEL}'),
      taskMenuSource.indexOf('canvasVisibleBaseCreateOperations().map'),
    )

    expect(taskMenuSource.match(/<CanvasPaneResourceNodeActions/g)).toHaveLength(2)
    expect(taskMenuSource).not.toContain('>资源内容节点</div>')
    expect(filmMenuSource).toContain('onAddImage={handleAddImageFromPane}')
    expect(filmMenuSource).toContain('onAddDirectorStage3D=')
    expect(filmMenuSource).toContain('onAddVideoWorkbench=')
    expect(filmMenuSource).toContain('onInsertAsset=')
    expect(filmMenuSource).not.toContain('onAddPrompt=')
    expect(taskMenuSource).toContain('onAddText={handleAddTextFromPane}')
    expect(taskMenuSource).not.toContain('新建 Prompt')
    expect(filmMenuSource).toContain('panePipelineOperationGroups.map')
    expect(taskMenuSource).toContain('canvasVisibleBaseCreateOperations().map')
    expect(taskMenuSource).not.toContain('CANVAS_BASE_TASK_MENU_LABEL')
  })

  it('uses the same task operation source for content and functional nodes with outputs', () => {
    expect(nodeSource).toContain('CANVAS_PIPELINE_MENU_GROUPS.flatMap')
    expect(nodeSource).toContain('getNodePipelineActions(contentNode, { assetKinds })')
    expect(nodeSource).toContain('canvasVisibleBaseCreateOperations().map')
    expect(nodeSource).not.toContain('CANVAS_BASE_TASK_MENU_LABEL')
    expect(floatingToolbarSource).toContain('CANVAS_PIPELINE_MENU_GROUPS.map')
    expect(floatingToolbarSource).toContain('const pipelineActionGroups =')
    expect(workspaceSource).toContain('<CanvasFloatingNodeToolbar')
  })

  it('为图片任务和图片资源的右键菜单提供统一图片操作', () => {
    expect(nodeSource).toContain("key: 'preview-panorama'")
    expect(nodeSource).toContain("key: 'annotate-image'")
    expect(nodeSource).toContain("key: 'extract-character-subview'")
    expect(nodeSource).toContain("key: 'split-grid-image'")
    expect(nodeSource).toContain('isImageContent && hasOperationOutput')
  })

  it('flattens right-click image and video creation entries beside add text', () => {
    const operationMenuStart = stageSource.indexOf(
      '<CanvasPaneResourceNodeActions onAddText={handleAddTextFromPane}',
    )
    const operationMenuSource = stageSource.slice(operationMenuStart)
    expect(operationMenuStart).toBeGreaterThanOrEqual(0)
    expect(operationMenuSource).toContain(
      'CanvasPaneResourceNodeActions onAddText={handleAddTextFromPane}',
    )
    expect(operationMenuSource).toContain('canvasVisibleBaseCreateOperations().map')
    expect(operationMenuSource).not.toContain('<CanvasPaneContextSubmenu')
    expect(operationMenuSource).toContain('<button')
    expect(operationMenuSource).not.toContain('<Button')
    expect(nodeSource).toContain('canvasVisibleBaseCreateOperations().map')
    expect(nodeSource).toContain('<span className="canvas-menu-item">')
  })

  it('keeps text as the only direct text-like node creation entry', () => {
    expect(addNodeMenuSource).toContain("id: 'resource:text'")
    expect(addNodeMenuSource).not.toContain("id: 'resource:prompt'")
    expect(legacyContextMenuSource).not.toContain("key: 'add_prompt', label: '新建 Prompt'")
    expect(stageSource).not.toContain('onAddPromptAtPosition')
  })
})
