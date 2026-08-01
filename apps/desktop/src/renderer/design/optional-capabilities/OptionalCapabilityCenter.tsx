import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Modal, Progress } from 'antd'
import type { OptionalCapabilityId } from '@spark/protocol'
import { useApp } from '../AppContext'
import { useOptionalCapabilities } from './useOptionalCapabilities'
import {
  shouldShowCapabilityPrompt,
  type OptionalCapabilityPromptPreference,
} from './startupPromptPolicy'
import './optional-capabilities.less'

const PROMPT_PREFERENCE_KEY = 'spark-optional-capability-prompt'

export function OptionalCapabilityCenter() {
  const { setTweak } = useApp()
  const { snapshot, progress, install, cancel } = useOptionalCapabilities()
  const [promptOpen, setPromptOpen] = useState(false)
  const [selected, setSelected] = useState<OptionalCapabilityId[]>([])
  const [progressHidden, setProgressHidden] = useState(false)
  const [disableStartupReminder, setDisableStartupReminder] = useState(
    () => readPromptPreference()?.disabled === true,
  )

  const installable = useMemo(
    () =>
      snapshot?.capabilities.filter(
        (item) =>
          (item.state === 'missing' || item.state === 'damaged') &&
          item.targetVersion != null &&
          item.downloadSize > 0,
      ) ?? [],
    [snapshot],
  )

  useEffect(() => {
    if (!snapshot) return
    const preference = readPromptPreference()
    if (shouldShowCapabilityPrompt(snapshot, preference)) setPromptOpen(true)
  }, [snapshot])

  const activeProgress = Object.values(progress).filter(
    (item) => item != null && item.phase !== 'missing',
  )
  useEffect(() => {
    if (activeProgress.some((item) => item.phase === 'queued' || item.phase === 'downloading')) {
      setProgressHidden(false)
    }
  }, [activeProgress])

  const dismissPrompt = () => {
    if (snapshot) {
      window.localStorage.setItem(
        PROMPT_PREFERENCE_KEY,
        JSON.stringify({
          manifestUpdatedAt: snapshot.manifestUpdatedAt,
          dismissedAt: Date.now(),
          ...(disableStartupReminder ? { disabled: true } : {}),
        } satisfies OptionalCapabilityPromptPreference),
      )
    }
    setPromptOpen(false)
  }

  const installSelected = () => {
    const targets = [...selected]
    dismissPrompt()
    setSelected([])
    for (const id of targets) void install(id).catch(() => undefined)
  }

  const updateStartupReminder = (disabled: boolean) => {
    setDisableStartupReminder(disabled)
    if (!snapshot) return
    window.localStorage.setItem(
      PROMPT_PREFERENCE_KEY,
      JSON.stringify({
        manifestUpdatedAt: snapshot.manifestUpdatedAt,
        dismissedAt: Date.now(),
        ...(disabled ? { disabled: true } : {}),
      } satisfies OptionalCapabilityPromptPreference),
    )
  }

  const openIntegrity = () => {
    setTweak('view', 'settings')
    setTweak('settingsSection', 'integrity')
  }

  return (
    <>
      <Modal
        open={promptOpen && installable.length > 0}
        title="可选功能资源"
        onCancel={dismissPrompt}
        footer={[
          <Button key="later" onClick={dismissPrompt}>稍后</Button>,
          <Button key="settings" onClick={openIntegrity}>前往完整性</Button>,
          <Button
            key="install"
            type="primary"
            disabled={selected.length === 0}
            onClick={installSelected}
          >
            后台安装所选组件
          </Button>,
        ]}
      >
        <p className="optional-capability-prompt-copy">
          以下功能需要额外下载资源。所有组件默认不勾选，确认后会在后台静默安装。
        </p>
        <div className="optional-capability-choice-list">
          {installable.map((item) => (
            <Checkbox
              key={item.id}
              checked={selected.includes(item.id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, item.id]
                    : current.filter((id) => id !== item.id),
                )
              }
            >
              <span className="optional-capability-choice-title">{item.displayName}</span>
              <span className="optional-capability-choice-description">{item.description}</span>
              <span className="optional-capability-choice-size">
                下载 {formatBytes(item.downloadSize)}
              </span>
            </Checkbox>
          ))}
        </div>
        <Checkbox
          checked={disableStartupReminder}
          onChange={(event) => updateStartupReminder(event.target.checked)}
        >
          不再在启动时提醒（仍可在“设置 → 完整性”中安装）
        </Checkbox>
      </Modal>

      {!progressHidden && activeProgress.length > 0 && (
        <aside className="optional-capability-progress-card" aria-label="可选功能安装进度">
          <div className="optional-capability-progress-header">
            <strong>功能资源</strong>
            <button type="button" onClick={() => setProgressHidden(true)} aria-label="收起">×</button>
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
                {item.total > 0 ? `${formatBytes(item.downloaded)} / ${formatBytes(item.total)}` : item.message}
                {item.queuePosition > 0 ? ` · 队列 ${item.queuePosition}` : ''}
              </div>
              {(item.phase === 'queued' || item.phase === 'downloading') && (
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
          <Button type="link" onClick={openIntegrity}>查看详情</Button>
        </aside>
      )}
    </>
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
