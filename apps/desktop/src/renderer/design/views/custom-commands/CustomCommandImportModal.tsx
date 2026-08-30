/**
 * CustomCommandImportModal — 自定义命令导入预览对话框
 *
 * 职责：
 *   1. 展示导入文件的元信息（版本、导出时间、有效/无效条目数）
 *   2. 逐条列出命令并标记与本地同名冲突、名称非法被丢弃的条目
 *   3. 让用户选择冲突处理模式（跳过 / 覆盖），确认后回调 onConfirm
 *
 * 样式落在 styles/views.css（.custom-command-import-*）。
 */
import { useMemo, useState } from 'react'
import { Radio } from 'antd'
import { Button, Modal, Tag } from '@lobehub/ui'
import { Icons } from '../../Icons'
import {
  normalizeCustomCommandInput,
  type CustomCommandImportMode,
  type CustomCommandImportParseResult,
} from './custom-command-model'

export interface CustomCommandImportModalProps {
  parseResult: CustomCommandImportParseResult
  filePath: string
  /** 本地已有命令（规范化后）名称集合，用来标记冲突 */
  existingNames: Set<string>
  onConfirm: (mode: CustomCommandImportMode) => void | Promise<void>
  onClose: () => void
}

function CustomCommandImportModal({
  parseResult,
  filePath,
  existingNames,
  onConfirm,
  onClose,
}: CustomCommandImportModalProps) {
  const [mode, setMode] = useState<CustomCommandImportMode>('skip')
  const [submitting, setSubmitting] = useState(false)

  const conflictCount = useMemo(
    () => parseResult.accepted.filter((item) => existingNames.has(item.name)).length,
    [parseResult, existingNames],
  )
  const validCount = parseResult.accepted.length

  const handleConfirm = async () => {
    if (submitting || validCount === 0) return
    setSubmitting(true)
    try {
      await onConfirm(mode)
    } finally {
      setSubmitting(false)
    }
  }

  const exportedAt = useMemo(() => {
    if (parseResult.exportedAt == null) return '—'
    const time = Date.parse(parseResult.exportedAt)
    return Number.isFinite(time) ? new Date(time).toLocaleString() : parseResult.exportedAt
  }, [parseResult.exportedAt])

  return (
    <Modal
      title={
        <div className="row gap-8">
          <Icons.Upload size={16} className="color-primary" />
          <span>导入自定义命令</span>
        </div>
      }
      open
      onCancel={onClose}
      maskClosable={!submitting}
      closable={!submitting}
      style={{ width: 640 }}
      footer={
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          <Button type="text" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            onClick={() => void handleConfirm()}
            disabled={submitting || validCount === 0}
            loading={submitting}
            icon={<Icons.Upload size={13} />}
          >
            确认导入 {validCount} 个
          </Button>
        </div>
      }
    >
      <div className="custom-command-import">
        <div className="custom-command-import-meta">
          <div>
            <span className="muted">文件：</span>
            <span className="custom-command-import-mono" title={filePath}>
              {filePath}
            </span>
          </div>
          <div>
            <span className="muted">版本：</span>
            <span className="custom-command-import-mono">
              {parseResult.version == null ? '—' : `v${parseResult.version}`}
            </span>
          </div>
          <div>
            <span className="muted">导出时间：</span>
            <span className="custom-command-import-mono">{exportedAt}</span>
          </div>
          <div>
            <span className="muted">有效命令：</span>
            <span className="custom-command-import-mono">
              <strong>{validCount}</strong> 个
            </span>
          </div>
          {conflictCount > 0 && (
            <div className="custom-command-import-warn">
              <Icons.AlertTriangle size={12} />
              {conflictCount} 个命令与本地同名
            </div>
          )}
        </div>

        {validCount > 0 && (
          <div className="custom-command-import-mode">
            <span className="muted text-xs-12">同名冲突处理：</span>
            <Radio.Group
              value={mode}
              onChange={(event) => setMode(event.target.value as CustomCommandImportMode)}
              disabled={submitting}
            >
              <Radio value="skip">
                <strong>跳过</strong>
                <span className="muted"> · 保留本地版本，不导入同名命令</span>
              </Radio>
              <Radio value="overwrite">
                <strong>覆盖</strong>
                <span className="muted"> · 用导入的命令替换本地同名命令</span>
              </Radio>
            </Radio.Group>
          </div>
        )}

        <div className="custom-command-import-list">
          {parseResult.accepted.map((item, index) => {
            const conflict = existingNames.has(normalizeCustomCommandInput(item.name) ?? item.name)
            return (
              <div key={`${item.id}-${index}`} className="custom-command-import-row">
                <span className="custom-command-import-name" title={item.name}>
                  {item.name}
                </span>
                <span className="custom-command-import-desc" title={item.description}>
                  {item.description || '未填写描述'}
                </span>
                {conflict ? (
                  <Tag color="orange">{mode === 'overwrite' ? '将覆盖' : '将跳过'}</Tag>
                ) : (
                  <Tag color="green">将新增</Tag>
                )}
              </div>
            )
          })}
          {parseResult.rejected.map((item, index) => (
            <div key={`rejected-${index}`} className="custom-command-import-row invalid">
              <span className="custom-command-import-name" title={item.name}>
                {item.name}
              </span>
              <span className="custom-command-import-desc">{item.reason}</span>
              <Tag color="red">已忽略</Tag>
            </div>
          ))}
          {validCount === 0 && parseResult.rejected.length === 0 && (
            <div className="custom-command-import-empty">该文件不含任何自定义命令</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default CustomCommandImportModal
