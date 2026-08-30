import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Pagination, Spin, Switch, Tag } from 'antd'
import {
  ACCOUNT_SYNC_CATEGORIES,
  type AccountSyncExecuteResponse,
  type AccountSyncExecuteResult,
  type AccountSyncHistoryItem,
  type AccountSyncPreferences,
  type AccountSyncUpdatePreferencesRequest,
} from '@spark/protocol'
import { useAuth } from '../../auth/AuthContext'
import { useApp } from '../../AppContext'
import { useToast } from '../../components/Toast'
import { applySyncedAppearanceLocally } from '../../hooks/useAppearance'
import { AccountSyncConflictPanel } from './AccountSyncConflictPanel'
import { pickLocalAppearance } from './account-sync-appearance'
import { CATEGORY_META } from './account-sync-meta'
import { formatTime } from './account-sync-format'
import { translateSyncErrorCodes } from './sync-error-messages'
import './AccountSyncSettingsSection.less'

const PAGE_SIZE = 20

const STATUS_LABELS = {
  success: '成功',
  partial: '部分成功',
  failed: '失败',
} as const

function defaultPreferences(): AccountSyncPreferences {
  return {
    enabled: false,
    categories: {
      customCommands: false,
      prompts: false,
      memory: false,
      assistants: false,
      workflows: false,
      appearance: false,
      promptLibrary: false,
    },
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function statusColor(status: AccountSyncExecuteResult['status']): string {
  if (status === 'success') return 'success'
  if (status === 'partial') return 'warning'
  return 'error'
}

function getHistoryPresentation(item: AccountSyncHistoryItem): {
  status: AccountSyncExecuteResult['status'] | 'pending'
  label: string
} {
  if (item.ackStatus === 'pending') return { status: 'pending', label: '本机待确认' }
  if (item.status === 'failed' || item.ackStatus === 'failed') {
    return { status: 'failed', label: STATUS_LABELS.failed }
  }
  if (item.status === 'partial' || item.ackStatus === 'partial') {
    return { status: 'partial', label: STATUS_LABELS.partial }
  }
  return { status: 'success', label: STATUS_LABELS.success }
}

export function AccountSyncSettingsSection(): React.ReactElement {
  const auth = useAuth()
  const { applySyncedAppearance } = useApp()
  const { toast } = useToast()
  const [preferences, setPreferences] = useState<AccountSyncPreferences>(defaultPreferences)
  const [history, setHistory] = useState<AccountSyncHistoryItem[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [initialLoading, setInitialLoading] = useState(false)
  const [loadedAccountKey, setLoadedAccountKey] = useState<string | null>(null)
  const [preferenceSaving, setPreferenceSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<AccountSyncExecuteResult | null>(null)
  const historyRequestRef = useRef(0)
  const accountKey = auth.isAuthenticated ? String(auth.user?.id ?? '') : null

  const selectedCount = useMemo(
    () => ACCOUNT_SYNC_CATEGORIES.filter((category) => preferences.categories[category]).length,
    [preferences.categories],
  )

  const loadHistory = useCallback(async (page: number): Promise<void> => {
    const requestId = ++historyRequestRef.current
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const response = await window.spark.invoke('account-sync:list-history', {
        page,
        pageSize: PAGE_SIZE,
      })
      if (historyRequestRef.current !== requestId) return
      setHistory(response.list)
      setHistoryTotal(response.total)
      setHistoryPage(response.page)
    } catch (error) {
      if (historyRequestRef.current !== requestId) return
      setHistoryError(getErrorMessage(error, '同步记录加载失败'))
    } finally {
      if (historyRequestRef.current === requestId) setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    historyRequestRef.current += 1
    if (accountKey != null) {
      void (async () => {
        // Defer state reset out of the effect body and gate rendering with loadedAccountKey,
        // so an account switch never flashes the previous account's preferences.
        await Promise.resolve()
        if (cancelled) return
        setLastResult(null)
        setLoadError(null)
        setHistoryError(null)
        setInitialLoading(true)
        try {
          const response = await window.spark.invoke('account-sync:get-preferences', {})
          if (cancelled) return
          setPreferences(response.preferences)
          await loadHistory(1)
        } catch (error) {
          if (!cancelled) setLoadError(getErrorMessage(error, '同步设置加载失败'))
        } finally {
          if (!cancelled) {
            setLoadedAccountKey(accountKey)
            setInitialLoading(false)
          }
        }
      })()
    }

    return () => {
      cancelled = true
    }
  }, [accountKey, loadHistory])

  const updatePreferences = async (patch: AccountSyncUpdatePreferencesRequest): Promise<void> => {
    setPreferenceSaving(true)
    try {
      const response = await window.spark.invoke('account-sync:update-preferences', patch)
      setPreferences(response.preferences)
    } catch (error) {
      toast.error(getErrorMessage(error, '同步设置保存失败'))
    } finally {
      setPreferenceSaving(false)
    }
  }

  /** 统一处理一次同步执行结果：更新结果区、偏好、外观并刷新历史 */
  const applySyncResponse = useCallback(
    (response: AccountSyncExecuteResponse): void => {
      const finishedAt = new Date().toISOString()
      setLastResult(response.result)
      setPreferences((current) => ({
        ...current,
        lastOperation: {
          operationId: response.result.operationId,
          status: response.result.status,
          finishedAt,
        },
      }))
      if (response.appliedAppearance != null) {
        applySyncedAppearance(response.appliedAppearance)
        const localAppearance = pickLocalAppearance(response.appliedAppearance)
        if (Object.keys(localAppearance).length > 0) {
          applySyncedAppearanceLocally(localAppearance)
        }
      }
      if (response.result.status === 'success') toast.success('账号同步完成')
      else if (response.result.status === 'partial') toast.warning('账号同步部分完成，请查看结果')
      else toast.error('账号同步失败，请查看错误信息')
      void loadHistory(1)
    },
    [applySyncedAppearance, loadHistory, toast],
  )

  const handleSync = async (): Promise<void> => {
    setSyncing(true)
    try {
      const response = await window.spark.invoke('account-sync:execute', {})
      applySyncResponse(response)
    } catch (error) {
      toast.error(getErrorMessage(error, '账号同步失败'))
    } finally {
      setSyncing(false)
    }
  }

  const [conflictSyncing, setConflictSyncing] = useState(false)

  const syncDisabled =
    !auth.isAuthenticated ||
    !preferences.enabled ||
    selectedCount === 0 ||
    initialLoading ||
    preferenceSaving ||
    syncing ||
    conflictSyncing

  return (
    <div className="settings-section account-sync-settings">
      <h2>账号同步</h2>
      <p className="lede">在当前设备和已登录账号之间手动双向同步安全的工作配置。</p>

      <div className="account-sync-privacy" aria-label="同步隐私说明">
        <p>
          <strong>不会自动同步。</strong>只有点击“立即同步”时才会传输内容。
        </p>
        <p>
          <strong>敏感配置不会上传。</strong>凭据、本机路径、模型、渠道、MCP、Hooks
          和环境变量会被排除。
        </p>
        <p>
          <strong>所选内容会保存到账号云端。</strong>
          提示词、命令、记忆正文和工作流按当前登录账号隔离保存。
        </p>
      </div>

      {!auth.isAuthenticated ? (
        <div className="account-sync-state" role="status">
          <span className="account-sync-state-dot is-idle" />
          <div>
            <strong>尚未登录</strong>
            <span>请先登录 SparkWork 账号，再配置和执行同步。</span>
          </div>
        </div>
      ) : initialLoading || loadedAccountKey !== accountKey ? (
        <div className="account-sync-loading">
          <Spin size="small" /> 正在读取当前账号设置…
        </div>
      ) : loadError != null ? (
        <div className="account-sync-error" role="alert">
          {loadError}
        </div>
      ) : (
        <>
          <section className="account-sync-block" aria-labelledby="account-sync-master-title">
            <div className="account-sync-master-row">
              <div>
                <h3 id="account-sync-master-title">启用账号同步</h3>
                <p>开启后仍不会后台运行；所有类别默认关闭，需要逐项选择。</p>
              </div>
              <Switch
                aria-label="启用账号同步"
                checked={preferences.enabled}
                disabled={preferenceSaving || syncing}
                loading={preferenceSaving}
                onChange={(enabled) => void updatePreferences({ enabled })}
              />
            </div>

            <div className="account-sync-category-list">
              {ACCOUNT_SYNC_CATEGORIES.map((category) => {
                const meta = CATEGORY_META[category]
                return (
                  <div className="account-sync-category-row" key={category}>
                    <div>
                      <strong>{meta.label}</strong>
                      <span>{meta.description}</span>
                    </div>
                    <Switch
                      aria-label={`同步${meta.label}`}
                      checked={preferences.categories[category]}
                      disabled={!preferences.enabled || preferenceSaving || syncing}
                      onChange={(enabled) =>
                        void updatePreferences({ categories: { [category]: enabled } })
                      }
                    />
                  </div>
                )
              })}
            </div>
          </section>

          <div className="account-sync-action-row">
            <div className="account-sync-action-copy">
              <strong>
                {selectedCount > 0 ? `已选择 ${selectedCount} 类内容` : '尚未选择同步内容'}
              </strong>
              <span>
                {preferences.lastOperation != null
                  ? `上次同步：${formatTime(preferences.lastOperation.finishedAt)} · ${STATUS_LABELS[preferences.lastOperation.status]}`
                  : '当前账号尚无本机同步结果'}
              </span>
            </div>
            <Button
              type="primary"
              loading={syncing}
              disabled={syncDisabled}
              onClick={() => void handleSync()}
            >
              立即同步
            </Button>
          </div>

          <AccountSyncConflictPanel
            disabled={syncDisabled}
            onApplied={applySyncResponse}
            onSyncingChange={setConflictSyncing}
          />

          {lastResult != null && (
            <section className="account-sync-result" aria-live="polite">
              <div className="account-sync-result-title">
                <strong>本次结果</strong>
                <Tag color={statusColor(lastResult.status)}>{STATUS_LABELS[lastResult.status]}</Tag>
              </div>
              <div className="account-sync-stats">
                <span>上传 {lastResult.stats.uploaded}</span>
                <span>下载 {lastResult.stats.downloaded}</span>
                <span>冲突 {lastResult.stats.conflicts}</span>
                <span>跳过 {lastResult.stats.skipped}</span>
              </div>
              {lastResult.errorCodes.length > 0 && (
                <div className="account-sync-error-codes">
                  {translateSyncErrorCodes(lastResult.errorCodes).slice(0, 4).join(' · ')}
                </div>
              )}
            </section>
          )}

          <section className="account-sync-history" aria-labelledby="account-sync-history-title">
            <div className="account-sync-history-heading">
              <div>
                <h3 id="account-sync-history-title">同步记录</h3>
                <p>服务端仅保存状态、数量和错误码，不保存历史正文。</p>
              </div>
              <Button
                size="small"
                disabled={historyLoading}
                onClick={() => void loadHistory(historyPage)}
              >
                刷新
              </Button>
            </div>

            {historyError != null ? (
              <div className="account-sync-error" role="alert">
                {historyError}
              </div>
            ) : historyLoading && history.length === 0 ? (
              <div className="account-sync-loading">
                <Spin size="small" /> 正在加载同步记录…
              </div>
            ) : history.length === 0 ? (
              <div className="account-sync-empty">暂无同步记录</div>
            ) : (
              <div className="account-sync-history-list">
                {history.map((item) => {
                  const presentation = getHistoryPresentation(item)
                  return (
                    <div className="account-sync-history-row" key={item.operationId}>
                      <span className={`account-sync-state-dot is-${presentation.status}`} />
                      <div className="account-sync-history-main">
                        <div>
                          <strong>{presentation.label}</strong>
                          <span>{formatTime(item.finishedAt ?? item.createdAt)}</span>
                        </div>
                        <p>
                          {item.deviceLabel} ·{' '}
                          {item.categories
                            .map((category) => CATEGORY_META[category].label)
                            .join('、')}
                        </p>
                      </div>
                      <div className="account-sync-history-stats">
                        <span>↑ {item.stats.uploaded}</span>
                        <span>↓ {item.stats.downloaded}</span>
                        <span>跳过 {item.stats.skipped}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {historyTotal > PAGE_SIZE && (
              <Pagination
                className="account-sync-pagination"
                current={historyPage}
                pageSize={PAGE_SIZE}
                total={historyTotal}
                showSizeChanger={false}
                onChange={(page) => void loadHistory(page)}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}
