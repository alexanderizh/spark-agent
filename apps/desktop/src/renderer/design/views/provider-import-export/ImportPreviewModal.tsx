/**
 * ImportPreviewModal — Provider 导入预览对话框
 *
 * 职责：
 *   1. 展示 ExportPayload 的元信息（版本、导出时间、profile 总数）
 *   2. 列出每个 profile，标记是否与本地 name 冲突
 *   3. 让用户选择 merge / replace 模式
 *   4. 确认后调用 onConfirm(payload, mode)
 *   5. 支持 ESC 关闭
 *   6. 焦点管理：打开时聚焦容器、关闭时回调 onClose
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
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
  const containerRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // 打开时聚焦到取消按钮，确保 ESC 不会触发误操作
  useEffect(() => {
    cancelButtonRef.current?.focus()
  }, [])

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
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="导入 Provider 预览"
    >
      <div
        ref={containerRef}
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <Icons.Upload size={16} />
          </div>
          <div className="flex1">
            <div className="modal-title">导入 Provider 配置</div>
            <div className="modal-sub">
              {filePath || '从剪贴板'}
              {' · '}
              {payload.profiles.length} 个 profile
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icons.X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="import-meta">
            <div>
              <span className="muted">版本：</span>
              <span className="mono-sm">v{payload.version}</span>
            </div>
            <div>
              <span className="muted">导出时间：</span>
              <span className="mono-sm">{exportedAt}</span>
            </div>
            <div>
              <span className="muted">来源：</span>
              <span className="mono-sm">{payload.exportedBy}</span>
            </div>
            {conflictCount > 0 && (
              <div className="text-warning">
                <Icons.AlertTriangle size={11} />{' '}
                {conflictCount} 个 name 与本地冲突
              </div>
            )}
          </div>

          <div className="import-mode-row">
            <span className="muted">冲突处理：</span>
            <label className="radio-row">
              <input
                type="radio"
                name="import-mode"
                value="merge"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
              />
              <span>
                <strong>合并</strong>
                <span className="muted"> · 跳过已存在的 name</span>
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              <span>
                <strong>覆盖</strong>
                <span className="muted"> · 用导入的字段更新已存在 profile</span>
              </span>
            </label>
          </div>

          <div className="import-list-header">
            <span>Name</span>
            <span>Provider</span>
            <span>默认模型</span>
            <span>状态</span>
          </div>
          <div className="import-list">
            {payload.profiles.length === 0 && (
              <div className="empty-placeholder">该文件不含任何 profile</div>
            )}
            {payload.profiles.map((p, idx) => {
              const conflict = existingNames.has(p.name)
              return (
                <div
                  key={`${p.name}-${idx}`}
                  className={`import-list-row${conflict ? ' conflict' : ''}`}
                >
                  <span className="cell-name" title={p.name}>
                    {p.name}
                  </span>
                  <span className={`preset-format-dot ${p.provider}`} title={p.provider} />
                  <span className="cell-model mono-sm" title={p.defaultModel}>
                    {p.defaultModel}
                  </span>
                  <span className="cell-status">
                    {conflict ? (
                      <span className="badge warning dot">将更新</span>
                    ) : (
                      <span className="badge success dot">将新增</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="alert-banner info">
            <Icons.AlertTriangle size={12} />
            <span>
              出于安全考虑，<strong>API Key 不会随导入一并恢复</strong>。
              新增的 profile 需要去编辑面板补 Key 才能 health-check。
            </span>
          </div>
        </div>

        <div className="modal-footer">
          <span className="flex1" />
          <button
            ref={cancelButtonRef}
            className="btn"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            className="btn primary"
            onClick={handleConfirm}
            disabled={submitting || payload.profiles.length === 0}
          >
            <Icons.Upload size={12} />{' '}
            {submitting
              ? '导入中…'
              : `确认导入 ${payload.profiles.length} 个`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImportPreviewModal
