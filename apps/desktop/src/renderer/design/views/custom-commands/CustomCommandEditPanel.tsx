import { useState } from 'react'
import { Button, Input, Segmented, TextArea } from '@lobehub/ui'
// TODO(lobe-migration): @lobehub/ui 没有 Switch 命名导出;从 antd 引用,与项目其他 view 保持一致
import { Switch } from 'antd'
import { Icons } from '../../Icons'
import {
  normalizeCustomCommandInput,
  type CustomCommandItem,
  type CustomCommandScriptLanguage,
} from './custom-command-model'

export function CustomCommandEditPanel({
  command,
  onClose,
  onSave,
}: {
  command: CustomCommandItem
  onClose: () => void
  onSave: (draft: CustomCommandItem) => void
}) {
  const [draft, setDraft] = useState(command)
  const patch = (next: Partial<CustomCommandItem>) =>
    setDraft((current) => ({ ...current, ...next }))
  const normalizedName = normalizeCustomCommandInput(draft.name)
  const canSave = normalizedName != null && (!!draft.prompt.trim() || !!draft.script.trim())

  return (
    <div className="slide-panel-backdrop" onClick={onClose}>
      <div
        className="slide-panel custom-command-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="slide-panel-h">
          <div className="h-icon">/</div>
          <div className="flex1">
            <div className="h-title">编辑自定义命令</div>
            <div className="h-sub">保存后可在会话输入框输入 / 搜索触发</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icons.X />
          </button>
        </div>
        <div className="slide-panel-body">
          <div className="custom-command-preview-strip">
            <span>预览</span>
            <code>{normalizedName ?? '/custom-plan'} 用户输入的参数</code>
          </div>
          <div className="form-grid">
            <label>
              命令名<span className="sub">例如 /custom-plan</span>
            </label>
            <Input
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="/custom-plan"
            />
            <label>
              描述<span className="sub">显示在斜杠命令列表</span>
            </label>
            <Input
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="生成一份可执行计划"
            />
            <label>启用</label>
            <Switch
              size="middle"
              checked={draft.enabled}
              onChange={(enabled) => patch({ enabled })}
            />
            <label>脚本语言</label>
            <Segmented
              value={draft.scriptLanguage}
              onChange={(value) => patch({ scriptLanguage: value as CustomCommandScriptLanguage })}
              options={[
                { label: 'JavaScript', value: 'javascript' },
                { label: 'Python', value: 'python' },
              ]}
            />
            <label>
              提示词<span className="sub">脚本成功后继续交给 Agent</span>
            </label>
            <TextArea
              value={draft.prompt}
              onChange={(event) => patch({ prompt: event.target.value })}
              placeholder="请基于用户输入输出分阶段计划，并列出风险和验证步骤。"
              className="rule-textarea custom-command-textarea"
            />
            <label>
              脚本<span className="sub">命令后的文本会作为第一个参数传入</span>
            </label>
            <TextArea
              value={draft.script}
              onChange={(event) => patch({ script: event.target.value })}
              placeholder={
                draft.scriptLanguage === 'python'
                  ? 'import sys\nprint(sys.argv[1] if len(sys.argv) > 1 else "")'
                  : 'const arg = process.argv[2] || ""\\nconsole.log(arg)'
              }
              className="rule-textarea custom-command-textarea"
            />
          </div>
        </div>
        <div className="slide-panel-foot">
          <span className="muted text-xs-12">
            {!canSave
              ? '需要有效命令名，并至少填写提示词或脚本。'
              : '脚本失败时不会继续执行提示词。'}
          </span>
          <span className="flex1" />
          <Button size="middle" type="text" onClick={onClose}>
            取消
          </Button>
          <Button size="middle" type="primary" disabled={!canSave} onClick={() => onSave(draft)}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
