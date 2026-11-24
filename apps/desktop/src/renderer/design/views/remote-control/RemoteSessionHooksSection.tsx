/**
 * 远程会话 Hooks 区块（本地 SessionHooksSection 的远程移植，2026-11-25）。
 *
 * 展示当前会话「最终生效列表」：来源作用域、覆盖关系、被停用/待复核原因；
 * 允许会话临时停用继承 Hook（session 绑定 enabled=false 显式覆盖）或恢复执行。
 *
 * 数据通道：hookV2:list-effective / hookV2:upsert-binding（本地 IPC）→
 * 目标端 GET/PUT /v1/sessions/:id/hooks（远程中继）。
 * 标签文案复用 hooksV2Ipc 的纯常量（HOOK_EVENT_LABELS 等，无 IPC 副作用）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Switch } from 'antd'
import { useToast } from '../../components/Toast'
import type { HookEffectiveBindingV1 } from '@spark/protocol'
import { Icons } from '../../Icons'
import { HOOK_EVENT_LABELS, HOOK_SCOPE_LABELS, describeHookAction } from '../hooks/hooksV2Ipc'
import { useRemoteCall } from './useRemoteBridge'

const DISABLED_REASON_LABELS: Record<string, string> = {
  overridden_disabled: '被更高优先级作用域显式停用',
  definition_disabled: '定义已停用',
  needs_review: '授权失效，待重新确认',
}

function effectiveTag(item: HookEffectiveBindingV1): React.ReactElement {
  if (item.disabled) {
    return (
      <Tag className="tone-warning">
        {DISABLED_REASON_LABELS[item.disabledReason ?? ''] ?? '已停用'}
      </Tag>
    )
  }
  if (item.binding.state === 'needs_review') return <Tag className="tone-warning">待重新授权</Tag>
  if (item.binding.state === 'disabled') return <Tag>已停用</Tag>
  return <Tag className="tone-success">生效中</Tag>
}

export function RemoteSessionHooksSection({
  deviceId,
  sessionId,
}: {
  deviceId: string
  sessionId: string | null
}) {
  const { toast } = useToast()
  const call = useRemoteCall()
  const [items, setItems] = useState<HookEffectiveBindingV1[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (sessionId == null) return
    setLoading(true)
    try {
      const res = await call<{ items: HookEffectiveBindingV1[] }>(
        deviceId,
        'GET',
        `/v1/sessions/${encodeURIComponent(sessionId)}/hooks`,
      )
      setItems(res.items)
      setFailed(false)
    } catch (cause) {
      // 旧版目标端无此端点：区块保持「无 Hook」空态，不打扰其余配置
      setFailed(true)
      setItems([])
      console.warn('[remote hooks] load failed', cause)
    } finally {
      setLoading(false)
    }
  }, [call, deviceId, sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  const setSessionOverride = async (item: HookEffectiveBindingV1, enabled: boolean) => {
    if (sessionId == null) return
    try {
      await call(deviceId, 'PUT', `/v1/sessions/${encodeURIComponent(sessionId)}/hooks`, {
        hookId: item.hook.id,
        enabled,
        // 重新启用（恢复执行）时按当前定义执行哈希授权，使会话覆盖立即生效。
        ...(enabled
          ? {
              authorizeExecutionHash: item.hook.executionHash,
              authorizedEffect: item.hook.action.type,
            }
          : {}),
      })
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新会话覆盖失败')
    }
  }

  if (sessionId == null) return null

  return (
    <div className="inspector-section">
      <h4 className="config-panel-header">
        <button
          type="button"
          className="session-panel-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icons.Zap size={11} />
          Hooks
          <span className="spacer" />
          <Icons.ChevronRight size={10} className={`chev ${collapsed ? '' : 'chev-open'}`} />
        </button>
      </h4>
      {!collapsed && (
        <div className="session-hooks-section">
          <div className="runtime-env-hint">
            会话覆盖优先于 Agent / 项目 / 应用级绑定；关闭即为临时停用该 Hook，不影响其他作用域。
          </div>
          {loading && items.length === 0 && <div className="inspector-muted">加载中…</div>}
          {!loading && items.length === 0 && (
            <div className="inspector-muted session-hooks-empty">
              {failed
                ? '目标端暂无法读取 Hooks（旧版本桌面端）。'
                : '当前会话没有生效的 Hook。可在目标电脑的 设置 → Hooks 中创建并绑定。'}
            </div>
          )}
          {items.map((item) => {
            const sessionOverride = item.sourceScope === 'session'
            return (
              <div key={item.hook.id} className="session-hooks-row">
                <div className="flex1 min-w-0">
                  <div className="session-hooks-name">
                    {item.hook.name} {effectiveTag(item)}
                  </div>
                  <div className="inspector-muted session-hooks-sub">
                    {/* 目标端可能比控制端新（未知事件名），可选链兜底避免崩溃 */}
                    {HOOK_EVENT_LABELS[item.hook.eventName]?.label ?? item.hook.eventName} ·{' '}
                    {describeHookAction(item.hook)} · 来源{' '}
                    {HOOK_SCOPE_LABELS[item.sourceScope] ?? item.sourceScope}
                    {item.shadowedBy.length > 0
                      ? ` · 覆盖 ${item.shadowedBy
                          .map((s) => HOOK_SCOPE_LABELS[s.scopeKind] ?? s.scopeKind)
                          .join('/')}`
                      : ''}
                  </div>
                </div>
                <div className="session-hooks-actions">
                  {sessionOverride && item.binding.state === 'needs_review' ? (
                    <Button size="small" onClick={() => void setSessionOverride(item, true)}>
                      重新授权
                    </Button>
                  ) : (
                    <Switch
                      size="small"
                      checked={
                        sessionOverride
                          ? item.binding.enabled
                          : !item.disabled && item.binding.state === 'active'
                      }
                      onChange={(v) => void setSessionOverride(item, v)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
