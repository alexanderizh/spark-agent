import { Icons } from '../../Icons'

export function CanvasCinematicEmptyState({
  onStartWithAgent,
  onOpenInlineAi,
  onUploadFiles,
  onOpenWorkflowLibrary,
}: {
  onStartWithAgent: () => void
  onOpenInlineAi: () => void
  onUploadFiles: () => void
  onOpenWorkflowLibrary: () => void
}) {
  return (
    <section className="canvas-cinematic-empty" aria-label="空画布创作引导">
      <div className="canvas-cinematic-empty-inner">
        <span className="canvas-cinematic-empty-kicker">
          <Icons.Sparkles size={13} />
          从一句话开始，也可以拖入素材
        </span>
        <h1>今天想创造怎样的世界？</h1>
        <p>Agent 会把故事拆成角色、场景、分镜和生成任务，并在画布中保留完整创作脉络。</p>

        <button type="button" className="canvas-cinematic-command" onClick={onStartWithAgent}>
          <Icons.Sparkles size={17} />
          <span>描述故事、粘贴剧本，或输入 / 调用一个创作工作流…</span>
          <span className="canvas-cinematic-command-send" aria-hidden="true">
            <Icons.ArrowRight size={16} />
          </span>
        </button>

        <div className="canvas-cinematic-starters">
          <button type="button" onClick={onOpenInlineAi}>
            <Icons.Film size={16} />
            <span>
              <strong>从剧本生成分镜</strong>
              <small>自动提取角色、场景与关键镜头</small>
            </span>
          </button>
          <button type="button" onClick={onOpenWorkflowLibrary}>
            <Icons.Workflow size={16} />
            <span>
              <strong>使用创作工作流</strong>
              <small>从预设流程快速搭建生产链路</small>
            </span>
          </button>
          <button type="button" onClick={onUploadFiles}>
            <Icons.Upload size={16} />
            <span>
              <strong>导入已有素材</strong>
              <small>让 Agent 整理图片、视频和参考风格</small>
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}
