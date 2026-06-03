/**
 * PlaywrightStatusCard — Settings panel for Playwright browser automation.
 *
 * Shows:
 *   - MCP + browser install status
 *   - "Install MCP" / "Download chromium" buttons
 *   - Enable/disable managed MCP toggle
 *   - Run mode toggle (headful / headless)
 *   - "Open browser view" / "Close browser view" buttons
 *   - Last error display
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { PlaywrightStatusResponse } from '@spark/protocol'
import { Icons } from '../Icons'
import { useToast } from '../components/Toast'

type Status = PlaywrightStatusResponse

export function PlaywrightStatusCard(): ReactElement {
  const { toast } = useToast()
  const [status, setStatus] = useState<Status | null>(null)
  const [installingMcp, setInstallingMcp] = useState(false)
  const [installingBrowser, setInstallingBrowser] = useState(false)
  const [togglingMode, setTogglingMode] = useState(false)
  const [opening, setOpenClose] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      const result = await window.spark.invoke('playwright:status', {})
      setStatus(result)
    } catch (err) {
      console.warn('[playwright] failed to load status:', err)
    }
  }

  useEffect(() => {
    void refresh()
    const unsub = window.spark?.on('stream:playwright:status', (payload: Status) => {
      setStatus(payload)
    })
    return unsub ?? (() => {})
  }, [])

  const handleInstallMcp = async (): Promise<void> => {
    setInstallingMcp(true)
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

  const handleOpenView = async (): Promise<void> => {
    setOpenClose(true)
    try {
      await window.spark.invoke('playwright:open-view', {})
      await refresh()
    } finally {
      setOpenClose(false)
    }
  }

  const handleCloseView = async (): Promise<void> => {
    setOpenClose(true)
    try {
      await window.spark.invoke('playwright:close-view', {})
      await refresh()
    } finally {
      setOpenClose(false)
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

  const browserBadge = status.browserReady ? (
    <span className="badge success dot">Chromium 已就绪</span>
  ) : (
    <span className="badge warning dot">Chromium 未下载</span>
  )

  return (
    <div className="settings-section">
      <h2>浏览器自动化</h2>
      <div className="lede">
        通过 Playwright MCP 让 Agent 自动操作网页。内置的「浏览器自动化」Skill 会引导 Agent
        正确使用 snapshot + ref-based 操作。模式默认为 headful（显示嵌入式浏览器窗口）。
      </div>

      <div className="integrity-toolbar" style={{ marginTop: 16 }}>
        <div className="integrity-status-row">
          <button
            className={`btn-tab ${status.mcpEnabled ? 'active' : ''}`}
            onClick={handleToggleEnabled}
            title={status.mcpEnabled ? '点击禁用 Playwright MCP' : '点击启用 Playwright MCP'}
            style={{ padding: '6px 14px', fontSize: 12 }}
          >
            {status.mcpEnabled ? '✓ MCP 已启用' : 'MCP 已禁用'}
          </button>
          {status.viewOpen ? (
            <div className="integrity-status-badge ok">
              <Icons.CheckCircle size={14} />
              <span>嵌入式视图运行中 · {status.cdpEndpoint}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-card-row">
          <div>
            <div className="settings-card-title">@playwright/mcp</div>
            <div className="settings-card-desc">MCP 服务器包，提供浏览器控制工具（snapshot / click / type 等）</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {mcpBadge}
            <button
              className="btn-secondary"
              onClick={handleInstallMcp}
              disabled={installingMcp}
            >
              {installingMcp ? '安装中…' : status.mcpInstalled ? '重新安装' : '安装 MCP'}
            </button>
          </div>
        </div>

        <div className="settings-card-row">
          <div>
            <div className="settings-card-title">Chromium 浏览器</div>
            <div className="settings-card-desc">
              {status.browserReady
                ? '浏览器已内置，无需额外下载'
                : 'Playwright 使用的浏览器引擎，约 150MB'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {browserBadge}
            <button
              className="btn-secondary"
              onClick={handleInstallBrowser}
              disabled={installingBrowser || !status.playwrightInstalled}
            >
              {installingBrowser
                ? '下载中…'
                : status.browserReady
                  ? '重新下载'
                  : '下载浏览器'}
            </button>
          </div>
        </div>

        <div className="settings-card-row">
          <div>
            <div className="settings-card-title">运行模式</div>
            <div className="settings-card-desc">
              headful 显示嵌入式浏览器窗口，方便观察 Agent 操作；headless 后台运行
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`btn-tab ${status.mode === 'headful' ? 'active' : ''}`}
              onClick={() => handleSetMode('headful')}
              disabled={togglingMode || status.mode === 'headful'}
            >
              headful
            </button>
            <button
              className={`btn-tab ${status.mode === 'headless' ? 'active' : ''}`}
              onClick={() => handleSetMode('headless')}
              disabled={togglingMode || status.mode === 'headless'}
            >
              headless
            </button>
          </div>
        </div>

        <div className="settings-card-row">
          <div>
            <div className="settings-card-title">嵌入式浏览器窗口</div>
            <div className="settings-card-desc">
              打开后 Playwright 将通过 CDP 连接到此窗口，Agent 操作的网页会显示在这里
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!status.viewOpen ? (
              <button className="btn-primary" onClick={handleOpenView} disabled={opening}>
                打开浏览器视图
              </button>
            ) : (
              <button className="btn-secondary" onClick={handleCloseView} disabled={opening}>
                关闭浏览器视图
              </button>
            )}
            <button className="btn-ghost" onClick={handleResetConfig}>
              重置 MCP 配置
            </button>
          </div>
        </div>

        {status.lastError != null && (
          <div className="settings-card-row error">
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
