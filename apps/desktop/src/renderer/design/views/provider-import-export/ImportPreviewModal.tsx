/**
 * ImportPreviewModal — Provider 导入预览对话框
 *
 * 职责：
 *   1. 展示 ExportPayload 的元信息（版本、导出时间、profile 总数）
 *   2. 列出每个 profile，标记是否与本地 name 冲突
 *   3. 让用户选择 merge / replace 模式
 *   4. 确认后调用 onConfirm(payload, mode)
 *   5. ESC/点遮罩关闭由 Arco Modal 内建处理
 *
 * UI：Arco Modal + Radio.Group + Tag；样式落在 ProvidersView.less (.pv_import_*)。
 */
import { useMemo, useState } from 'react'
import { Radio } from 'antd'
import { Button, Modal, Tag } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { ProviderExportPayload, ProviderImportMode } from '@spark/protocol'

export interface ImportPreviewModalProps {
  payload: ProviderExportPayload
  filePath: string
  /** 本地已有的 profile name 集合（用来标记冲突）*/
  existingNames: Set<string>
  onConfirm: (payload: ProviderExportPayload, mode: ProviderImportMode) => void | Promise<void>
  onClose: () => void
}

function ImportPreviewModal({
  payload,
  filePath,
  existingNames,
  onConfirm,
  onClose,
}: ImportPreviewModalProps) {
  const [mode, setMode] = useState<ProviderImportMode>('merge')
  const [submitting, setSubmitting] = useState(false)

  const conflictCount = useMemo(
    () => payload.profiles.filter((p) => existingNames.has(p.name)).length,
    [payload, existingNames],
  )

  const handleConfirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm(payload, mode)
    } finally {
      setSubmitting(false)
    }
  }

  const exportedAt = useMemo(() => {
    try {
      return new Date(payload.exportedAt).toLocaleString()
    } catch {
      return payload.exportedAt
    }
  }, [payload.exportedAt])

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <Icons.Upload style={{ fontSize: 16, color: 'var(--primary)' }} />
          <span>导入 Provider 配置</span>
        </div>
      }
      open
      onCancel={onClose}
      maskClosable={!submitting}
      closable={!submitting}
      style={{ width: 680 }}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="text" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            onClick={() => void handleConfirm()}
            disabled={submitting || payload.profiles.length === 0}
            loading={submitting}
            icon={<Icons.Upload />}
          >
            {`确认导入 ${payload.profiles.length} 个`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 文件元信息 */}
        <div className="pv_import_meta">
          <div>
            <span className="pv_muted">文件：</span>
            <span className="pv_mono" title={filePath}>{filePath || '从剪贴板'}</span>
          </div>
          <div>
            <span className="pv_muted">版本：</span>
            <span className="pv_mono">v{payload.version}</span>
          </div>
          <div>
            <span className="pv_muted">导出时间：</span>
            <span className="pv_mono">{exportedAt}</span>
          </div>
          <div>
            <span className="pv_muted">来源：</span>
            <span className="pv_mono">{payload.exportedBy}</span>
          </div>
          <div>
            <span className="pv_muted">Profile 数：</span>
            <span className="pv_mono"><strong>{payload.profiles.length}</strong></span>
          </div>
          {conflictCount > 0 && (
            <div className="pv_import_conflict_warn">
              <Icons.AlertTriangle style={{ fontSize: 12 }} />
              {conflictCount} 个 name 与本地冲突
            </div>
          )}
        </div>

        {/* 冲突模式选择 */}
        <div className="pv_import_mode_row">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>冲突处理：</span>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as ProviderImportMode)}
            disabled={submitting}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Radio value="merge">
              <strong>合并</strong>
              <span style={{ color: 'var(--text-muted)' }}> · 跳过已存在的 name</span>
            </Radio>
            <Radio value="replace">
              <strong>覆盖</strong>
              <span style={{ color: 'var(--text-muted)' }}> · 用导入的字段更新已存在 profile</span>
            </Radio>
          </Radio.Group>
        </div>

        {/* Profile 列表 */}
        <div className="pv_import_list_header">
          <span>Name</span>
          <span>Provider</span>
          <span>默认模型</span>
          <span className="text-right">状态</span>
        </div>
        <div className="pv_import_list">
          {payload.profiles.length === 0 && (
            <div className="pv_import_empty">该文件不含任何 profile</div>
          )}
          {payload.profiles.map((p, idx) => {
            const conflict = existingNames.has(p.name)
            return (
              <div
                key={`${p.name}-${idx}`}
                className={`pv_import_list_row${conflict ? ' pv_conflict' : ''}`}
              >
                <span className="pv_cell_name" title={p.name}>
                  {p.name}
                </span>
                <span>
                  <Tag color={p.provider === 'anthropic' ? 'purple' : 'blue'}>
                    {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                  </Tag>
                </span>
                <span className="pv_cell_model" title={p.defaultModel}>
                  {p.defaultModel}
                </span>
                <span className="pv_cell_status">
                  {conflict ? (
                    <Tag color="orange">将更新</Tag>
                  ) : (
                    <Tag color="green">将新增</Tag>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <div className="pv_import_tip">
          <Icons.AlertTriangle style={{ fontSize: 12, flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>API Key 将随导入一并恢复</strong>。
            若导出文件中包含 API Key，导入时会自动写入本地 Keychain；
            未包含 API Key 的 profile 需要去编辑面板补 Key 才能 health-check。
          </span>
        </div>
      </div>
    </Modal>
  )
}

export default ImportPreviewModal
