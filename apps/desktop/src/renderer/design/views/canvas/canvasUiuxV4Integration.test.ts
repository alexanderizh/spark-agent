import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readCanvasSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas UI/UX V4 integration', () => {
  it('loads the modular V4 stylesheet from the real workspace and scopes it locally', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')
    const stylesheetEntry = readCanvasSource('./uiux-v4/index.less')
    const scopedModules = [
      'theme.less',
      'stage.less',
      'nodes.less',
      'panels.less',
      'workbenches.less',
      'form-controls.less',
    ]

    expect(workspace).toContain("import './uiux-v4/index.less'")
    expect(workspace).toContain('canvas-workspace canvas-uiux-v4')
    for (const moduleName of scopedModules) {
      expect(stylesheetEntry).toContain(`@import './${moduleName}';`)
      expect(readCanvasSource(`./uiux-v4/${moduleName}`)).toContain(
        '.canvas-workspace.canvas-uiux-v4',
      )
    }
  })

  it('renders the product node chrome and labeled primary creation actions', () => {
    const node = readCanvasSource('./CanvasNode.tsx')
    const addMenu = readCanvasSource('./CanvasAddNodeMenu.tsx')
    const dock = readCanvasSource('./CanvasBottomDock.tsx')
    const legacyStyles = readCanvasSource('./CanvasWorkspaceView.less')
    const nodeStyles = readCanvasSource('./uiux-v4/nodes.less')
    const panelStyles = readCanvasSource('./uiux-v4/panels.less')
    const placeholderStyleBlock = nodeStyles.match(
      /\.canvas-node-image-placeholder,[\s\S]*?\.canvas-node-group-body\s*\{([\s\S]*?)\n {2}\}/,
    )?.[1]

    expect(node).toContain('canvas-node-content-title')
    expect(node).toContain('<div className="canvas-node-meta-bar">')
    expect(node).toContain('canvas-node-quick-footer')
    expect(node).toContain('shouldShowOutputNavigation')
    expect(node).not.toContain('双击可快速打开')
    expect(nodeStyles).toContain('.canvas-node-body > .canvas-node-operation')
    expect(nodeStyles).toContain('flex: 0 0 35px')
    expect(placeholderStyleBlock).toBeDefined()
    expect(placeholderStyleBlock).not.toContain('padding: 20px;')
    expect(legacyStyles).not.toMatch(/\.canvas-node-task\s*\{[^}]*padding:\s*12px/s)
    expect(panelStyles).toContain('.canvas-agent-side-panel-collapse-toggle.is-collapsed')
    expect(panelStyles).toContain('display: none')
    expect(addMenu).toContain('canvas-dock-labeled-action')
    expect(dock).toContain('aria-label="全部节点类型"')
    expect(dock).not.toContain('shortLabel="资源"')
    expect(dock).not.toContain('shortLabel="任务"')
  })

  it('uses full-bleed overlays only for image nodes with loaded content', () => {
    const node = readCanvasSource('./CanvasNode.tsx')
    const nodeStyles = readCanvasSource('./uiux-v4/nodes.less')

    expect(node).toContain('isFullBleedCanvasImageNode(node)')
    expect(node).toContain('canvas-node-image-full-bleed')
    expect(node).toContain('canvas-node-image-overlay-footer')
    expect(nodeStyles).toContain('.canvas-node-image-full-bleed')
    expect(nodeStyles).toContain('.canvas-node-image-overlay-footer')
    expect(nodeStyles).toContain('backdrop-filter: blur(10px)')
  })

  it('keeps portal modal styling isolated to canvas business classes', () => {
    const modals = readCanvasSource('./uiux-v4/modals.less')

    expect(modals).toContain('.canvas-operation-preset-dialog')
    expect(modals).toContain('.canvas-node-edit-modal')
    expect(modals).not.toMatch(/(^|\n)\s*\.ant-modal\s*\{/)
  })

  it('gives composite form controls a single visual surface owner', () => {
    const controls = readCanvasSource('./uiux-v4/form-controls.less')
    const storyboard = readCanvasSource('./CanvasShotScriptEditor.less')

    expect(controls).toContain('.ant-input-affix-wrapper > input.ant-input')
    expect(controls).toContain('.ant-input-number input.ant-input-number-input')
    expect(controls).toContain('background: transparent !important')
    expect(controls).toContain('box-shadow: none !important')
    expect(storyboard).not.toContain('.ant-input-affix-wrapper-focused')
  })

  it('uses real media elements in asset preview and supports Escape close', () => {
    const assetManager = readCanvasSource('./CanvasAssetManagerPanel.tsx')

    expect(assetManager).toContain('function AssetDetailPreview')
    expect(assetManager).toContain('<video src={source} controls')
    expect(assetManager).toContain('<audio src={source} controls')
    expect(assetManager).toContain("event.key !== 'Escape'")
  })

  it('keeps only the 3D director stage and gives its forms an isolated dark theme', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')
    const stage = readCanvasSource('./CanvasStage.tsx')
    const node = readCanvasSource('./CanvasNode.tsx')
    const stage3dModal = readCanvasSource('./stage3d/CanvasDirectorStage3DModal.tsx')

    expect(workspace).not.toContain('CanvasDirectorStageModal')
    expect(workspace).not.toContain("subtype: 'director_stage'")
    expect(stage).not.toContain('onAddDirectorStageAtPosition')
    expect(node).not.toContain('DirectorStageMini')
    expect(stage3dModal).toContain('<ConfigProvider theme={STAGE3D_FORM_THEME}>')
    expect(stage3dModal).toContain('algorithm: antdTheme.darkAlgorithm')
    expect(stage3dModal).toContain("colorText: '#e4e4e7'")
  })

  it('keeps selected values readable in the 3D director stage side forms', () => {
    const workbenchStyles = readCanvasSource('./uiux-v4/workbenches.less')

    expect(workbenchStyles).toContain('input:not(.ant-select-input)')
    expect(workbenchStyles).not.toMatch(/\.stage3d-field\s*\{[\s\S]*?\n\s+input,/)
  })
})
