import { Modal } from 'antd'
import { Icons } from '../../Icons'
import { getNodeKindMeta } from './node-kinds'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from './workflow-templates'

/**
 * 工作流模板库选择器：以卡片网格展示全部预置模板，
 * 用户点击卡片即将该模板的 graph 作为新工作流草稿导入画布。
 *
 * 卡片复用列表卡片的 workflow-card-node 路由缩略样式，保持视觉一致。
 */
export function WorkflowTemplatePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (template: WorkflowTemplate) => void
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <span className="wf-template-picker-title">
          <Icons.Layers size={16} />
          工作流模板库
          <span className="wf-template-picker-sub">点击卡片即可创建一份可编辑的工作流草稿</span>
        </span>
      }
      footer={null}
      width={900}
      className="wf-template-picker"
    >
      <div className="wf-template-grid">
        {WORKFLOW_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="wf-template-card"
            onClick={() => onPick(template)}
          >
            <span className="wf-template-card-head">
              <span className="wf-template-card-name">{template.name}</span>
              <span className="wf-template-card-tags">
                {template.tags.map((tag) => (
                  <span key={tag} className="wf-template-tag">{tag}</span>
                ))}
              </span>
            </span>
            <span className="wf-template-card-desc">{template.description}</span>
            {template.needsBinding ? (
              <span className="wf-template-card-binding">
                <Icons.AlertTriangle size={12} />
                {template.needsBinding}
              </span>
            ) : null}
            <span className="wf-template-card-route">
              {template.graph.nodes.map((node) => {
                const meta = getNodeKindMeta(node.kind)
                return (
                  <span
                    key={node.id}
                    className="workflow-card-node"
                    style={{ ['--node-accent' as string]: `var(${meta.accent})` }}
                    title={`${node.title} · ${meta.runtimeLabel}`}
                  >
                    {meta.icon}
                  </span>
                )
              })}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
