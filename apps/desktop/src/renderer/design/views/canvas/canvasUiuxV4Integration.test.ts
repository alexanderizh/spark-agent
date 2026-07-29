import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readCanvasSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas cinematic integration', () => {
  it('loads one cinematic stylesheet entry from the real workspace and scopes it locally', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')
    const stylesheetEntry = readCanvasSource('./cinematic/index.less')
    const scopedModules = [
      'tokens.less',
      'vendor.less',
      'shell.less',
      'nodes.less',
      'agent.less',
      'overlays.less',
    ]

    expect(workspace).toContain("import './cinematic/index.less'")
    expect(workspace).not.toContain("import './CanvasWorkspaceView.less'")
    expect(workspace).not.toContain("import './canvas-workflow.less'")
    expect(workspace).not.toContain("import './uiux-v4/index.less'")
    expect(workspace).toContain('canvas-workspace canvas-cinematic')
    expect(workspace).not.toContain('canvas-workspace canvas-uiux-v4 canvas-cinematic')
    expect(stylesheetEntry).toContain('@layer canvas-legacy, canvas-cinematic;')
    expect(stylesheetEntry).toContain("@import (less) '../CanvasWorkspaceView.less';")
    expect(stylesheetEntry).toContain("@import (less) '../canvasContextMenus.less';")
    expect(stylesheetEntry).not.toContain('uiux-v4/index.less')
    for (const moduleName of scopedModules) {
      expect(stylesheetEntry).toContain(`@import './${moduleName}';`)
      expect(readCanvasSource(`./cinematic/${moduleName}`)).toContain(
        '.canvas-workspace.canvas-cinematic',
      )
    }
  })

  it('renders the product node chrome and labeled primary creation actions', () => {
    const node = readCanvasSource('./CanvasNode.tsx')
    const addMenu = readCanvasSource('./CanvasAddNodeMenu.tsx')
    const dock = readCanvasSource('./CanvasBottomDock.tsx')
    const legacyStyles = readCanvasSource('./CanvasWorkspaceView.less')
    const nodeStyles = readCanvasSource('./cinematic/nodes.less')
    const panelStyles = readCanvasSource('./cinematic/agent.less')

    expect(node).toContain('canvas-node-content-title')
    expect(node).toContain('<div className="canvas-node-meta-bar">')
    expect(node).toContain('canvas-node-quick-footer')
    expect(node).toContain('shouldShowOutputNavigation')
    expect(node).not.toContain('双击可快速打开')
    expect(nodeStyles).toContain('.canvas-node-body > .canvas-node-operation')
    expect(nodeStyles).toContain(".canvas-stage[data-zoom-lod='overview']")
    expect(nodeStyles).toContain('flex-basis: 34px')
    expect(legacyStyles).not.toMatch(/\.canvas-node-task\s*\{[^}]*padding:\s*12px/s)
    expect(panelStyles).toContain('grid-column: 2')
    expect(panelStyles).toContain('.canvas-agent-side-panel-collapse-toggle.is-collapsed')
    expect(addMenu).toContain('canvas-dock-labeled-action')
    expect(dock).toContain('aria-label="全部节点类型"')
    expect(dock).not.toContain('shortLabel="资源"')
    expect(dock).not.toContain('shortLabel="任务"')
  })

  it('keeps workspace chrome, side panel, overlays and node editors in dedicated owners', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')
    const floatingToolbar = readCanvasSource('./CanvasFloatingNodeToolbar.tsx')
    const overlayBoundary = readCanvasSource('./CanvasOverlayBoundary.tsx')

    expect(workspace).toContain("import { CanvasWorkspaceChrome } from './CanvasWorkspaceChrome'")
    expect(workspace).toContain(
      "import { CanvasWorkspaceSidePanel } from './CanvasWorkspaceSidePanel'",
    )
    expect(workspace).toContain("import { CanvasNodeEditModal } from './CanvasNodeEditModal'")
    expect(workspace).toContain(
      "import { CanvasFloatingNodeToolbar } from './CanvasFloatingNodeToolbar'",
    )
    expect(workspace).not.toContain('function CanvasNodeEditModal(')
    expect(workspace).not.toContain('const CanvasFloatingNodeToolbar = memo')
    expect(floatingToolbar).toContain('onRenameNode')
    expect(floatingToolbar).toContain("menuButton('替换图片'")
    expect(overlayBoundary).toContain('data-canvas-overlay-host')
  })

  it('reserves the native traffic-light safe area in standalone macOS canvas windows', () => {
    const shellStyles = readCanvasSource('./cinematic/shell.less')

    expect(shellStyles).toContain(
      '.app.sidebar-hidden.platform-darwin & > .canvas-workspace-header',
    )
    expect(shellStyles).toMatch(
      /platform-darwin[^{}]*& > \.canvas-workspace-header\s*\{[^}]*padding-left:\s*92px/s,
    )
    expect(shellStyles).toContain('padding: 0 14px 0 16px')
  })

  it('uses one flat media frame for loaded and empty image/video nodes', () => {
    const node = readCanvasSource('./CanvasNode.tsx')
    const nodeStyles = readCanvasSource('./cinematic/nodes.less')

    expect(node).toContain('isFullBleedCanvasImageNode(node)')
    expect(node).toContain('canvasNodeUsesFlatMediaFrame(node)')
    expect(node).toContain('canvas-node-media-full-bleed')
    expect(node).toContain('canvas-node-image-full-bleed')
    expect(node).toContain('canvas-node-video-full-bleed')
    expect(node).toContain('canvas-node-image-overlay-footer')
    expect(nodeStyles).toContain('.canvas-node-media-full-bleed')
    expect(nodeStyles).toContain('.canvas-node-image-overlay-footer')
    expect(nodeStyles).toContain('background: linear-gradient(transparent, rgba(5, 7, 9, 0.84))')
  })

  it('keeps readable inset spacing on text nodes without affecting flat media frames', () => {
    const nodeStyles = readCanvasSource('./cinematic/nodes.less')

    expect(nodeStyles).toMatch(/\.canvas-node-text\s*\{[^}]*padding:\s*14px 16px 18px/s)
    expect(nodeStyles).toMatch(
      /\.canvas-node-text\.canvas-node-text-long\s*\{[^}]*padding:\s*18px 20px 22px/s,
    )
    expect(nodeStyles).toMatch(
      /\.canvas-node-media-full-bleed \.canvas-node-body\s*\{[^}]*inset:\s*0/s,
    )
  })

  it('renders a functional empty-canvas creation surface', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')
    const emptyState = readCanvasSource('./CanvasCinematicEmptyState.tsx')
    const shell = readCanvasSource('./cinematic/shell.less')

    expect(workspace).toContain('<CanvasCinematicEmptyState')
    expect(workspace).toContain("snapshot.nodes.length === 0 ? ' is-empty' : ''")
    expect(emptyState).toContain('今天想创造怎样的世界？')
    expect(emptyState).toContain('onStartWithAgent')
    expect(emptyState).toContain('onOpenWorkflowLibrary')
    expect(shell).toContain('.canvas-cinematic-empty')
    expect(shell).toContain('pointer-events: none')
  })

  it('keeps portal modal styling isolated to canvas business classes', () => {
    const legacyStyles = readCanvasSource('./CanvasWorkspaceView.less')

    expect(legacyStyles).toContain('.canvas-operation-preset-dialog .ant-modal-content')
    expect(legacyStyles).toContain('.canvas-node-edit-modal .ant-modal-body')
  })

  it('gives composite form controls a single visual surface owner', () => {
    const legacyStyles = readCanvasSource('./CanvasWorkspaceView.less')
    const storyboard = readCanvasSource('./CanvasShotScriptEditor.less')

    expect(legacyStyles).toContain('.canvas-operation-preset-dialog .ant-input-affix-wrapper')
    expect(legacyStyles).toContain(
      '.canvas-operation-preset-dialog .ant-input-affix-wrapper-focused',
    )
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

  it('keeps dedicated workbench owners and their macOS title-bar safe areas', () => {
    const workbenchStyles = readCanvasSource('./stage3d/stage3d.less')
    const videoWorkbench = readCanvasSource('./videoWorkbench/videoWorkbench.less')

    expect(workbenchStyles).toContain('.stage3d-field')
    expect(workbenchStyles).toContain('&.platform-darwin-safe-area')
    expect(videoWorkbench).toContain('.vwb-shell')
    expect(videoWorkbench).toContain('&.darwin')
  })
})
