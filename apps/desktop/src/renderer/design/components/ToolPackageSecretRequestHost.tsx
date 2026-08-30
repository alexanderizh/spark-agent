import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, InputPassword, Modal } from '@lobehub/ui'
import { message } from 'antd'
import type { ToolPackageSecureRequest } from '@spark/protocol'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'

export function ToolPackageSecretRequestHost() {
  const [requests, setRequests] = useState<ToolPackageSecureRequest[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { invoke: listRequests } = useIpcInvoke('tool-packages:secure-requests:list')
  const { invoke: fulfillRequest } = useIpcInvoke('tool-packages:secure-request:fulfill')
  const { invoke: cancelRequest } = useIpcInvoke('tool-packages:secure-request:cancel')

  const refresh = useCallback(async () => {
    try {
      const response = await listRequests({})
      setRequests(response.requests)
      setActiveId((current) => {
        if (current != null && response.requests.some((request) => request.id === current)) {
          return current
        }
        return response.requests[0]?.id ?? null
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '安全配置请求加载失败')
    }
  }, [listRequests])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IPC completion updates remote state.
    void refresh()
  }, [refresh])

  useEffect(() => {
    // Never carry a secret typed for one request into another request.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- request identity owns the input.
    setValue('')
  }, [activeId])

  useIpcStream('stream:tool-packages:changed', (event) => {
    if (event.change === 'secret-requested' || event.change === 'configured') void refresh()
  })

  const active = useMemo(
    () => requests.find((request) => request.id === activeId) ?? null,
    [activeId, requests],
  )

  const closeCurrent = useCallback(() => {
    setValue('')
    setRequests((current) => current.filter((request) => request.id !== activeId))
    setActiveId((current) => {
      const remaining = requests.filter((request) => request.id !== current)
      return remaining[0]?.id ?? null
    })
  }, [activeId, requests])

  const submit = useCallback(async () => {
    if (active == null || value.length === 0 || submitting) return
    setSubmitting(true)
    try {
      await fulfillRequest({ requestId: active.id, value })
      closeCurrent()
      message.success(`${active.title} 已安全保存到系统 Keychain`)
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '安全配置保存失败')
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }, [active, closeCurrent, fulfillRequest, refresh, submitting, value])

  const cancel = useCallback(async () => {
    if (active == null || submitting) return
    setSubmitting(true)
    try {
      await cancelRequest({ requestId: active.id })
      closeCurrent()
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '取消安全配置失败')
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }, [active, cancelRequest, closeCurrent, refresh, submitting])

  return (
    <Modal
      open={active != null}
      title="配置工具密钥"
      closable={!submitting}
      keyboard={!submitting}
      maskClosable={!submitting}
      onCancel={() => {
        if (!submitting) void cancel()
      }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button disabled={submitting} onClick={() => void cancel()}>
            取消
          </Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={submitting || value.length === 0}
            onClick={() => void submit()}
          >
            保存到 Keychain
          </Button>
        </div>
      }
    >
      {active != null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ color: 'var(--color-text-secondary)' }}>
            {active.packageName} · v{active.version}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>{active.title}</span>
            <InputPassword
              autoFocus
              value={value}
              placeholder={active.description ?? active.name}
              autoComplete="new-password"
              onChange={(event) => setValue(event.target.value)}
              onPressEnter={() => void submit()}
            />
          </label>
          <small style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            密钥不会发送给 Agent，也不会写入会话记录或 SQLite；主进程收到后会直接保存到系统
            Keychain。请求将在 {new Date(active.expiresAt).toLocaleTimeString()} 失效。
          </small>
          {requests.length > 1 && (
            <small style={{ color: 'var(--color-text-secondary)' }}>
              还有 {requests.length - 1} 项安全配置等待处理
            </small>
          )}
        </div>
      )}
    </Modal>
  )
}
