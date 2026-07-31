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
      'panel-rail.less',
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

  it('uses a neutral charcoal palette aligned with the creative workbench', () => {
    const tokens = readCanvasSource('./cinematic/tokens.less')
    const shell = readCanvasSource('./cinematic/shell.less')

    expect(tokens).toContain('--canvas-cinema-bg: #141414;')
    expect(tokens).toContain('--canvas-cinema-stage: #101010;')
    expect(tokens).toContain('--canvas-cinema-surface-1: #191919;')
    expect(tokens).toContain('--canvas-cinema-surface-2: #202020;')
    expect(shell).toContain('background: rgba(20, 20, 20, 0.97);')
    expect(shell).toContain('background: rgba(25, 25, 25, 0.94);')
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
    expect(panelStyles).toContain('.canvas-agent-side-panel.is-collapsed')
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
    expect(workspace).toContain("import { CanvasRightPanelRail } from './CanvasRightPanelRail'")
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

  it('uses one flat, persistent and mutually exclusive control rail for both right-side panels', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')
    const sidePanel = readCanvasSource('./CanvasWorkspaceSidePanel.tsx')
    const rail = readCanvasSource('./CanvasRightPanelRail.tsx')
    const railStyles = readCanvasSource('./cinematic/panel-rail.less')

    expect(workspace).toContain('<CanvasRightPanelRail')
    expect(sidePanel).not.toContain('canvas-side-panel-collapse-toggle')
    expect(rail).toContain('aria-label="右侧面板控制"')
    expect(rail).toContain('aria-pressed={open}')
    expect(rail).not.toContain('canvas-right-panel-switch-label')
    expect(rail).not.toContain('canvas-right-panel-switch-state')
    expect(workspace).toContain('setSidePanelCollapsed(true)')
    expect(workspace).toContain('setAgentOpen(false)')
    expect(railStyles).toContain('var(--canvas-agent-panel-width) + var(--canvas-side-panel-width)')
    expect(railStyles).toMatch(/\.canvas-right-panel-switch\s*\{[^}]*border:\s*0/s)
    expect(railStyles).toContain('.canvas-right-panel-switch.is-agent.is-open')
    expect(railStyles).toContain('.canvas-right-panel-switch.is-workspace.is-open')
  })

  it('uses a compact Agent width for new canvases and control-rail expansion', () => {
    const workspace = readCanvasSource('./CanvasWorkspaceView.tsx')

    expect(workspace).toContain('const CANVAS_AGENT_PANEL_DEFAULT_WIDTH = 420')
    expect(workspace).toContain(
      'setAgentPanelWidth((current) => Math.min(current, CANVAS_AGENT_PANEL_DEFAULT_WIDTH))',
    )
    expect(workspace).toContain('openAgentPanel({ constrainOversizedWidth: true })')
    expect(workspace).toMatch(
      /const toggleAgentPanel = useCallback\(\(\) => \{[\s\S]*openAgentPanel\(\{ constrainOversizedWidth: true \}\)/,
    )
  })

  it('removes the fake pointer avatar from canvas user messages while keeping agent identity', () => {
    const agentPanel = readCanvasSource('./CanvasAgentModal.tsx')
    const chatPanel = readCanvasSource('../../components/ChatPanel.tsx')
    const agentStyles = readCanvasSource('./cinematic/agent.less')

    expect(agentPanel).not.toContain('userAvatar=')
    expect(chatPanel).toContain('userAvatar != null')
    expect(chatPanel).toContain('未提供时不渲染用户头像区域')
    expect(chatPanel).not.toContain('<Icons.MousePointer size={14} />')
    expect(agentStyles).not.toMatch(/\.chat-panel-message-avatar\s*\{[^}]*display:\s*none/s)
  })

  it('makes the preset center a single full-bleed modal surface without a gray inner gutter', () => {
    const presetModal = readCanvasSource('./CanvasOperationPresetModal.tsx')
    const presetStyles = readCanvasSource('./CanvasPresetCenter.less')

    expect(presetModal).toContain("body: { height: '100%', padding: 0 }")
    expect(presetModal).toContain("container: { overflow: 'hidden', padding: 0 }")
    expect(presetStyles).toMatch(
      /\.canvas-operation-preset-modal-shell\s*\{[^}]*height:\s*100%[^}]*max-height:\s*none/s,
    )
  })

  it('reserves the native traffic-light safe area in standalone macOS canvas windows', () => {
    const shellStyles = readCanvasSource('./cinematic/shell.less')

    expect(shellStyles).toContain(
      '.app.sidebar-hidden.platform-darwin & > .canvas-workspace-header',
    )
    expect(shellStyles).toMatch(
      /platform-darwin[^{}]*& > \.canvas-workspace-header\s*\{[^}]*padding-left:\s*var\(--window-titlebar-safe-left\)/s,
    )
    expect(shellStyles).toContain('padding: 0 14px 0 16px')
  })

  it('keeps the save status readable and the Agent action at the standard control size', () => {
    const toolbar = readCanvasSource('./CanvasToolbar.tsx')
    const shellStyles = readCanvasSource('./cinematic/shell.less')

    expect(toolbar).toContain('Agent模式')
    expect(shellStyles).toMatch(
      /\.canvas-toolbar-savetag\s*\{[^}]*min-width:\s*74px[^}]*flex:\s*0 0 auto[^}]*white-space:\s*nowrap/s,
    )
    expect(shellStyles).toMatch(
      /\.canvas-toolbar \.canvas-toolbar-agent-button\s*\{[^}]*padding-inline:\s*8px/s,
    )
  })

  it('uses one Agent glyph across canvas entry points', () => {
    const icons = readCanvasSource('../../Icons.tsx')
    const toolbar = readCanvasSource('./CanvasToolbar.tsx')
    const dock = readCanvasSource('./CanvasBottomDock.tsx')
    const rail = readCanvasSource('./CanvasRightPanelRail.tsx')

    expect(icons).toContain('Agent: (p: IconProps)')
    expect(toolbar).toContain('icon={<Icons.Agent size={15} />}')
    expect(dock).toContain('icon={<Icons.Agent size={15} />}')
    expect(rail).toContain("accent === 'agent' ? Icons.Agent : Icons.PanelRight")
  })

  it('owns zoom controls with canvas-scoped flat styling instead of React Flow theme classes', () => {
    const controls = readCanvasSource('./CanvasZoomControls.tsx')
    const shellStyles = readCanvasSource('./cinematic/shell.less')

    expect(controls).toContain('className="canvas-controls-button"')
    expect(controls).not.toContain('react-flow__controls-button')
    expect(controls).toContain('aria-pressed={!isInteractive}')
    expect(controls).toContain('canvas-controls-minimap')
    expect(controls).toContain('onClick={onToggleMinimap}')
    expect(shellStyles).toMatch(
      /\.canvas-controls \.canvas-controls-button\s*\{[^}]*background:\s*transparent[^}]*color:\s*var\(--canvas-cinema-text-muted\)/s,
    )
    expect(shellStyles).toMatch(
      /\.canvas-controls \.canvas-controls-button:disabled\s*\{[^}]*background:\s*transparent/s,
    )
    expect(shellStyles).toContain('.canvas-controls .canvas-controls-interactive.is-locked')
    expect(shellStyles).toMatch(
      /\.canvas-controls\s*\{[^}]*right:\s*14px !important[^}]*bottom:\s*10px !important[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
    )
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
    expect(emptyState).toContain('onSubmitAgentPrompt')
    expect(emptyState).toContain('<form className="canvas-cinematic-command"')
    expect(emptyState).toContain('aria-label="向画布 Agent 发送消息"')
    expect(emptyState).toContain('onOpenWorkflowLibrary')
    expect(shell).toContain('.canvas-cinematic-empty')
    expect(shell).toContain('pointer-events: none')
  })

  it('lays out node footer metadata and the edit action on opposite sides', () => {
    const nodeStyles = readCanvasSource('./cinematic/nodes.less')

    expect(nodeStyles).toMatch(
      /\.canvas-node-quick-footer\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*space-between;/,
    )
    expect(nodeStyles).toMatch(
      /\.canvas-node-quick-footer button\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/,
    )
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
    const shellStyles = readCanvasSource('./cinematic/shell.less')
    const workbenchStyles = readCanvasSource('./stage3d/stage3d.less')
    const videoWorkbench = readCanvasSource('./videoWorkbench/videoWorkbench.less')
    const annotationStyles = readCanvasSource(
      './image-annotation/CanvasImageAnnotationWorkspace.less',
    )

    expect(shellStyles).toMatch(/\.canvas-toolbar\s*\{[^}]*z-index:\s*auto/s)
    expect(workbenchStyles).toContain('.stage3d-field')
    expect(workbenchStyles).toContain('&.platform-darwin-safe-area')
    expect(workbenchStyles).toContain('background: var(--stage3d-topbar-bg)')
    expect(workbenchStyles).toMatch(
      /\.app\.platform-darwin \.stage3d-modal-overlay[^{}]*\{[^}]*padding-left:\s*var\(--window-titlebar-safe-left\)/s,
    )
    expect(videoWorkbench).toContain('.vwb-shell')
    expect(videoWorkbench).toContain('&.darwin')
    expect(annotationStyles).toMatch(
      /\.canvas-image-annotation-workspace\.is-mac \.canvas-annotation-topbar\s*\{[^}]*padding-left:\s*var\(--window-titlebar-safe-left\)/s,
    )
  })
})
