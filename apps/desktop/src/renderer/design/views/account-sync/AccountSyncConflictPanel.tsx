import { useState } from 'react'
import { Button, Radio } from 'antd'
import type {
  AccountSyncCategory,
  AccountSyncConflictSide,
  AccountSyncConflictSideInfo,
  AccountSyncExecuteResponse,
  AccountSyncPreviewResult,
} from '@spark/protocol'
import { useToast } from '../../components/Toast'
import { CATEGORY_META } from './account-sync-meta'
import { formatTime } from './account-sync-format'
import { translateSyncErrorCodes } from './sync-error-messages'
import './AccountSyncConflictPanel.less'

interface AccountSyncConflictPanelProps {
  /** 同步链路不可用（未登录 / 未开启 / 未选类别 / 同步中）时整体禁用 */
  disabled: boolean
  /** 应用选择执行成功后回调，父组件据此刷新本次结果、外观与历史 */
  onApplied: (response: AccountSyncExecuteResponse) => void
  /** 面板自身执行中状态上抛，父组件用于合并同步按钮禁用 */
  onSyncingChange?: (syncing: boolean) => void
}

/** 冲突条目在请求中的复合键：category/itemId（跨类别时 itemId 不唯一） */
function conflictKey(category: AccountSyncCategory, itemId: string): string {
  return `${category}/${itemId}`
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function sideTime(side: AccountSyncConflictSideInfo | null): string {
  if (side == null) return '—'
  return side.deleted ? '已删除' : formatTime(side.updatedAt)
}

function sidePreview(side: AccountSyncConflictSideInfo | null): string {
  return side != null && !side.deleted ? side.preview : ''
}

function readChoiceSide(value: unknown): AccountSyncConflictSide | null {
  return value === 'local' || value === 'cloud' ? value : null
}

export function AccountSyncConflictPanel({
  disabled,
  onApplied,
  onSyncingChange,
}: AccountSyncConflictPanelProps): React.ReactElement {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewResult, setPreviewResult] = useState<AccountSyncPreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, AccountSyncConflictSide>>({})
  const [applying, setApplying] = useState(false)

  const handlePreview = async (): Promise<void> => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const result = await window.spark.invoke('account-sync:preview', {})
      setPreviewResult(result)
      setChoices({})
      setOpen(true)
    } catch (error) {
      setPreviewError(getErrorMessage(error, '冲突预览失败'))
      setOpen(true)
    } finally {
      setPreviewLoading(false)
    }
  }

  const setAllChoices = (side: AccountSyncConflictSide): void => {
    if (previewResult == null) return
    const next: Record<string, AccountSyncConflictSide> = {}
    for (const group of previewResult.conflicts) {
      for (const item of group.items) {
        next[conflictKey(group.category, item.id)] = side
      }
    }
    setChoices(next)
  }

  const handleApply = async (): Promise<void> => {
    setApplying(true)
    onSyncingChange?.(true)
    try {
      const response = await window.spark.invoke('account-sync:execute', {
        conflictChoices: choices,
      })
      onApplied(response)
      setOpen(false)
      setPreviewResult(null)
      setChoices({})
    } catch (error) {
      toast.error(getErrorMessage(error, '应用选择并同步失败'))
    } finally {
      setApplying(false)
      onSyncingChange?.(false)
    }
  }

  const choiceCount = Object.keys(choices).length

  const categoryErrorCodes: Map<AccountSyncCategory, string[]> = new Map()
  if (previewResult != null) {
    for (const category of previewResult.categories) {
      if (category.errorCode != null) {
        categoryErrorCodes.set(category.category, translateSyncErrorCodes([category.errorCode]))
      }
    }
  }

  return (
    <div className="account-sync-conflict">
      <div className="account-sync-conflict-entry">
        <Button
          loading={previewLoading}
          disabled={disabled || applying}
          onClick={() => void handlePreview()}
        >
          预览并处理冲突
        </Button>
        <span className="account-sync-conflict-entry-hint">
          先查看本机与云端同时修改的条目，再决定保留哪一侧；未选择的冲突按修改时间自动处理。
        </span>
      </div>

      {open && previewError != null && (
        <section className="account-sync-conflict-panel" aria-live="polite">
          <div className="account-sync-error" role="alert">
            {previewError}
          </div>
        </section>
      )}

      {open && previewError == null && previewResult != null && (
        <section className="account-sync-conflict-panel" aria-live="polite">
          {previewResult.totalConflicts === 0 ? (
            <div className="account-sync-conflict-empty">未发现需要处理的冲突</div>
          ) : (
            <>
              <div className="account-sync-conflict-toolbar">
                <strong>冲突预览 · {previewResult.totalConflicts} 项待处理</strong>
                <div className="account-sync-conflict-batch">
                  <Button size="small" onClick={() => setAllChoices('local')}>
                    全部保留本机
                  </Button>
                  <Button size="small" onClick={() => setAllChoices('cloud')}>
                    全部保留云端
                  </Button>
                  <Button size="small" disabled={choiceCount === 0} onClick={() => setChoices({})}>
                    清除选择
                  </Button>
                </div>
              </div>

              <div className="account-sync-conflict-hint">
                未选择的冲突将按修改时间自动处理；选择后以你的决定为准。
              </div>

              {previewResult.conflicts.map((group) => {
                const meta = CATEGORY_META[group.category]
                const errors = categoryErrorCodes.get(group.category) ?? []
                return (
                  <div className="account-sync-conflict-category" key={group.category}>
                    <div className="account-sync-conflict-category-heading">
                      <span>{meta.label}</span>
                      <span className="account-sync-conflict-category-count">
                        {group.items.length} 项
                      </span>
                      {errors.length > 0 && (
                        <span className="account-sync-conflict-category-errors">
                          {errors.join('；')}
                        </span>
                      )}
                    </div>
                    {group.items.map((item) => {
                      const key = conflictKey(group.category, item.id)
                      const localSide = item.local
                      const cloudSide = item.cloud
                      const title =
                        localSide != null && !localSide.deleted
                          ? localSide.summary
                          : cloudSide != null && !cloudSide.deleted
                            ? cloudSide.summary
                            : '(未命名)'
                      const preview = sidePreview(localSide) || sidePreview(cloudSide)
                      return (
                        <div className="account-sync-conflict-row" key={item.id}>
                          <div className="account-sync-conflict-info">
                            <strong title={title}>{title}</strong>
                            {preview.trim() !== '' && (
                              <span className="account-sync-conflict-preview">{preview}</span>
                            )}
                          </div>
                          <div className="account-sync-conflict-times">
                            <span>本机 {sideTime(localSide)}</span>
                            <span>云端 {sideTime(cloudSide)}</span>
                          </div>
                          <Radio.Group
                            className="account-sync-conflict-choose"
                            size="small"
                            value={choices[key] ?? undefined}
                            onChange={(event) => {
                              const side = readChoiceSide(event.target.value)
                              if (side == null) return
                              setChoices((current) => ({ ...current, [key]: side }))
                            }}
                          >
                            <Radio.Button value="local">保留本机</Radio.Button>
                            <Radio.Button value="cloud">保留云端</Radio.Button>
                          </Radio.Group>
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              <div className="account-sync-conflict-actions">
                <Button
                  type="primary"
                  loading={applying}
                  disabled={applying}
                  onClick={() => void handleApply()}
                >
                  应用选择并同步
                </Button>
                <span className="account-sync-conflict-actions-hint">
                  {choiceCount > 0
                    ? `已选择 ${choiceCount} 项`
                    : '未选择任何条目，其余冲突将按修改时间自动处理'}
                </span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
