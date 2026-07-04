/**
 * PlaywrightStatusCard — Settings panel for Playwright browser automation.
 *
 * Shows:
 *   - MCP + browser install status
 *   - "Install MCP" / "Download chromium" buttons
 *   - Enable/disable managed MCP toggle
 *   - Run mode toggle (headful / headless)
 *   - Last error display
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { PlaywrightInstallProgress, PlaywrightStatusResponse } from '@spark/protocol'
import { Button } from '@lobehub/ui'
import { Icons } from '../Icons'
import { useToast } from '../components/Toast'

type Status = PlaywrightStatusResponse
type InstallProgress = PlaywrightInstallProgress

export function PlaywrightStatusCard(): ReactElement {
  const { toast } = useToast()
  const [status, setStatus] = useState<Status | null>(null)
  const [installingMcp, setInstallingMcp] = useState(false)
  const [installingBrowser, setInstallingBrowser] = useState(false)
  const [togglingMode, setTogglingMode] = useState(false)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      const result = await window.spark.invoke('playwright:status', {})
      setStatus(result)
    } catch (err) {
      console.warn('[playwright] failed to load status:', err)
    }
  }

  useEffect(() => {
    void window.spark.invoke('playwright:status', {}).then(setStatus).catch((err: unknown) => {
      console.warn('[playwright] failed to load status:', err)
    })
    const unsub = window.spark?.on('stream:playwright:status', (payload: Status) => {
      setStatus(payload)
    })
    const unsubProgress = window.spark?.on(
      'stream:playwright:install-progress',
      (payload: InstallProgress) => {
        setInstallProgress(payload)
        if (payload.target === 'mcp') setInstallingMcp(payload.state !== 'done' && payload.state !== 'error')
        if (payload.target === 'browser') {
          setInstallingBrowser(payload.state !== 'done' && payload.state !== 'error')
        }
      },
    )
    return () => {
      unsub?.()
      unsubProgress?.()
    }
  }, [])

  const handleInstallMcp = async (): Promise<void> => {
    setInstallingMcp(true)
    setInstallProgress(null)
    try {
      const result = await window.spark.invoke('playwright:install', { target: 'mcp' })
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
      await refresh()
    } finally {
      setInstallingMcp(false)
    }
  }

  const handleInstallBrowser = async (): Promise<void> => {
    setInstallingBrowser(true)
    setInstallProgress(null)
    try {
      const result = await window.spark.invoke('playwright:install', { target: 'browser' })
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
      await refresh()
    } finally {
      setInstallingBrowser(false)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    await refresh()
    toast.success('浏览器自动化状态已刷新')
  }

  const handleToggleEnabled = async (): Promise<void> => {
    if (status == null) return
    const next = !status.mcpEnabled
    try {
      await window.spark.invoke('playwright:set-enabled', { enabled: next })
      toast.success(next ? 'Playwright MCP 已启用' : 'Playwright MCP 已禁用')
      await refresh()
    } catch (err) {
      toast.error(`切换失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSetMode = async (mode: 'headful' | 'headless'): Promise<void> => {
    setTogglingMode(true)
    try {
      await window.spark.invoke('playwright:set-mode', { mode })
      await refresh()
    } finally {
      setTogglingMode(false)
    }
  }

  const handleResetConfig = async (): Promise<void> => {
    await window.spark.invoke('playwright:reset-config', {})
    await refresh()
  }

  if (status == null) {
    return (
      <div className="settings-section">
        <h2>浏览器自动化</h2>
        <div className="lede">检查 Playwright MCP 与 Chromium 浏览器的安装状态。</div>
        <div className="integrity-status-badge unknown">
          <Icons.Refresh size={14} />
          <span>加载中…</span>
        </div>
      </div>
    )
  }

  const mcpBadge = status.mcpInstalled ? (
    <span className="badge success dot">已安装 {status.mcpVersion ?? ''}</span>
  ) : (
    <span className="badge error dot">未安装</span>
  )

  const browserBadge = status.browserSource === 'bundled' ? (
    <span className="badge success dot">Chromium 已就绪</span>
  ) : status.browserSource === 'system' ? (
    <span className="badge warning dot">使用系统浏览器</span>
  ) : (
    <span className="badge warning dot">Chromium 未下载</span>
  )

  const browserInstallProgress =
    installProgress?.target === 'browser' ? installProgress : null
  const browserProgressPercent =
    browserInstallProgress?.percent != null
      ? Math.max(0, Math.min(100, browserInstallProgress.percent))
      : null
  const browserProgressLabel =
    browserProgressPercent != null ? `${Math.round(browserProgressPercent)}%` : '准备中'
  const isBrowserInstallActive =
    browserInstallProgress != null &&
    browserInstallProgress.state !== 'done' &&
    browserInstallProgress.state !== 'error'
  return (
    <div className="settings-section playwright-settings">
      <div className="playwright-header">
        <div>
          <h2>浏览器自动化</h2>
          <div className="lede">
            Playwright MCP 负责可靠的网页自动化；应用内可见独立窗口由内置 spark_browser 工具提供，
            可用于本地 HTML 调试、控制台与网络观察、持久脚本和 profile 登录态。
          </div>
        </div>
        <div className="playwright-header-actions">
          <Button size="middle" type="text" onClick={handleRefresh} icon={<Icons.Refresh size={14} />}>
            重新检查
          </Button>
          <Button
            size="middle"
            type={status.mcpEnabled ? 'primary' : 'default'}
            onClick={handleToggleEnabled}
            title={status.mcpEnabled ? '点击禁用 Playwright MCP' : '点击启用 Playwright MCP'}
            icon={<Icons.CheckCircle size={14} />}
          >
            {status.mcpEnabled ? 'MCP 已启用' : '启用 MCP'}
          </Button>
        </div>
      </div>

      <div className="playwright-summary">
        <div className="playwright-summary-item">
          <Icons.Server size={16} />
          <span>MCP {status.mcpInstalled ? '已安装' : '未安装'}</span>
        </div>
        <div className={`playwright-summary-item ${status.browserSource}`}>
          <Icons.Globe size={16} />
          <span>
            {status.browserSource === 'bundled'
              ? '内置 Chromium'
              : status.browserSource === 'system'
                ? '系统浏览器回退'
                : '浏览器未就绪'}
          </span>
        </div>
        <div className="playwright-summary-item bundled">
          <Icons.Eye size={16} />
          <span>spark_browser 可见窗口</span>
        </div>
      </div>

      <div className="playwright-card">
        <div className="playwright-row">
          <div className="playwright-row-main">
            <div className="playwright-row-icon"><Icons.Server size={18} /></div>
            <div>
              <div className="settings-card-title">@playwright/mcp</div>
              <div className="settings-card-desc">MCP 服务器包，提供 snapshot / click / type 等浏览器控制工具</div>
            </div>
          </div>
          <div className="playwright-row-actions">
            {mcpBadge}
            <Button
              size="middle"
              type="text"
              onClick={handleInstallMcp}
              disabled={installingMcp}
              loading={installingMcp}
              icon={<Icons.Download size={14} />}
            >
              {status.mcpInstalled ? '重新安装' : '安装 MCP'}
            </Button>
          </div>
        </div>

        <div className="playwright-row browser-row">
          <div className="playwright-row-main">
            <div className="playwright-row-icon"><Icons.Globe size={18} /></div>
            <div>
              <div className="settings-card-title">Chromium 浏览器</div>
              <div className="settings-card-desc">
                {status.browserSource === 'bundled'
                  ? '浏览器已内置，会随安装包一起分发'
                  : status.browserSource === 'system'
                    ? '未检测到内置 Chromium，当前会回退到系统 Chrome/Edge'
                    : 'Playwright 使用的内置浏览器引擎，约 150MB'}
              </div>
            </div>
          </div>
          <div className="playwright-row-actions">
            {browserBadge}
            <Button
              size="middle"
              type="primary"
              onClick={handleInstallBrowser}
              disabled={installingBrowser || !status.playwrightInstalled}
              loading={installingBrowser}
              icon={<Icons.Download size={14} />}
            >
              {installingBrowser
                ? browserProgressLabel
                : status.browserSource === 'bundled'
                  ? '重新下载'
                  : '下载浏览器'}
            </Button>
          </div>
          {(browserInstallProgress != null || installingBrowser) && (
            <div className="playwright-progress">
              <div className="playwright-progress-head">
                <span>{browserInstallProgress?.message ?? '正在准备下载'}</span>
                <strong>{browserProgressLabel}</strong>
              </div>
              <div className={`playwright-progress-track${browserProgressPercent == null && isBrowserInstallActive ? ' indeterminate' : ''}`}>
                <div
                  className="playwright-progress-fill"
                  style={{ width: `${browserProgressPercent ?? 36}%` }}
                />
              </div>
              {browserInstallProgress?.logLine != null && (
                <div className="playwright-progress-log" title={browserInstallProgress.logLine}>
                  {browserInstallProgress.logLine}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="playwright-row">
          <div className="playwright-row-main">
            <div className="playwright-row-icon"><Icons.Settings size={18} /></div>
            <div>
              <div className="settings-card-title">运行模式</div>
              <div className="settings-card-desc">headful 显示 Playwright 自启动浏览器；headless 后台运行</div>
            </div>
          </div>
          <div className="playwright-segmented">
            <button
              className={status.mode === 'headful' ? 'active' : ''}
              onClick={() => handleSetMode('headful')}
              disabled={togglingMode || status.mode === 'headful'}
            >
              headful
            </button>
            <button
              className={status.mode === 'headless' ? 'active' : ''}
              onClick={() => handleSetMode('headless')}
              disabled={togglingMode || status.mode === 'headless'}
            >
              headless
            </button>
          </div>
        </div>

        <div className="playwright-row">
          <div className="playwright-row-main">
            <div className="playwright-row-icon"><Icons.Eye size={18} /></div>
            <div>
              <div className="settings-card-title">应用内可见浏览器窗口</div>
              <div className="settings-card-desc">
                Agent 会通过内置 spark_browser MCP 工具按需打开，不再使用旧的 CDP 9223 视图。
              </div>
            </div>
          </div>
          <div className="playwright-row-actions">
            <Button size="middle" type="text" onClick={handleResetConfig} icon={<Icons.Refresh size={14} />}>
              重置配置
            </Button>
          </div>
        </div>

        {status.lastError != null && (
          <div className="playwright-row error">
            <div>
              <div className="settings-card-title">最近错误</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{status.lastError}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
