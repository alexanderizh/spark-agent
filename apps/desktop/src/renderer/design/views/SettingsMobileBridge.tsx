/**
 * SettingsMobileBridge — 设置 → 生态 → 移动端桥接（云端中继）
 *
 * 局域网直连已整体移除（小程序体验版强制 https/wss + 域名白名单，真机不可用），
 * 唯一链路是云端中继：桌面端主动出网连 Spark 平台服务并保持长连接，
 * 小程序用同一个 Spark 平台账号即可接管本机会话——接续对话、新建远程会话、实时跟流。
 *
 * 本页只负责：
 *   1. 云端中继总开关
 *   2. 连接状态徽标（已连接 / 连接中 / 未连接 / 已吊销）
 *   3. 服务器地址（只读，派生自 Spark 平台账号服务地址）与本机授信设备展示
 *   4. 「重新授信」：设备被吊销后生成全新设备身份并重连
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Switch } from 'antd'
import type { MobileBridgeRelayStatus } from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'

function SettingsRow({
  title,
  desc,
  right,
}: {
  title: string
  desc?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="settings-card-row">
      <div className="flex1 min-w-0">
        <div className="row-title">{title}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      <div className="row-action">{right}</div>
    </div>
  )
}

/** wss://host → https://host（状态回的是实际连接地址，展示用 http 形式） */
function toHttpUrl(url: string): string {
  return (url ?? '').replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://')
}

export function MobileBridgeSettingsSection() {
  const { toast } = useToast()
  const { invoke: getRelayStatus } = useIpcInvoke('mobile-bridge:get-relay-status')
  const { invoke: updateRelaySettings } = useIpcInvoke('mobile-bridge:update-relay-settings')
  const { invoke: resetRelayIdentity } = useIpcInvoke('mobile-bridge:reset-relay-identity')

  const [relay, setRelay] = useState<MobileBridgeRelayStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingReset, setPendingReset] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRelay(await getRelayStatus({}))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取云端中继状态失败')
    } finally {
      setLoading(false)
    }
  }, [getRelayStatus, toast])

  useEffect(() => {
    void load()
  }, [load])

  // 中继是长连接，状态会自己变（掉线重连）；设置页停留时每 5s 轮询一次即可
  useEffect(() => {
    const timer = setInterval(() => {
      getRelayStatus({})
        .then(setRelay)
        .catch(() => undefined)
    }, 5_000)
    return () => clearInterval(timer)
  }, [getRelayStatus])

  const applyRelay = useCallback(
    async (patch: { enabled?: boolean }) => {
      setBusy(true)
      try {
        setRelay(await updateRelaySettings(patch))
        toast.success('已保存')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '保存失败')
        void load()
      } finally {
        setBusy(false)
      }
    },
    [load, toast, updateRelaySettings],
  )

  const copyDeviceId = async () => {
    const deviceId = relay?.deviceId
    if (!deviceId) return
    try {
      await navigator.clipboard.writeText(deviceId)
      toast.success('设备号已复制')
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  const handleResetIdentity = useCallback(async () => {
    setBusy(true)
    try {
      setRelay(await resetRelayIdentity({}))
      setPendingReset(false)
      toast.success('已生成新设备身份并重连')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重新授信失败')
    } finally {
      setBusy(false)
    }
  }, [resetRelayIdentity, toast])

  const enabled = relay?.enabled === true
  const revoked = relay?.revoked === true
  const connected = relay?.connected === true
  const deviceId = relay?.deviceId ?? null
  const serverUrl = toHttpUrl(relay?.baseUrl ?? '')

  return (
    <div className="settings-section">
      <h2>移动端桥接</h2>
      <div className="lede">
        让微信小程序用同一个 Spark 平台账号接管本机会话：接续对话、新建远程会话、实时跟流。
        全程走云端中继——电脑不需要公网 IP、不需要开端口，手机也不需要和电脑同一个 Wi-Fi。
      </div>

      <div className="settings-card">
        <SettingsRow
          title="启用云端中继"
          desc="桌面端主动出网连 Spark 平台服务并保持长连接，小程序也连 Spark 平台服务，服务端按账号配对转发；关闭后小程序会看到本机离线。"
          right={
            <Switch
              size="middle"
              loading={busy}
              disabled={loading || relay == null}
              checked={enabled}
              onChange={(checked) => void applyRelay({ enabled: checked })}
            />
          }
        />

        <SettingsRow
          title="连接状态"
          desc={
            revoked ? (
              <span className="mobile-bridge-danger">
                {relay?.lastError ?? '设备已被吊销，需重新授信后才能恢复连接'}
              </span>
            ) : enabled && relay?.lastError ? (
              <span className="mobile-bridge-danger">{relay.lastError}</span>
            ) : (
              '与 Spark 平台服务的长连接状态；断线会自动按 1s→30s 退避重连。'
            )
          }
          right={
            revoked ? (
              <Tag size="small" color="red">
                已吊销
              </Tag>
            ) : connected ? (
              <Tag size="small" color="green">
                已连接
              </Tag>
            ) : enabled ? (
              <Tag size="small" color="blue">
                连接中
              </Tag>
            ) : (
              <Tag size="small">未连接</Tag>
            )
          }
        />

        <SettingsRow
          title="服务器地址"
          desc="由 Spark 平台账号服务地址派生，登录账号后自动配置，无需手工填写。"
          right={
            serverUrl ? (
              <code className="mobile-bridge-url">{serverUrl}</code>
            ) : (
              <Tag size="small">未配置</Tag>
            )
          }
        />

        <SettingsRow
          title="本机设备"
          desc={`展示名 ${relay?.label || '—'}（默认取本机主机名，连接时上报）。同一账号可有多台桌面端同时在线，可在小程序「远程会话」的设备管理中查看与吊销所有授信设备。`}
          right={
            <div className="mobile-bridge-actions">
              {deviceId ? (
                <Tag size="small">{deviceId.slice(0, 8)}…</Tag>
              ) : (
                <Tag size="small">—</Tag>
              )}
              <Button size="small" disabled={!deviceId} onClick={() => void copyDeviceId()}>
                复制设备号
              </Button>
            </div>
          }
        />

        <SettingsRow
          title="设备授信"
          desc={
            revoked ? (
              <span className="mobile-bridge-danger">
                此设备已在小程序端被吊销，中继已停止自动重连。点击「重新授信」生成全新设备身份并重连；旧身份会被服务端永久拒绝。
              </span>
            ) : (
              '重新授信会生成全新的设备身份（旧身份立即作废）。设备被吊销或本机身份数据异常时，用它恢复连接。'
            )
          }
          right={
            pendingReset ? (
              <div className="mobile-bridge-actions">
                <Button
                  size="small"
                  danger
                  loading={busy}
                  onClick={() => void handleResetIdentity()}
                >
                  确认重新授信
                </Button>
                <Button size="small" disabled={busy} onClick={() => setPendingReset(false)}>
                  取消
                </Button>
              </div>
            ) : (
              <Button
                size="small"
                danger={revoked}
                disabled={loading || relay == null}
                onClick={() => setPendingReset(true)}
              >
                重新授信
              </Button>
            )
          }
        />
      </div>
    </div>
  )
}
