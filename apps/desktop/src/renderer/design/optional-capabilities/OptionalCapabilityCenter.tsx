import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Modal, Progress } from 'antd'
import type {
  OptionalCapabilityId,
  OptionalCapabilityItem,
  OptionalCapabilitySnapshot,
} from '@spark/protocol'
import { useApp } from '../AppContext'
import { useOptionalCapabilities } from './useOptionalCapabilities'
import { OPEN_OPTIONAL_CAPABILITY_CENTER_EVENT } from './optionalCapabilityNavigation'
import {
  shouldShowCapabilityPrompt,
  type OptionalCapabilityPromptPreference,
} from './startupPromptPolicy'
import './optional-capabilities.less'

const PROMPT_PREFERENCE_KEY = 'spark-optional-capability-prompt'

export function OptionalCapabilityCenter() {
  const { setTweak, t } = useApp()
  const { snapshot, progress, install, cancel } = useOptionalCapabilities()
  const [promptDismissed, setPromptDismissed] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [selected, setSelected] = useState<OptionalCapabilityId[]>([])
  const [progressHidden, setProgressHidden] = useState(false)
  const [disableStartupReminder, setDisableStartupReminder] = useState(
    () => readPromptPreference()?.disabled === true,
  )

  const installable = useMemo(() => snapshot?.capabilities.filter(isInstallable) ?? [], [snapshot])
  const shouldOpenPrompt = useMemo(
    () => snapshot != null && shouldShowCapabilityPrompt(snapshot, readPromptPreference()),
    [snapshot],
  )

  const startupPromptOpen = shouldOpenPrompt && !promptDismissed
  const promptMode = manualOpen ? 'manual' : 'startup'
  const promptItems = promptMode === 'manual' ? (snapshot?.capabilities ?? []) : installable
  const selectedInstallable = selected.filter((id) => installable.some((item) => item.id === id))
  const selectedDownloadSize = installable
    .filter((item) => selectedInstallable.includes(item.id))
    .reduce((total, item) => total + item.downloadSize, 0)

  useEffect(() => {
    const openManually = () => {
      setPromptDismissed(true)
      setSelected([])
      setManualOpen(true)
    }
    window.addEventListener(OPEN_OPTIONAL_CAPABILITY_CENTER_EVENT, openManually)
    return () => window.removeEventListener(OPEN_OPTIONAL_CAPABILITY_CENTER_EVENT, openManually)
  }, [])

  const activeProgress = Object.values(progress).filter(
    (item) => item != null && item.phase !== 'missing',
  )
  const hasStartingProgress = activeProgress.some(
    (item) => item.phase === 'queued' || item.phase === 'downloading',
  )
  useEffect(() => {
    if (!hasStartingProgress) return
    const frame = window.requestAnimationFrame(() => setProgressHidden(false))
    return () => window.cancelAnimationFrame(frame)
  }, [hasStartingProgress])

  const dismissPrompt = () => {
    if (snapshot) persistPromptPreference(snapshot, disableStartupReminder)
    setPromptDismissed(true)
  }

  const installSelected = () => {
    const targets = [...selectedInstallable]
    if (promptMode === 'manual') setManualOpen(false)
    else dismissPrompt()
    setSelected([])
    for (const id of targets) void install(id).catch(() => undefined)
  }

  const closePrompt = () => {
    setSelected([])
    if (promptMode === 'manual') setManualOpen(false)
    else dismissPrompt()
  }

  const updateStartupReminder = (disabled: boolean) => {
    setDisableStartupReminder(disabled)
    if (!snapshot) return
    persistPromptPreference(snapshot, disabled)
  }

  const openIntegrity = () => {
    setTweak('view', 'settings')
    setTweak('settingsSection', 'integrity')
  }

  const openIntegrityFromPrompt = () => {
    dismissPrompt()
    openIntegrity()
  }

  if (t?.view === 'onboarding') return null

  return (
    <>
      <Modal
        open={manualOpen || (startupPromptOpen && installable.length > 0)}
        title="安装可选功能"
        width={640}
        destroyOnHidden
        className="optional-capability-modal"
        onCancel={closePrompt}
        footer={[
          <Button key="close" onClick={closePrompt}>
            {promptMode === 'manual' ? '关闭' : '稍后'}
          </Button>,
          ...(promptMode === 'startup'
            ? [
                <Button key="settings" onClick={openIntegrityFromPrompt}>
                  前往完整性
                </Button>,
              ]
            : []),
          <Button
            key="install"
            type="primary"
            disabled={selectedInstallable.length === 0}
            onClick={installSelected}
          >
            后台安装{selectedInstallable.length > 0 ? `（${selectedInstallable.length}）` : ''}
          </Button>,
        ]}
      >
        <div className="optional-capability-prompt-intro">
          <p className="optional-capability-prompt-copy">
            按需下载所需资源，不会增加基础安装包体积。安装将在后台静默进行。
          </p>
          <span>{promptMode === 'manual' ? '组件状态' : '可安装组件'}</span>
        </div>
        <div className="optional-capability-choice-list">
          {promptItems.map((item) => {
            const selectable = isInstallable(item)
            return (
              <Checkbox
                key={item.id}
                disabled={!selectable}
                checked={selectedInstallable.includes(item.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id),
                  )
                }
              >
                <span className="optional-capability-choice-content">
                  <span className="optional-capability-choice-main">
                    <span className="optional-capability-choice-title">{item.displayName}</span>
                    <span className="optional-capability-choice-description">
                      {item.description}
                    </span>
                  </span>
                  <span className="optional-capability-choice-meta">
                    <span className={`optional-capability-status ${statusTone(item)}`}>
                      {capabilityStatus(item)}
                    </span>
                    {selectable && (
                      <span className="optional-capability-choice-size">
                        {formatBytes(item.downloadSize)}
                      </span>
                    )}
                  </span>
                </span>
              </Checkbox>
            )
          })}
          {promptItems.length === 0 && (
            <div className="optional-capability-empty">
              {snapshot == null ? '正在读取组件状态…' : '当前没有可选功能组件'}
            </div>
          )}
        </div>
        <div className="optional-capability-selection-summary" aria-live="polite">
          <span>
            {selectedInstallable.length > 0
              ? `已选择 ${selectedInstallable.length} 项`
              : promptMode === 'manual'
                ? manualSelectionSummary(snapshot?.capabilities)
                : '尚未选择组件'}
          </span>
          {selectedDownloadSize > 0 && <strong>共 {formatBytes(selectedDownloadSize)}</strong>}
        </div>
        {promptMode === 'startup' && (
          <Checkbox
            className="optional-capability-reminder"
            checked={disableStartupReminder}
            onChange={(event) => updateStartupReminder(event.target.checked)}
          >
            不再在启动时提醒（仍可在“设置 → 完整性”中安装）
          </Checkbox>
        )}
      </Modal>

      {!progressHidden && activeProgress.length > 0 && (
        <aside className="optional-capability-progress-card" aria-label="可选功能安装进度">
          <div className="optional-capability-progress-header">
            <strong>功能资源</strong>
            <button type="button" onClick={() => setProgressHidden(true)} aria-label="收起">
              ×
            </button>
          </div>
          {activeProgress.map((item) => (
            <div key={item.capabilityId} className="optional-capability-progress-item">
              <div className="optional-capability-progress-label">
                <span>{item.displayName}</span>
                <span>{phaseLabel(item.phase)}</span>
              </div>
              <Progress
                percent={item.percent ?? 0}
                {...(item.phase === 'error' ? { status: 'exception' as const } : {})}
                size="small"
              />
              <div className="optional-capability-progress-detail">
                {item.total > 0
                  ? `${formatBytes(item.downloaded)} / ${formatBytes(item.total)}`
                  : item.message}
                {item.queuePosition > 0 ? ` · 队列 ${item.queuePosition}` : ''}
              </div>
              {(item.phase === 'queued' || item.phase === 'downloading') &&
                snapshot?.capabilities.find((capability) => capability.id === item.capabilityId)
                  ?.cancellable !== false && (
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={() => void cancel(item.capabilityId).catch(() => undefined)}
                  >
                    取消
                  </Button>
                )}
            </div>
          ))}
          <div className="optional-capability-progress-actions">
            <Button type="link" onClick={openIntegrity}>
              查看详情
            </Button>
          </div>
        </aside>
      )}
    </>
  )
}

