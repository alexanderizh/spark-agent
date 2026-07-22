import { Icons } from '../../Icons'

export function WorkflowLoopBodyToolbar({
  workflowName,
  loopTitle,
  onBack,
}: {
  workflowName: string
  loopTitle: string
  onBack: () => void
}) {
  return (
    <div className="wf-loop-body-toolbar">
      <button type="button" className="wf-loop-back-button" title="返回主工作流" onClick={onBack}>
        <Icons.ArrowLeft size={12} />
        返回主工作流
      </button>
      <div className="wf-loop-breadcrumb" aria-label="当前编辑范围">
        <span>{workflowName}</span>
        <span aria-hidden="true">›</span>
        <strong>{loopTitle}</strong>
        <span aria-hidden="true">›</span>
        <span>循环体</span>
      </div>
    </div>
  )
}
