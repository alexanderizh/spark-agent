/**
 * SettingsMobileBridge — 设置 → 生态 → 移动端桥接
 *
 * 桌面端把本地会话以 HTTP + WebSocket 暴露到局域网，微信小程序用「同一个 edu-server
 * 账号」登录后即可配对，进而接续会话 / 新建远程会话 / 跟流查看回复。
 *
 * 本页只负责三件事：
 *   1. 总开关与端口（改端口会重启监听，返回新的实际端口）
 *   2. 展示局域网访问地址（复制后填到小程序的「桌面端地址」）
 *   3. 已配对设备列表与吊销（吊销后该设备令牌立即失效）
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Switch } from 'antd'
import { QRCodeSVG } from '@rc-component/qrcode'
import { DEFAULT_MOBILE_BRIDGE_SETTINGS } from '@spark/protocol'
import type { MobileBridgePairedDevice, MobileBridgeStatus } from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'

function SettingsRow({ title, desc, right }: { title: string; desc?: string; right?: ReactNode }) {
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

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function MobileBridgeSettingsSection() {
  const { toast } = useToast()
  const { invoke: getStatus } = useIpcInvoke('mobile-bridge:get-status')
  const { invoke: updateSettings } = useIpcInvoke('mobile-bridge:update-settings')
  const { invoke: revokeDevice } = useIpcInvoke('mobile-bridge:revoke-device')

  const [status, setStatus] = useState<MobileBridgeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [portDraft, setPortDraft] = useState(String(DEFAULT_MOBILE_BRIDGE_SETTINGS.port))
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getStatus({})
      setStatus(next)
      setPortDraft(String(next?.settings?.port ?? DEFAULT_MOBILE_BRIDGE_SETTINGS.port))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取移动端桥接状态失败')
    } finally {
      setLoading(false)
    }
  }, [getStatus, toast])

  useEffect(() => {
    void load()
  }, [load])

  const apply = useCallback(
    async (patch: { enabled?: boolean; port?: number }) => {
      setBusy(true)
      try {
        const next = await updateSettings(patch)
        setStatus(next)
        setPortDraft(String(next?.settings?.port ?? DEFAULT_MOBILE_BRIDGE_SETTINGS.port))
        toast.success('已保存')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '保存失败')
        void load()
      } finally {
        setBusy(false)
      }
    },
    [load, toast, updateSettings],
  )

  const handleToggle = (checked: boolean) => {
    void apply({ enabled: checked })
  }

  const handleApplyPort = () => {
    const parsed = Number(portDraft.trim())
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      toast.error('端口必须是 0-65535 的整数（0 表示随机分配）')
      return
    }
    if (status != null && parsed === status.settings.port) {
      toast.info('端口未变化')
      return
    }
    void apply({ port: parsed })
  }

  const handleRevoke = async (device: MobileBridgePairedDevice) => {
    setBusy(true)
    try {
      const next = await revokeDevice({ deviceId: device.deviceId })
      setStatus(next)
      setPendingRevoke(null)
      toast.success(`已吊销「${device.deviceLabel}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '吊销失败')
    } finally {
      setBusy(false)
    }
  }

  const copyUrl = async () => {
    const url = status?.localUrl
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('地址已复制')
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  const enabled = status?.settings.enabled === true
  const devices = status?.pairedDevices ?? []

  return (
    <div className="settings-section">
      <h2>移动端桥接</h2>
      <div className="lede">
        把本机会话暴露到局域网，微信小程序用同一个账号登录即可接续会话、新建远程会话并实时跟流。
        关闭后小程序无法连接，已配对设备保留但全部失效。
      </div>

      <div className="settings-card">
        <SettingsRow
          title="启用移动端桥接"
          desc="开启后在局域网监听 HTTP + WebSocket 服务；仅接受与桌面端同一 edu-server 账号的配对请求。"
          right={
            <Switch
              size="middle"
              loading={busy}
              disabled={loading}
              checked={enabled}
              onChange={handleToggle}
            />
          }
        />

        <SettingsRow
          title="监听端口"
          desc="改端口会重启监听并返回实际端口；填 0 由系统随机分配（重启后可能变化，建议固定端口）。"
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="mobile-bridge-port"
                value={portDraft}
                inputMode="numeric"
                disabled={loading || busy}
                onChange={(e) => setPortDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplyPort()
                }}
              />
              <Button size="small" loading={busy} disabled={loading} onClick={handleApplyPort}>
                应用
              </Button>
            </div>
          }
        />

        <SettingsRow
          title="局域网访问地址"
          desc="在小程序「远程会话 → 桌面端地址」填入该地址。手机需与电脑在同一 Wi-Fi；跨网段/公网需自行做反向代理并开放 WebSocket。"
          right={
            status?.localUrl ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code className="mobile-bridge-url">{status.localUrl}</code>
                <Button size="small" onClick={() => void copyUrl()}>
                  复制
                </Button>
              </div>
            ) : (
              <Tag size="small">未运行</Tag>
            )
          }
        />

        {status?.localUrl ? (
          <div className="settings-card-row">
            <div className="flex1 min-w-0">
              <div className="row-title">扫码配对</div>
              <div className="row-desc">
                在小程序「远程会话」页点「扫码连接」，扫这张二维码即可自动填入地址并配对， 不用手打
                IP。
              </div>
            </div>
            <div className="row-action">
              <div className="mobile-bridge-qr">
                <QRCodeSVG value={status.localUrl} size={104} level="M" />
              </div>
            </div>
          </div>
        ) : null}

        <SettingsRow
          title="运行状态"
          desc="设备令牌在配对时下发，吊销后立即失效，需重新配对。"
          right={
            status?.running ? (
              <Tag size="small" color="green">
                监听中 · {status.port ?? '—'}
              </Tag>
            ) : (
              <Tag size="small">已停止</Tag>
            )
          }
        />
      </div>

      <h3 style={{ marginTop: 20 }}>已配对设备（{devices.length}）</h3>
      {devices.length === 0 ? (
        <div className="settings-card">
          <div className="mobile-bridge-empty">
            还没有设备配对。
            <br />
            在微信小程序里登录同一账号，扫上面的二维码（或填入地址）后点击配对即可。
          </div>
        </div>
      ) : (
        <div className="settings-card">
          {devices.map((device) => (
            <div className="settings-card-row" key={device.deviceId}>
              <div className="flex1 min-w-0">
                <div className="row-title">{device.deviceLabel || '未命名设备'}</div>
                <div className="row-desc">
                  账号 {device.account || '—'} · 配对 {formatTime(device.pairedAt)} · 最近活跃{' '}
                  {formatTime(device.lastSeenAt)}
                </div>
              </div>
              <div className="row-action">
                {pendingRevoke === device.deviceId ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button
                      size="small"
                      danger
                      loading={busy}
                      onClick={() => void handleRevoke(device)}
                    >
                      确认吊销
                    </Button>
                    <Button size="small" onClick={() => setPendingRevoke(null)}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <Button size="small" danger onClick={() => setPendingRevoke(device.deviceId)}>
                    吊销
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