function isInstallable(item: OptionalCapabilityItem): boolean {
  return (
    (item.state === 'missing' || item.state === 'damaged') &&
    item.targetVersion != null &&
    item.downloadSize > 0
  )
}

function capabilityStatus(item: OptionalCapabilityItem): string {
  if (item.state === 'checking') return '检查中'
  if (item.state === 'queued') return '等待安装'
  if (item.state === 'downloading') return '下载中'
  if (item.state === 'verifying') return '校验中'
  if (item.state === 'extracting') return '解压中'
  if (item.state === 'activating') return '激活中'
  if (item.state === 'ready') return '已安装'
  if (item.state === 'update_available') return '有更新'
  if (item.state === 'damaged') return '需要修复'
  if (item.state === 'error') return '安装失败'
  if (item.state === 'cancelled') return '已取消'
  if (item.targetVersion == null) return '暂不可用'
  return '未安装'
}

function statusTone(item: OptionalCapabilityItem): string {
  if (item.state === 'ready') return 'ready'
  if (item.state === 'damaged' || item.state === 'error') return 'warning'
  if (item.state === 'update_available') return 'update'
  return 'muted'
}

function manualSelectionSummary(items: OptionalCapabilityItem[] | undefined): string {
  if (items == null) return '正在读取组件状态'
  if (
    items.length > 0 &&
    items.every((item) => item.state === 'ready' || item.state === 'update_available')
  ) {
    return '所有可用组件均已安装'
  }
  return '当前没有可批量安装的组件'
}

function persistPromptPreference(snapshot: OptionalCapabilitySnapshot, disabled: boolean): void {
  window.localStorage.setItem(
    PROMPT_PREFERENCE_KEY,
    JSON.stringify({
      manifestUpdatedAt: snapshot.manifestUpdatedAt,
      dismissedAt: Date.now(),
      ...(disabled ? { disabled: true } : {}),
    } satisfies OptionalCapabilityPromptPreference),
  )
}

function readPromptPreference(): OptionalCapabilityPromptPreference | null {
  try {
    const value = window.localStorage.getItem(PROMPT_PREFERENCE_KEY)
    return value ? (JSON.parse(value) as OptionalCapabilityPromptPreference) : null
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    queued: '等待中',
    downloading: '下载中',
    verifying: '校验中',
    extracting: '解压中',
    activating: '激活中',
    cancelled: '已取消',
    ready: '已完成',
    error: '失败',
  }
  return labels[phase] ?? phase
}
