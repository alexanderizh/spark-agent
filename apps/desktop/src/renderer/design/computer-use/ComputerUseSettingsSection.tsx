import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@lobehub/ui'
import type {
  ComputerUseCapabilitySummary,
  ComputerUseNativeHostDiagnosticReport,
} from '@spark/protocol'
import { Icons } from '../Icons'
import { classNames } from '../utils/class-names'
import './ComputerUseSettingsSection.less'

type SystemPermission = 'screen' | 'accessibility'
type PermissionState = ComputerUseCapabilitySummary['permissions']['screen']

interface PermissionRowModel {
  id: SystemPermission
  title: string
  description: string
  state: PermissionState
  ready: boolean
}

export function ComputerUseSettingsSection() {
  const [capabilities, setCapabilities] = useState<ComputerUseCapabilitySummary | null>(null)
  const [diagnostic, setDiagnostic] = useState<ComputerUseNativeHostDiagnosticReport | null>(null)
  const [busy, setBusy] = useState<'refresh' | 'diagnose' | SystemPermission | null>('refresh')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async (showBusy = true) => {
    if (showBusy) setBusy('refresh')
    setError(null)
    try {
      const next = await window.spark.invoke('computer-use:get-capabilities', undefined)
      setCapabilities(next)
    } catch (cause) {
      setError(toErrorMessage(cause, '无法读取电脑操作状态'))
    } finally {
      if (showBusy) setBusy(null)
    }
  }, [])

  useEffect(() => {
    let canceled = false
    window.spark
      .invoke('computer-use:get-capabilities', undefined)
      .then((next) => {
        if (!canceled) setCapabilities(next)
      })
      .catch((cause: unknown) => {
        if (!canceled) setError(toErrorMessage(cause, '无法读取电脑操作状态'))
      })
      .finally(() => {
        if (!canceled) setBusy(null)
      })
    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    const handleFocus = () => void refresh(false)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh(false)
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh])

  const permissions = useMemo<PermissionRowModel[]>(() => {
    const screen = capabilities?.permissions.screen ?? 'not_determined'
    const accessibility = capabilities?.permissions.accessibility ?? 'not_determined'
    const input = capabilities?.permissions.input ?? 'not_determined'
    return [
      {
        id: 'screen',
        title: '屏幕录制',
        description: '读取当前应用窗口画面，用于识别按钮、输入框和操作结果。',
        state: screen,
        ready: screen === 'granted',
      },
      {
        id: 'accessibility',
        title: '辅助功能与输入控制',
        description: '读取可访问性结构，并执行点击、键盘输入、滚动和窗口切换。',
        state: accessibility === 'granted' ? input : accessibility,
        ready: accessibility === 'granted' && input === 'granted',
      },
    ]
  }, [capabilities])

  const authorize = async (permission: SystemPermission, state: PermissionState) => {
    setBusy(permission)
    setError(null)
    try {
      if (state === 'not_determined') {
        const result = await window.spark.invoke('app-snapshot:request-permissions', {
          permissions: [permission],
        })
        const granted = result.permissions[permission] === 'granted'
        if (!granted) {
          const opened = await window.spark.invoke('computer-use:open-system-settings', {
            permission,
          })
          if (!opened.opened) throw new Error(systemSettingsFallback(permission))
        }
      } else {
        const opened = await window.spark.invoke('computer-use:open-system-settings', {
          permission,
        })
        if (!opened.opened) throw new Error(systemSettingsFallback(permission))
      }
      await refresh(false)
    } catch (cause) {
      setError(toErrorMessage(cause, systemSettingsFallback(permission)))
    } finally {
      setBusy(null)
    }
  }

  const runDiagnostic = async () => {
    setBusy('diagnose')
    setError(null)
    try {
      setDiagnostic(await window.spark.invoke('computer-use:diagnose-native-host', undefined))
    } catch (cause) {
      setError(toErrorMessage(cause, '电脑操作诊断失败'))
    } finally {
      setBusy(null)
    }
  }

  const copyDiagnostic = async () => {
    if (diagnostic == null) return
    try {
      await window.spark.invoke('clipboard:write-text', {
        text: JSON.stringify(diagnostic, null, 2),
      })
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch (cause) {
      setError(toErrorMessage(cause, '复制诊断失败'))
    }
  }

  const ready = capabilitiesReady(capabilities)
  return (
    <div className="settings-section computer-use-settings">
      <div className="computer-use-heading">
        <div>
          <h2>电脑操作</h2>
          <div className="lede">
            系统授权集中在这里管理。授权完成后，Agent 发起的电脑操作任务默认直接执行，不再逐步审批。
          </div>
        </div>
        <Button
          icon={<Icons.Refresh size={13} />}
          loading={busy === 'refresh'}
          onClick={() => void refresh()}
        >
          重新检测
        </Button>
      </div>

      <div className={classNames('computer-use-summary', ready && 'ready')}>
        <span className="computer-use-status-dot" />
        <div>
          <strong>{ready ? '电脑操作已就绪' : '电脑操作尚未就绪'}</strong>
          <span>
            {ready
              ? '屏幕观测、辅助功能和输入控制均可用。'
              : (capabilities?.unavailableReason ?? '请完成下方系统授权并重新检测。')}
          </span>
        </div>
      </div>

      {error != null && <div className="computer-use-error">{error}</div>}

      <div className="subsec-h">系统授权</div>
      <div className="computer-use-permission-list">
        {permissions.map((permission) => (
          <div className="computer-use-permission-row" key={permission.id}>
            <div className="computer-use-permission-icon">
              {permission.id === 'screen' ? (
                <Icons.Monitor size={16} />
              ) : (
                <Icons.MousePointer size={16} />
              )}
            </div>
            <div className="computer-use-permission-copy">
              <div className="computer-use-permission-title">{permission.title}</div>
              <div className="computer-use-permission-description">{permission.description}</div>
            </div>
            <span className={classNames('computer-use-state', permission.ready && 'ready')}>
              {permission.ready ? '已授权' : permissionStateLabel(permission.state)}
            </span>
            <Button
              type={permission.ready ? 'default' : 'primary'}
              icon={<Icons.ExternalLink size={12} />}
              loading={busy === permission.id}
              onClick={() => void authorize(permission.id, permission.state)}
            >
              {permission.state === 'not_determined' ? '请求授权' : '打开系统设置'}
            </Button>
          </div>
        ))}
      </div>

      <div className="subsec-h">运行诊断</div>
      <div className="computer-use-diagnostic">
        <div className="computer-use-diagnostic-copy">
          <div className="computer-use-permission-title">Native Host 与核心链路</div>
          <div className="computer-use-permission-description">
            检查运行时、权限、协议状态及观察/动作各阶段延迟，不包含截图或输入内容。
          </div>
          {diagnostic != null && (
            <div className="computer-use-diagnostic-result">
              <span>{diagnostic.result.diagnosticCode}</span>
              {formatLatency(diagnostic.metrics, 'observation_ms', '观测')}
              {formatLatency(diagnostic.metrics, 'action_execute_ms', '动作')}
              {formatLatency(diagnostic.metrics, 'action_post_observation_ms', '动作后观测')}
            </div>
          )}
        </div>
        <div className="computer-use-diagnostic-actions">
          {diagnostic != null && (
            <Button icon={<Icons.Copy size={12} />} onClick={() => void copyDiagnostic()}>
              {copied ? '已复制' : '复制诊断'}
            </Button>
          )}
          <Button
            icon={<Icons.Activity size={12} />}
            loading={busy === 'diagnose'}
            onClick={() => void runDiagnostic()}
          >
            运行诊断
          </Button>
        </div>
      </div>
    </div>
  )
}

function capabilitiesReady(capabilities: ComputerUseCapabilitySummary | null): boolean {
  return (
    capabilities?.available === true &&
    capabilities.permissions.screen === 'granted' &&
    capabilities.permissions.accessibility === 'granted' &&
    capabilities.permissions.input === 'granted'
  )
}

function permissionStateLabel(state: PermissionState): string {
  if (state === 'denied') return '未授权'
  if (state === 'restricted') return '受系统限制'
  if (state === 'unsupported') return '当前不可用'
  return '待授权'
}

function systemSettingsFallback(permission: SystemPermission): string {
  const pane = permission === 'screen' ? '屏幕录制' : '辅助功能'
  return `请前往“系统设置 → 隐私与安全性 → ${pane}”允许 SparkWork（开发模式下可能显示为 Electron）。`
}

function toErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback
}

function formatLatency(
  metrics: ComputerUseNativeHostDiagnosticReport['metrics'],
  name: string,
  label: string,
) {
  const metric = metrics.find((item) => item.name === name)
  if (metric == null || metric.count === 0) return null
  return <span>{`${label} ${Math.round(metric.averageMs)} ms`}</span>
}
