import { Button } from '@lobehub/ui'
import type { CanvasSnapshot, StepStudioStageKey } from '../canvas.types'
import type { CanvasWindowTheme } from '../canvas-window-theme'
import { Icons } from '../../../Icons'
import { SidebarExpandButton } from '../../../SidebarExpandButton'
import { WindowControls } from '../../../components/WindowControls'
import { StepModeSwitcher } from './StepModeSwitcher'
import { StepSetupView, type StepSetupViewProps } from './StepSetupView'
import { StepStoryboardView, type StepStoryboardViewProps } from './StepStoryboardView'
import { StepAssemblyView, type StepAssemblyViewProps } from './StepAssemblyView'
import { readStepStudioState } from './stepStudioMeta'
import './stepStudio.less'

/**
 * 步骤模式（Step Studio）三步向导骨架（P3 交付）。
 *
 * 结构（设计 §5.0）：顶栏（返回 + 项目名 + 三步导航 + 模式切换器）/
 * 主内容区。三步内容分别为 P4（设定）、P5（分镜）、
 * P6（视频）交付，本层只提供骨架与步骤切换持久化（metadata.stepStudio.activeStep）。
 *
 * 渲染在 CanvasWorkspaceView 内部（store/会话等上层上下文保持单例），
 * 处于 .canvas-workspace.canvas-cinematic 作用域，直接消费 cinema token。
 */

interface StepStageDef {
  index: number
  title: string
}

/** 步骤顺序（顶栏导航按此渲染） */
const STAGE_ORDER: readonly StepStudioStageKey[] = ['setup', 'storyboard', 'assembly']

/** 按 key 索引的步骤定义（键穷尽，索引取值类型层无 undefined） */
const STAGE_BY_KEY: Record<StepStudioStageKey, StepStageDef> = {
  setup: {
    index: 1,
    title: '设定',
  },
  storyboard: {
    index: 2,
    title: '分镜',
  },
  assembly: {
    index: 3,
    title: '视频',
  },
}

export function StepStudioView({
  projectTitle,
  activeStep,
  snapshot,
  setupActions,
  storyboardActions,
  assemblyActions,
  onSelectStep,
  onSwitchToCanvas,
  onBack,
  showSidebarExpandButton = false,
  showWindowControls = false,
  windowTheme,
  onWindowThemeChange,
}: {
  projectTitle: string
  activeStep: StepStudioStageKey
  /** 项目快照（设定/分镜视图的数据源与刷新依据） */
  snapshot: CanvasSnapshot
  /** 设定步骤依赖的资产/任务操作（store 包装层，projectId/snapshot 由本层注入） */
  setupActions: Omit<StepSetupViewProps, 'projectId' | 'snapshot'>
  /** 分镜步骤依赖的任务/状态写操作（P5） */
  storyboardActions: Omit<StepStoryboardViewProps, 'projectId' | 'snapshot'>
  /** 视频步骤依赖的组装/工作台操作（P6；assemblyNodeId 从 snapshot 派生） */
  assemblyActions: Omit<StepAssemblyViewProps, 'snapshot' | 'assemblyNodeId'>
  onSelectStep: (step: StepStudioStageKey) => void
  onSwitchToCanvas: () => void
  onBack: () => void | Promise<void>
  showSidebarExpandButton?: boolean
  showWindowControls?: boolean
  windowTheme?: CanvasWindowTheme
  onWindowThemeChange?: (theme: CanvasWindowTheme) => void
}) {
  const activeIndex = STAGE_ORDER.indexOf(activeStep)

  return (
    <div className="step-studio-root">
      <header
        className="step-studio-header"
        onDoubleClick={() => {
          // 与画布模式顶栏一致：双击拖拽区在最大化 / 还原间切换。
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        <div className="step-studio-title">
          {showSidebarExpandButton && (
            <span className="step-studio-sidebar-expand">
              <SidebarExpandButton />
            </span>
          )}
          <Button size="middle" type="text" icon={<Icons.ArrowLeft size={15} />} onClick={onBack}>
            项目
          </Button>
          <div className="step-studio-heading">
            <h2>{projectTitle}</h2>
            <span className="step-studio-mode-tag">步骤模式</span>
          </div>
        </div>

        <nav className="step-studio-stage-nav" aria-label="创作步骤">
          {STAGE_ORDER.map((key, i) => {
            const stage = STAGE_BY_KEY[key]
            return (
              <span key={key} className="step-studio-stage-nav-item">
                {i > 0 && <span className="step-studio-stage-connector" aria-hidden />}
                <button
                  type="button"
                  className={[
                    'step-studio-stage',
                    key === activeStep ? 'is-active' : '',
                    i < activeIndex ? 'is-visited' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={key === activeStep ? 'step' : undefined}
                  onClick={() => onSelectStep(key)}
                >
                  <span className="step-studio-stage-index">{stage.index}</span>
                  <span className="step-studio-stage-title">{stage.title}</span>
                </button>
              </span>
            )
          })}
        </nav>

        <div className="step-studio-header-side">
          <StepModeSwitcher mode="step" onSwitch={() => onSwitchToCanvas()} />
          {windowTheme != null && onWindowThemeChange != null ? (
            <div className="canvas-window-theme-switcher" role="group" aria-label="画布窗口主题">
              <button
                type="button"
                className={`canvas-window-theme-option${windowTheme === 'light' ? ' is-active' : ''}`}
                aria-label="浅色模式"
                aria-pressed={windowTheme === 'light'}
                title="浅色模式"
                onClick={() => onWindowThemeChange('light')}
              >
                <Icons.Sun size={14} />
              </button>
              <button
                type="button"
                className={`canvas-window-theme-option${windowTheme === 'dark' ? ' is-active' : ''}`}
                aria-label="暗色模式"
                aria-pressed={windowTheme === 'dark'}
                title="暗色模式"
                onClick={() => onWindowThemeChange('dark')}
              >
                <Icons.Moon size={14} />
              </button>
            </div>
          ) : null}
          {showWindowControls ? (
            <span className="step-studio-window-controls">
              <WindowControls />
            </span>
          ) : null}
        </div>
      </header>

      <div className="step-studio-body">
        <main className="step-studio-main">
          {activeStep === 'setup' ? (
            <StepSetupView
              projectId={snapshot.project.id}
              snapshot={snapshot}
              onCreateFilmAsset={setupActions.onCreateFilmAsset}
              onUploadImageAsset={setupActions.onUploadImageAsset}
              onCreateMediaTask={setupActions.onCreateMediaTask}
              refreshSnapshot={setupActions.refreshSnapshot}
            />
          ) : activeStep === 'storyboard' ? (
            <StepStoryboardView
              projectId={snapshot.project.id}
              snapshot={snapshot}
              onCreateMediaTask={storyboardActions.onCreateMediaTask}
              onUpdateState={storyboardActions.onUpdateState}
              refreshSnapshot={storyboardActions.refreshSnapshot}
            />
          ) : (
            <StepAssemblyView
              snapshot={snapshot}
              assemblyNodeId={readStepStudioState(snapshot.project)?.assemblyNodeId ?? null}
              onAssemble={assemblyActions.onAssemble}
              onOpenWorkbench={assemblyActions.onOpenWorkbench}
            />
          )}
        </main>
      </div>
    </div>
  )
}
