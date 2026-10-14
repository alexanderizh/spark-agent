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
import type {
  MobileBridgePairedDevice,
  MobileBridgeRelayStatus,
  MobileBridgeStatus,
} from '@spark/protocol'
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

/** wss://host → https://host（设置页输入框与展示用的都是 http 形式） */
function toHttpUrl(url: string): string {
  return (url ?? '').replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://')
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
  const { invoke: getRelayStatus } = useIpcInvoke('mobile-bridge:get-relay-status')
  const { invoke: updateRelaySettings } = useIpcInvoke('mobile-bridge:update-relay-settings')
  const { invoke: resetRelayIdentity } = useIpcInvoke('mobile-bridge:reset-relay-identity')

  const [status, setStatus] = useState<MobileBridgeStatus | null>(null)
  const [relay, setRelay] = useState<MobileBridgeRelayStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [portDraft, setPortDraft] = useState(String(DEFAULT_MOBILE_BRIDGE_SETTINGS.port))
  const [relayUrlDraft, setRelayUrlDraft] = useState('')
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getStatus({})
      setStatus(next)
      setPortDraft(String(next?.settings?.port ?? DEFAULT_MOBILE_BRIDGE_SETTINGS.port))
      const relayNext = await getRelayStatus({})
      setRelay(relayNext)
      // 状态里回的是实际连接地址（wss://…），输入框要的是 http(s) 形式
      setRelayUrlDraft(toHttpUrl(relayNext?.baseUrl ?? ''))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取移动端桥接状态失败')
    } finally {
      setLoading(false)
    }
  }, [getStatus, getRelayStatus, toast])

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
    async (patch: { enabled?: boolean; baseUrl?: string }) => {
      setBusy(true)
      try {
        const next = await updateRelaySettings(patch)
        setRelay(next)
        if (patch.baseUrl !== undefined) setRelayUrlDraft(patch.baseUrl)
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

  const applyResetIdentity = useCallback(async () => {
    setBusy(true)
    try {
      const next = await resetRelayIdentity({})
      setRelay(next)
      toast.success('已生成新设备身份并重连')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重新授信失败')
    } finally {
      setBusy(false)
    }
  }, [resetRelayIdentity, toast])

  const enabled = status?.settings.enabled === true
  const devices = status?.pairedDevices ?? []
  const relayRevoked = relay?.revoked === true

  return (
    <div className="settings-section">
      <h2>移动端桥接</h2>
      <div className="lede">
        让微信小程序用同一个 edu-server 账号接管本机会话：接续对话、新建远程会话、实时跟流。
        <strong>推荐用云端中继</strong>（跨网络可用，无需同 Wi-Fi、无需公网
        IP）；局域网直连仅作备用。
      </div>

      {/* ─── 云端中继 ─── */}
      <h3>云端中继（推荐）</h3>
      <div className="settings-card">
        <SettingsRow
          title="启用云端中继"
          desc="桌面端主动出网连 edu-server 并保持长连接，小程序也连 edu-server，服务端按账号配对转发。电脑不需要公网 IP、不需要开端口、手机不需要和电脑同一个 Wi-Fi。"
          right={
            <Switch
              size="middle"
              loading={busy}
              disabled={loading || relay == null}
              checked={relay?.enabled === true}
              onChange={(checked) => void applyRelay({ enabled: checked })}
            />
          }
        />

        <SettingsRow
          title="连接状态"
          desc={
            relay?.lastError
              ? relay.lastError
              : '与 edu-server 的长连接状态；断线会自动按 1s→30s 退避重连。'
          }
          right={
            relay?.connected ? (
              <Tag size="small" color="green">
                已连接 · {toHttpUrl(relay.baseUrl).replace(/^https?:\/\//, '')}
              </Tag>
            ) : relayRevoked ? (
              <Tag size="small" color="red">
                设备已被吊销
              </Tag>
            ) : (
              <Tag size="small">未连接</Tag>
            )
          }
        />

        <SettingsRow
          title="授信设备"
          desc={
            relayRevoked
              ? '此设备已在小程序端被吊销，中继已停止。点击「重新授信」生成新设备身份并重连；旧身份会被服务端永久拒绝。'
              : '本机在中继服务上的设备身份（首次连接自动授信）。可在小程序「远程会话」的设备管理中查看与吊销所有授信设备。'
          }
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag size="small">{relay?.deviceId ? `${relay.deviceId.slice(0, 8)}…` : '—'}</Tag>
              {relayRevoked && (
                <Button size="small" loading={busy} onClick={() => void applyResetIdentity()}>
                  重新授信
                </Button>
              )}
            </div>
          }
        />

        <SettingsRow
          title="中继服务地址"
          desc="留空则跟随账号服务地址（https://www.yiqibyte.com）。仅在自建 edu-server 时填写，必须以 http:// 或 https:// 开头。"
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="mobile-bridge-port"
                style={{ width: 260 }}
                placeholder="留空 = 账号服务地址"
                value={relayUrlDraft}
                disabled={loading || busy}
                onChange={(e) => setRelayUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void applyRelay({ baseUrl: relayUrlDraft.trim() })
                }}
              />
              <Button
                size="small"
                loading={busy}
                disabled={loading}
                onClick={() => void applyRelay({ baseUrl: relayUrlDraft.trim() })}
              >
                应用
              </Button>
            </div>
          }
        />
      </div>

      {/* ─── 局域网直连（备用） ─── */}
      <h3 style={{ marginTop: 20 }}>局域网直连（备用）</h3>
      <div className="lede" style={{ marginBottom: 8 }}>
        手机与电脑在同一 Wi-Fi 时才可用。小程序体验版强制 https/wss，真机上一般连不通，
        仅用于开发者工具「不校验合法域名」时联调。
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
