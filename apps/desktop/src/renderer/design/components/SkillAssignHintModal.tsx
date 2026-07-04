import { Modal, Button } from '@lobehub/ui'
import { Icons } from '../Icons'
import './SkillAssignHintModal.less'

export interface SkillAssignHintModalProps {
  open: boolean
  /** 单 skill 模式:显示该 skill 名称;multi 模式:显示首个 skill 名称(可忽略) */
  skillName: string
  /**
   * 多 skill 模式:同一批还就绪的额外 skill 数量(不含 skillName 本身)。
   * > 0 时,标题与按钮文案会切换为「N 个 Skill 已就绪 / 去已安装」。
   */
  extraCount?: number | undefined
  /** 点击「分配给 Agent / 去已安装」 */
  onAssign: () => void
  /** 关闭 / 「稍后」 */
  onClose: () => void
}

/**
 * SkillAssignHintModal —— 新增技能成功后的兜底提醒。
 * 提示用户：Skill 必须分配给 Agent 才能在对话中生效，避免「装了忘配」。
 */
export function SkillAssignHintModal({
  open,
  skillName,
  extraCount,
  onAssign,
  onClose,
}: SkillAssignHintModalProps) {
  const isMulti = (extraCount ?? 0) > 0
  const total = isMulti ? (extraCount ?? 0) + 1 : 1
  const title = isMulti ? `${total} 个 Skill 已就绪` : `技能「${skillName}」已就绪`
  const desc = isMulti
    ? `同一批安装的 ${total} 个 Skill 都还未分配给 Agent,请在「已安装」中为它们逐一配置。`
    : 'Skills 需要分配给 Agent 才能在对话中生效。是否现在选择要使用的 Agent？'
  const assignLabel = isMulti ? '去已安装' : '分配给 Agent'
  return (
    <Modal
      open={open}
      title={null}
      closable={false}
      onCancel={onClose}
      footer={null}
      className="skill-assign-hint-modal"
      style={{ width: 440 }}
      destroyOnHidden
    >
      <div className="skill-assign-hint-body">
        <div className="skill-assign-hint-icon">
          <Icons.Skills size={22} />
        </div>
        <div className="skill-assign-hint-title">{title}</div>
        <div className="skill-assign-hint-desc">{desc}</div>
        <div className="skill-assign-hint-actions">
          <Button type="text" onClick={onClose}>
            稍后
          </Button>
          <Button type="primary" icon={<Icons.Bot size={14} />} onClick={onAssign}>
            {assignLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
