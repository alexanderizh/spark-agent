import { useState, useEffect, useCallback } from 'react'
import { Button, Input, Modal, Select, Tag, TextArea } from '@lobehub/ui'
import { Switch } from 'antd'
import { QRCodeSVG } from '@rc-component/qrcode'
import { DEFAULT_QQ_REMOTE_COMMANDS, DEFAULT_TELEGRAM_REMOTE_COMMANDS } from '@spark/protocol'
import type {
  RemoteChannelType,
  RemoteCommandDefinition,
  RemoteConnectionCapabilities,
  RemoteConnectionConfig,
  RemotePairingMode,
  RemoteRuntimeStatusResponse,
  RemoteWechatLoginPollResponse,
  RemoteWechatLoginStatus,
  SessionListResponse,
} from '@spark/protocol'
import { Icons } from '../Icons'
import { ContextMenu } from '../components/ContextMenu'
import { useContextMenu, type ContextMenuEntry } from '../components/contextMenuModel'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import telegramLogo from '../../assets/remote-channels/telegram.svg'
import feishuLogo from '../../assets/remote-channels/feishu.ico'
import qqLogo from '../../assets/remote-channels/qq.svg'
import wechatLogo from '../../assets/remote-channels/wechat.svg'

const REMOTE_LAST_CHANNEL_CATEGORY = 'remote-connections'
const REMOTE_LAST_CHANNEL_KEY = 'last-channel'

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

const REMOTE_CHANNEL_LABELS: Record<RemoteChannelType, string> = {
  telegram: 'Telegram',
  feishu: '飞书机器人',
  qq: 'QQ 机器人',
  wechat: '微信机器人',
  'wechat-claw': '微信 Claw',
}

/**
 * 对外可「新建」的远程通道白名单。
 * QQ 通道已改为官方 WebSocket 长连接接入（与飞书同构，客户端主动拉取，无需公网），
 * 微信 ClawBot 使用独立的 `wechat` 通道；旧 `wechat-claw` 自建网关连接仍保留兼容。
 */
const AVAILABLE_REMOTE_CHANNELS: RemoteChannelType[] = ['telegram', 'feishu', 'qq', 'wechat']

const REMOTE_STATUS_LABELS: Record<RemoteConnectionConfig['status'], string> = {
  disabled: '已停用',
  draft: '草稿',
  'pending-pairing': '等待配对',
  connected: '已连接',
  error: '错误',
}

const REMOTE_STATUS_TONES: Record<RemoteConnectionConfig['status'], string> = {
  disabled: 'default',
  draft: 'blue',
  'pending-pairing': 'orange',
  connected: 'green',
  error: 'red',
}

const REMOTE_CHANNEL_META: Record<
  RemoteChannelType,
  {
    label: string
    short: string
    icon: string
    consoleLabel: string
    setupHint: string
  }
> = {
  telegram: {
    label: 'Telegram',
    short: 'Telegram',
    icon: telegramLogo,
    consoleLabel: 'BotFather',
    setupHint: '填写 Bot Token 后保存并启用，系统会自动启动 polling。',
  },
  feishu: {
    label: '飞书机器人',
    short: '飞书',
    icon: feishuLogo,
    consoleLabel: '飞书开放平台',
    setupHint: '填写 App ID / App Secret 后保存并启用，系统会自动启动长连接。',
  },
  qq: {
    label: 'QQ 机器人',
    short: 'QQ',
    icon: qqLogo,
    consoleLabel: 'QQ 开放平台',
    setupHint:
      '填写机器人 AppID / App Secret 后保存并启用，系统会自动启动 WebSocket 长连接；单聊加好友直接私聊，群聊需 @机器人。',
  },
  wechat: {
    label: '微信机器人',
    short: '微信',
    icon: wechatLogo,
    consoleLabel: '微信扫码授权',
    setupHint: '通过微信 ClawBot 扫码授权，保存并启用后会自动启动消息长轮询。',
  },
  'wechat-claw': {
    label: '微信 Claw（旧网关）',
    short: '微信',
    icon: wechatLogo,
    consoleLabel: 'Claw 服务',
    setupHint: '填写 Claw Endpoint 和 Access Token，用本地 webhook 对接微信侧服务。',
  },
}

/* ───────── REMOTE CONNECTIONS ───────── */
const DEFAULT_REMOTE_CAPABILITIES: RemoteConnectionCapabilities = {
  sendMessages: true,
  switchModel: true,
  switchSession: true,
  switchAgent: true,
  manageWorkspace: true,
  runCommands: true,
  approvePermissions: false,
  observeDesktop: true,
  controlDesktop: false,
  useInternalBrowser: false,
  transferFiles: false,
  manageRuntime: false,
  dangerousActions: false,
}

function splitCsv(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinCsv(value: string[] | undefined): string {
  return (value ?? []).join(', ')
}

function createRemoteDraft(channel: RemoteChannelType): RemoteConnectionConfig {
  const now = new Date().toISOString()
  return {
    id: '',
    channel,
    name: REMOTE_CHANNEL_LABELS[channel],
    enabled: false,
    status: 'draft',
    credentials: {},
    commandPrefix: '/',
    allowedUserIds: [],
    allowedChatIds: [],
    telegramCommands: [...DEFAULT_TELEGRAM_REMOTE_COMMANDS],
    qqCommands: [...DEFAULT_QQ_REMOTE_COMMANDS],
    capabilities: { ...DEFAULT_REMOTE_CAPABILITIES },
    pairedDevices: [],
    createdAt: now,
    updatedAt: now,
  }
}

type WechatQrSession = {
  connectionId: string
  loginId: string
  qrPayload: string
  expiresAt: string
  status: RemoteWechatLoginStatus
  message: string
}

export function RemoteConnectionsSection() {
  const { toast } = useToast()
  const { invoke: getSetting } = useIpcInvoke('settings:get')
  const { invoke: setSetting } = useIpcInvoke('settings:set')
  const [connections, setConnections] = useState<RemoteConnectionConfig[]>([])
  const [commands, setCommands] = useState<RemoteCommandDefinition[]>([])
  const [sessions, setSessions] = useState<SessionListResponse['sessions']>([])
  const [runtimeStatus, setRuntimeStatus] = useState<RemoteRuntimeStatusResponse>({
    running: false,
    port: null,
    localBaseUrl: null,
    polling: [],
    longConnections: [],
  })
  const [selectedId, setSelectedId] = useState<string>('')
  const [lastChannel, setLastChannel] = useState<RemoteChannelType>('telegram')
  const [draft, setDraft] = useState<RemoteConnectionConfig>(() => createRemoteDraft('telegram'))
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [manualPairUser, setManualPairUser] = useState('')
  const [manualPairName, setManualPairName] = useState('')
  const [wechatQrSession, setWechatQrSession] = useState<WechatQrSession | null>(null)
  const [wechatVerifyCode, setWechatVerifyCode] = useState('')
  const connectionMenu = useContextMenu<RemoteConnectionConfig>()

  const statusWhenEnabled = (
    connection: RemoteConnectionConfig,
  ): RemoteConnectionConfig['status'] =>
    connection.status === 'disabled' || connection.status === 'draft'
      ? connection.pairedDevices.length > 0
        ? 'connected'
        : 'pending-pairing'
      : connection.status

  // 加载"上次新建/选择的渠道"，失败或不存在则保持默认 telegram。
  useEffect(() => {
    let cancelled = false
    getSetting({ category: REMOTE_LAST_CHANNEL_CATEGORY, key: REMOTE_LAST_CHANNEL_KEY })
      .then((res) => {
        if (cancelled) return
        if (res && typeof res.value === 'string' && res.value in REMOTE_CHANNEL_LABELS) {
          setLastChannel(res.value as RemoteChannelType)
        }
      })
      .catch(() => {
        // 静默失败，不阻塞 UI
      })
    return () => {
      cancelled = true
    }
  }, [getSetting])

  const rememberChannel = useCallback(
    (channel: RemoteChannelType) => {
      setLastChannel(channel)
      void setSetting({
        category: REMOTE_LAST_CHANNEL_CATEGORY,
        key: REMOTE_LAST_CHANNEL_KEY,
        value: channel,
      }).catch(() => {
        // 持久化失败不影响当前 UI
      })
    },
    [setSetting],
  )

  const refresh = useCallback(
    async (options: { preserveDraft?: boolean } = {}) => {
      setLoading(true)
      try {
        const res = await window.spark.invoke('remote:list', {})
        const [runtime, sessionRes] = await Promise.all([
          window.spark.invoke('remote:runtime-status', {}),
          window.spark.invoke('session:list', { includeArchived: false, limit: 60 }),
        ])
        setConnections(res.connections)
        setCommands(res.commandCatalog)
        setRuntimeStatus(runtime)
        setSessions(sessionRes.sessions)
        if (!options.preserveDraft && res.connections.length > 0) {
          const next = res.connections.find((item) => item.id === selectedId) ?? res.connections[0]
          if (next == null) return
          setSelectedId(next.id)
          setDraft(next)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '加载远程连接失败')
      } finally {
        setLoading(false)
      }
    },
    [selectedId, toast],
  )

  useEffect(() => {
    return deferEffect(refresh)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return window.spark.on('stream:remote:changed', () => {
      // Runtime and pairing events must not replace unsaved edits in the open editor.
      void refresh({ preserveDraft: true })
    })
  }, [refresh])

  useEffect(() => {
    const login = wechatQrSession
    if (
      login == null ||
      !editorOpen ||
      login.connectionId !== draft.id ||
      draft.channel !== 'wechat' ||
      login.status === 'need_verifycode' ||
      login.status === 'confirmed' ||
      login.status === 'expired' ||
      login.status === 'verify_code_blocked' ||
      login.status === 'binded_redirect'
    ) {
      return
    }
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      try {
        const response = await window.spark.invoke('remote:wechat-login-poll', {
          id: login.connectionId,
          loginId: login.loginId,
        })
        if (cancelled) return
        setWechatQrSession((current) =>
          current?.loginId === login.loginId
            ? { ...current, status: response.status, message: response.message }
            : current,
        )
        if (response.connection != null) {
          setConnections((prev) =>
            prev.map((item) => (item.id === response.connection?.id ? response.connection : item)),
          )
          setDraft((current) =>
            current.id === response.connection?.id ? response.connection : current,
          )
        }
        if (response.status === 'wait' || response.status === 'scaned') {
          timer = window.setTimeout(() => void poll(), 800)
        }
      } catch (error) {
        if (cancelled) return
        const detail = error instanceof Error ? error.message : String(error)
        setWechatQrSession((current) =>
          current?.loginId === login.loginId
            ? {
                ...current,
                status: 'expired',
                message: `授权状态无法继续查询，请刷新二维码重试：${detail}`,
              }
            : current,
        )
      }
    }
    timer = window.setTimeout(() => void poll(), 600)
    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
    }
  }, [
    draft.channel,
    draft.id,
    editorOpen,
    wechatQrSession?.connectionId,
    wechatQrSession?.loginId,
    wechatQrSession?.status,
  ])

  const refreshRuntime = useCallback(async () => {
    try {
      const status = await window.spark.invoke('remote:runtime-status', {})
      setRuntimeStatus(status)
    } catch {
      setRuntimeStatus({
        running: false,
        port: null,
        localBaseUrl: null,
        polling: [],
        longConnections: [],
      })
    }
  }, [])

  const updateConnection = (connection: RemoteConnectionConfig) => {
    setConnections((prev) => prev.map((item) => (item.id === connection.id ? connection : item)))
    setDraft((prev) => (prev.id === connection.id ? connection : prev))
  }

  const updateDraft = (patch: Partial<RemoteConnectionConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const updateCredential = (key: keyof RemoteConnectionConfig['credentials'], value: string) => {
    setDraft((prev) => ({ ...prev, credentials: { ...prev.credentials, [key]: value } }))
  }

  const clearWechatQrSession = () => {
    const current = wechatQrSession
    setWechatQrSession(null)
    setWechatVerifyCode('')
    if (current != null) {
      void window.spark
        .invoke('remote:wechat-login-cancel', {
          id: current.connectionId,
          loginId: current.loginId,
        })
        .catch(() => {})
    }
  }

  const updateCapability = (key: keyof RemoteConnectionCapabilities, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      capabilities: { ...prev.capabilities, [key]: value },
    }))
  }

  const openConnectionEditor = (connection: RemoteConnectionConfig) => {
    if (wechatQrSession?.connectionId !== connection.id) clearWechatQrSession()
    setSelectedId(connection.id)
    setDraft(connection)
    setManualPairUser('')
    setManualPairName('')
    setEditorOpen(true)
  }

  // 把当前表单草稿落盘（不带任何 UI 反馈），返回服务端归一后的连接配置。
  // 测试/配对等操作先走它，保证后端基于表单里的最新配置执行；
  // 保存后 setDraft 与持久化一致，后续 refresh 不会把表单回退成旧值。
  const persistDraft = async () => {
    const payload: Omit<Partial<RemoteConnectionConfig>, 'defaultSessionId'> &
      Pick<RemoteConnectionConfig, 'channel' | 'name'> & {
        defaultSessionId?: string | null
      } = {
      ...draft,
      defaultSessionId: draft.defaultSessionId ?? null,
      status: draft.enabled ? draft.status : 'disabled',
    }
    // 新建草稿时 createRemoteDraft 把 id 初始化成 ''，spread 会把它带进来，
    // 这里统一清掉，让服务端按缺失 id 处理（service 会自动 createId）。
    if (!draft.id) delete (payload as { id?: string }).id
    else payload.id = draft.id
    const res = await window.spark.invoke('remote:save', { connection: payload })
    setConnections((prev) => {
      const exists = prev.some((item) => item.id === res.connection.id)
      return exists
        ? prev.map((item) => (item.id === res.connection.id ? res.connection : item))
        : [res.connection, ...prev]
    })
    setSelectedId(res.connection.id)
    setDraft(res.connection)
    await refreshRuntime()
    return res.connection
  }

  const applyWechatLoginPoll = (connectionId: string, response: RemoteWechatLoginPollResponse) => {
    setWechatQrSession((current) =>
      current?.connectionId === connectionId
        ? { ...current, status: response.status, message: response.message }
        : current,
    )
    if (response.connection != null) updateConnection(response.connection)
    if (response.status === 'confirmed' && response.connection != null) {
      toast.success('微信机器人授权成功；保存并启用后即可接收消息')
      void refreshRuntime()
    }
  }

  const startWechatQrLogin = async (connectionId = draft.id): Promise<boolean> => {
    setBusy('wechat-login')
    try {
      clearWechatQrSession()
      const id = connectionId || (await persistDraft()).id
      const result = await window.spark.invoke('remote:wechat-login-start', { id })
      setWechatQrSession({
        connectionId: id,
        ...result,
        status: 'wait',
        message: '请用手机微信扫描二维码，并在微信中确认授权。',
      })
      setWechatVerifyCode('')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成微信授权二维码失败')
      return false
    } finally {
      setBusy(null)
    }
  }

  const submitWechatVerifyCode = async () => {
    const login = wechatQrSession
    if (login == null || wechatVerifyCode.trim().length === 0) return
    setBusy('wechat-verify')
    try {
      const response = await window.spark.invoke('remote:wechat-login-poll', {
        id: login.connectionId,
        loginId: login.loginId,
        verifyCode: wechatVerifyCode.trim(),
      })
      setWechatVerifyCode('')
      applyWechatLoginPoll(login.connectionId, response)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setWechatQrSession((current) =>
        current?.loginId === login.loginId
          ? {
              ...current,
              status: 'expired',
              message: `验证码提交失败，请刷新二维码重试：${detail}`,
            }
          : current,
      )
      toast.error(err instanceof Error ? err.message : '微信验证码验证失败')
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = async () => {
    setBusy('save')
    try {
      await persistDraft()
      setEditorOpen(true)
      toast.success('远程连接已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(null)
    }
  }

  const createBotDraft = async (channel: RemoteChannelType) => {
    clearWechatQrSession()
    setBusy(`create:${channel}`)
    try {
      const res = await window.spark.invoke('remote:create-bot-draft', {
        channel,
        openConsole: channel !== 'wechat',
      })
      setConnections((prev) => [res.connection, ...prev])
      setSelectedId(res.connection.id)
      setDraft(res.connection)
      setEditorOpen(true)
      rememberChannel(channel)
      await refreshRuntime()
      if (channel === 'wechat') {
        await startWechatQrLogin(res.connection.id)
      } else {
        toast.success(`已创建 ${REMOTE_CHANNEL_LABELS[channel]} 草稿并打开平台入口`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建草稿失败')
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async () => {
    setBusy('test')
    try {
      // 先落盘表单里的最新配置再测试：后端 remote:test 只读持久化存储，
      // 不保存的话测的是旧配置；保存后 setDraft 已同步，refresh 不会清空表单。
      const saved = await persistDraft()
      const res = await window.spark.invoke('remote:test', { id: saved.id })
      toast[res.ok ? 'success' : 'error'](res.message)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '测试失败')
    } finally {
      setBusy(null)
    }
  }

  const generatePairing = async (mode: RemotePairingMode) => {
    if (!draft.id) {
      toast.error('请先保存连接')
      return
    }
    setBusy(`pair:${mode}`)
    try {
      const res = await window.spark.invoke('remote:generate-pairing', { id: draft.id, mode })
      setConnections((prev) =>
        prev.map((item) => (item.id === res.connection.id ? res.connection : item)),
      )
      setDraft(res.connection)
      await refreshRuntime()
      toast.success(mode === 'qr' ? '二维码配对负载已生成' : '配对码已生成')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成配对失败')
    } finally {
      setBusy(null)
    }
  }

  const copyPairingCommand = async () => {
    if (draft.pairing == null) return
    try {
      if (navigator.clipboard == null) throw new Error('当前环境不支持剪贴板')
      await navigator.clipboard.writeText(`/bind ${draft.pairing.code}`)
      toast.success('配对命令已复制')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制配对命令失败')
    }
  }

  const confirmPairing = async () => {
    if (!draft.id || draft.pairing == null) return
    if (manualPairUser.trim().length === 0) {
      toast.error('请输入远程用户 ID')
      return
    }
    setBusy('confirm-pair')
    try {
      const res = await window.spark.invoke('remote:confirm-pairing', {
        id: draft.id,
        code: draft.pairing.code,
        remoteUserId: manualPairUser.trim(),
        ...(manualPairName.trim().length > 0 ? { displayName: manualPairName.trim() } : {}),
      })
      setConnections((prev) =>
        prev.map((item) => (item.id === res.connection.id ? res.connection : item)),
      )
      setDraft(res.connection)
      await refreshRuntime()
      toast.success('配对已确认')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '确认配对失败')
    } finally {
      setBusy(null)
    }
  }

  const deleteConnection = async (id = draft.id) => {
    if (!id) {
      clearWechatQrSession()
      setDraft(createRemoteDraft(draft.channel))
      return
    }
    if (wechatQrSession?.connectionId === id) clearWechatQrSession()
    setBusy('delete')
    try {
      await window.spark.invoke('remote:delete', { id })
      const removed = connections.find((item) => item.id === id)
      const next = connections.filter((item) => item.id !== id)
      setConnections(next)
      if (selectedId === id || draft.id === id) {
        const fallback = next[0]
        setSelectedId(fallback?.id ?? '')
        setDraft(fallback ?? createRemoteDraft(removed?.channel ?? 'telegram'))
        setEditorOpen(false)
      }
      await refreshRuntime()
      toast.success('连接已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(null)
    }
  }

  const validateConnectionCredentials = async (connection: RemoteConnectionConfig) => {
    const validation = await window.spark.invoke('remote:test', { id: connection.id })
    const latest = await window.spark.invoke('remote:list', {})
    const updated = latest.connections.find((item) => item.id === connection.id)
    if (updated != null) updateConnection(updated)
    await refreshRuntime()
    if (!validation.ok) {
      toast.error(validation.message)
      return null
    }
    return updated ?? connection
  }

  const setConnectionEnabled = async (connection: RemoteConnectionConfig, enabled: boolean) => {
    setBusy(`connection:${connection.id}:${enabled ? 'enable' : 'disable'}`)
    try {
      const target = enabled ? await validateConnectionCredentials(connection) : connection
      if (target == null) return
      const res = await window.spark.invoke('remote:save', {
        connection: {
          ...target,
          enabled,
          status: enabled ? statusWhenEnabled(target) : 'disabled',
        },
      })
      updateConnection(res.connection)
      await refreshRuntime()
      toast.success(enabled ? '连接已开启' : '连接已关闭')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : enabled ? '开启连接失败' : '关闭连接失败')
    } finally {
      setBusy(null)
    }
  }

  const restartConnection = async (connection: RemoteConnectionConfig) => {
    if (!connection.enabled) return
    setBusy(`connection:${connection.id}:restart`)
    try {
      const target = await validateConnectionCredentials(connection)
      if (target == null) return
      const stopped = await window.spark.invoke('remote:save', {
        connection: { ...target, enabled: false, status: 'disabled' },
      })
      updateConnection(stopped.connection)
      const restarted = await window.spark.invoke('remote:save', {
        connection: {
          ...stopped.connection,
          enabled: true,
          status: statusWhenEnabled(stopped.connection),
        },
      })
      updateConnection(restarted.connection)
      await refreshRuntime()
      toast.success('连接已重启')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重启连接失败')
    } finally {
      setBusy(null)
    }
  }

  const webhookUrl =
    runtimeStatus.localBaseUrl != null && draft.id
      ? `${runtimeStatus.localBaseUrl}/remote/webhook/${draft.channel}/${draft.id}`
      : ''
  const polling = runtimeStatus.polling.find((item) => item.connectionId === draft.id)
  const longConnection = runtimeStatus.longConnections.find(
    (item) => item.connectionId === draft.id,
  )
  const selectedSession = sessions.find((item) => item.id === draft.defaultSessionId)
  const sessionBindingConflicts =
    draft.defaultSessionId == null
      ? []
      : connections.filter(
          (item) => item.id !== draft.id && item.defaultSessionId === draft.defaultSessionId,
        )
  const enabledCount = connections.filter((item) => item.enabled).length
  const connectedCount = connections.filter((item) => item.status === 'connected').length
  const draftChannelMeta = REMOTE_CHANNEL_META[draft.channel]
  const menuTargetSnapshot = connectionMenu.menu?.target
  const menuTarget =
    menuTargetSnapshot == null
      ? undefined
      : (connections.find((item) => item.id === menuTargetSnapshot.id) ?? menuTargetSnapshot)
  const connectionMenuItems: ContextMenuEntry[] =
    menuTarget == null
      ? []
      : [
          {
            key: 'configure',
            label: '配置',
            icon: <Icons.Settings size={14} />,
            disabled: busy != null,
            onClick: () => openConnectionEditor(menuTarget),
          },
          { type: 'divider' },
          {
            key: 'restart',
            label: '重启',
            icon: <Icons.Refresh size={14} />,
            disabled: busy != null || !menuTarget.enabled,
            onClick: () => void restartConnection(menuTarget),
          },
          {
            key: 'close',
            label: '关闭',
            icon: <Icons.Pause size={14} />,
            disabled: busy != null || !menuTarget.enabled,
            onClick: () => void setConnectionEnabled(menuTarget, false),
          },
          {
            key: 'enable',
            label: '开启',
            icon: <Icons.Play size={14} />,
            disabled: busy != null || menuTarget.enabled,
            onClick: () => void setConnectionEnabled(menuTarget, true),
          },
          { type: 'divider' },
          {
            key: 'delete',
            label: '删除',
            icon: <Icons.Trash size={14} />,
            danger: true,
            disabled: busy != null,
            onClick: () => void deleteConnection(menuTarget.id),
          },
        ]

  return (
    <div className="settings-section remote-settings">
      <div className="remote-settings-hero">
        <div>
          <h2>远程连接</h2>
          <div className="lede">
            通过 Telegram、飞书、QQ、微信从远程桌面或移动端与 SparkWork 通信。
          </div>
        </div>
        <div className="remote-runtime-summary">
          <span className={runtimeStatus.running ? 'live' : ''}>
            {runtimeStatus.running ? '运行中' : '未运行'}
          </span>
          <strong>
            {connectedCount}/{connections.length}
          </strong>
          <em>已连接</em>
        </div>
      </div>

      <div className="remote-runtime-bar">
        <div>
          <strong>{runtimeStatus.localBaseUrl ?? '本地 webhook 服务未启动'}</strong>
          <span>
            {enabledCount > 0
              ? `${enabledCount} 个渠道已启用，远程消息会进入各聊天独立绑定的会话`
              : '启用任一渠道后，远程消息才会被接收'}
          </span>
        </div>
        <Button
          size="middle"
          icon={<Icons.Refresh size={13} />}
          onClick={() => void refreshRuntime()}
        >
          刷新
        </Button>
      </div>

      <div className="remote-platform-strip">
        {AVAILABLE_REMOTE_CHANNELS.map((channel) => {
          const meta = REMOTE_CHANNEL_META[channel]
          return (
            <button
              key={channel}
              className={`remote-platform-card ${lastChannel === channel ? 'active' : ''}`}
              onClick={() => void createBotDraft(channel)}
              disabled={busy === `create:${channel}`}
            >
              <span className="remote-channel-logo">
                <img src={meta.icon} alt="" />
              </span>
              <span>
                <strong>{meta.label}</strong>
                <em>{busy === `create:${channel}` ? '创建中...' : meta.consoleLabel}</em>
              </span>
              <Icons.Plus size={14} />
            </button>
          )
        })}
      </div>

      <div className="remote-card-grid">
        <button
          className={`remote-connection-card new ${draft.id === '' ? 'active' : ''}`}
          onClick={() => {
            clearWechatQrSession()
            setSelectedId('')
            setDraft(createRemoteDraft(lastChannel))
            setEditorOpen(true)
          }}
        >
          <span className="remote-card-icon">
            <Icons.Plus size={18} />
          </span>
          <span className="remote-card-main">
            <span className="remote-card-title">新建连接</span>
            <span className="remote-card-desc">
              默认平台：{REMOTE_CHANNEL_META[lastChannel].label}
            </span>
          </span>
        </button>
        {loading && <div className="remote-muted-box">加载中...</div>}
        {connections.map((item) => {
          const meta = REMOTE_CHANNEL_META[item.channel]
          const session = sessions.find((entry) => entry.id === item.defaultSessionId)
          return (
            <button
              key={item.id}
              className={`remote-connection-card ${selectedId === item.id ? 'active' : ''}`}
              onClick={() => openConnectionEditor(item)}
              onContextMenu={(event) => connectionMenu.open(event, item)}
            >
              <span className="remote-card-top">
                <span className="remote-card-icon">
                  <img src={meta.icon} alt="" />
                </span>
                <span className="remote-card-main">
                  <span className="remote-card-title">{item.name}</span>
                  <span className="remote-card-desc">{meta.label}</span>
                </span>
                <Tag size="middle" color={REMOTE_STATUS_TONES[item.status]}>
                  {REMOTE_STATUS_LABELS[item.status]}
                </Tag>
              </span>
              <span className="remote-card-meta">
                <span>{item.enabled ? '已启用' : '未启用'}</span>
                <span>{item.pairedDevices.length} 个设备</span>
                <span>{session?.title || item.defaultSessionId || '未选会话'}</span>
              </span>
            </button>
          )
        })}
      </div>

      {connectionMenu.menu != null && (
        <ContextMenu
          x={connectionMenu.menu.x}
          y={connectionMenu.menu.y}
          items={connectionMenuItems}
          onClose={connectionMenu.close}
          ariaLabel={`${connectionMenu.menu.target.name}连接操作`}
        />
      )}

      <Modal
        open={editorOpen}
        title={
          <div className="remote-editor-title remote-editor-title--wide">
            <span className="remote-editor-logo">
              <img src={draftChannelMeta.icon} alt="" />
            </span>
            <span className="remote-editor-title-copy">
              <strong>{draft.id ? draft.name : `新建 ${draftChannelMeta.label}`}</strong>
              <span>{draftChannelMeta.setupHint}</span>
            </span>
            <Tag size="middle" color={REMOTE_STATUS_TONES[draft.status]}>
              {REMOTE_STATUS_LABELS[draft.status]}
            </Tag>
          </div>
        }
        footer={
          <div className="remote-actions">
            <Button
              danger
              size="middle"
              loading={busy === 'delete'}
              disabled={!draft.id}
              icon={<Icons.Trash size={14} />}
              onClick={() => void deleteConnection()}
            >
              删除
            </Button>
            <span className="remote-actions-spacer" />
            <Button
              size="middle"
              onClick={() => {
                clearWechatQrSession()
                setEditorOpen(false)
              }}
            >
              取消
            </Button>
            <Button
              size="middle"
              loading={busy === 'test'}
              disabled={!draft.id}
              icon={<Icons.Refresh size={13} />}
              onClick={() => void testConnection()}
            >
              测试配置
            </Button>
            <Button
              size="middle"
              type="primary"
              loading={busy === 'save'}
              icon={<Icons.Check size={14} />}
              onClick={() => void saveDraft()}
            >
              保存连接
            </Button>
          </div>
        }
        onCancel={() => {
          clearWechatQrSession()
          setEditorOpen(false)
        }}
        className="remote-editor-modal"
        maskClosable={false}
        width={980}
        height="min(68dvh, 680px)"
        paddings={{ desktop: 0, mobile: 0 }}
        styles={{ body: { height: 'min(68dvh, 680px)', overflow: 'hidden', padding: 0 } }}
      >
        <div className="remote-editor-body">
          <aside className="remote-editor-nav">
            {[
              ['基础', '连接名称 / 平台 / 默认会话'],
              ['凭证', draftChannelMeta.short + ' 机器人凭证'],
              ['授权', '允许名单 / 能力开关'],
              ['配对', '配对码 / webhook / 已绑定设备'],
              ['命令', '内置命令目录'],
            ].map(([title, desc]) => (
              <span key={title}>
                <strong>{title}</strong>
                <em>{desc}</em>
              </span>
            ))}
          </aside>

          <div className="remote-editor-scroll">
            <section className="remote-editor-section">
              <div className="subsec-h">基础</div>
              <div className="remote-channel-picker">
                {AVAILABLE_REMOTE_CHANNELS.map((channel) => {
                  const meta = REMOTE_CHANNEL_META[channel]
                  return (
                    <button
                      key={channel}
                      className={draft.channel === channel ? 'active' : ''}
                      onClick={() => {
                        if (channel !== 'wechat' && wechatQrSession?.connectionId === draft.id) {
                          clearWechatQrSession()
                        }
                        updateDraft({ channel, name: draft.name || meta.label })
                        rememberChannel(channel)
                      }}
                    >
                      <img src={meta.icon} alt="" />
                      <span>{meta.short}</span>
                    </button>
                  )
                })}
              </div>
              <div className="form-grid remote-form-grid">
                <label>连接名称</label>
                <Input value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} />

                <label>
                  启用连接<span className="sub">停用后不会接收远程消息</span>
                </label>
                <Switch
                  size="middle"
                  checked={draft.enabled}
                  onChange={(v) => updateDraft({ enabled: v })}
                />

                <label>
                  命令前缀<span className="sub">Telegram 可同步为 bot command</span>
                </label>
                <Input
                  value={draft.commandPrefix}
                  onChange={(e) => updateDraft({ commandPrefix: e.target.value || '/' })}
                />

                <label>
                  默认会话
                  <span className="sub">
                    仅供新的、唯一可识别的聊天首次绑定；已有聊天使用各自的会话
                  </span>
                </label>
                <Select
                  value={draft.defaultSessionId ?? ''}
                  onChange={(v) => {
                    const value = v
                    setDraft((prev) => {
                      const next = { ...prev }
                      if (value) next.defaultSessionId = value
                      else delete next.defaultSessionId
                      return next
                    })
                  }}
                  options={[
                    { label: '未选择', value: '' },
                    ...sessions.map((session) => ({
                      label: `${session.title || '新会话'} · ${session.id}`,
                      value: session.id,
                    })),
                  ]}
                />

                <label>
                  跨连接共享会话
                  <span className="sub">默认关闭；开启会共享对话历史和会话运行配置</span>
                </label>
                <Switch
                  size="middle"
                  checked={draft.allowSharedSession === true}
                  onChange={(value) => updateDraft({ allowSharedSession: value })}
                />
              </div>
              {sessionBindingConflicts.length > 0 && (
                <div className="remote-muted-box">
                  该会话也绑定到：{sessionBindingConflicts.map((item) => item.name).join('、')}。
                  只有所有相关连接都开启“跨连接共享会话”后才会共享；否则下一条远程消息会自动创建独立会话。
                </div>
              )}
              {selectedSession == null && draft.defaultSessionId != null && (
                <div className="remote-muted-box">
                  当前默认会话未在最近会话列表中找到：{draft.defaultSessionId}
                </div>
              )}
            </section>

            <section className="remote-editor-section">
              <div className="subsec-h">凭证</div>
              <div className="form-grid remote-form-grid">
                <RemoteCredentialFields draft={draft} updateCredential={updateCredential} />
              </div>
              {draft.channel === 'wechat' && (
                <div className="remote-muted-box">
                  <strong>
                    {draft.credentials.wechatBotToken
                      ? `微信已授权${draft.credentials.wechatBotId ? ` · ${draft.credentials.wechatBotId}` : ''}`
                      : '需要授权微信机器人'}
                  </strong>
                  {wechatQrSession?.connectionId === draft.id && (
                    <div className="remote-wechat-login">
                      {!['confirmed', 'expired', 'verify_code_blocked', 'binded_redirect'].includes(
                        wechatQrSession.status,
                      ) && (
                        <QRCodeSVG
                          value={wechatQrSession.qrPayload}
                          size={184}
                          level="M"
                          includeMargin
                          bgColor="white"
                          fgColor="#111827"
                        />
                      )}
                      <span>{wechatQrSession.message}</span>
                      {wechatQrSession.status === 'need_verifycode' && (
                        <div className="remote-manual-pair">
                          <Input
                            value={wechatVerifyCode}
                            onChange={(event) => setWechatVerifyCode(event.target.value)}
                            placeholder="微信客户端显示的数字验证码"
                          />
                          <Button
                            size="middle"
                            loading={busy === 'wechat-verify'}
                            onClick={() => void submitWechatVerifyCode()}
                          >
                            提交验证码
                          </Button>
                        </div>
                      )}
                      <small>
                        二维码过期时间：{new Date(wechatQrSession.expiresAt).toLocaleString()}
                      </small>
                    </div>
                  )}
                  {polling?.running ? (
                    <span>微信 iLink 长轮询已启动，可在微信 ClawBot 对话中发送 /bind 配对码。</span>
                  ) : polling?.lastError != null ? (
                    <span>微信长轮询未启动：{polling.lastError}</span>
                  ) : draft.credentials.wechatBotToken ? (
                    <span>
                      保存并启用连接后会启动长轮询；生成配对码后在微信中发送 /bind 配对码。
                    </span>
                  ) : null}
                  <Button
                    size="middle"
                    loading={busy === 'wechat-login'}
                    onClick={() => void startWechatQrLogin()}
                  >
                    {draft.credentials.wechatBotToken ? '重新扫码授权' : '扫码授权微信'}
                  </Button>
                </div>
              )}
              {draft.channel === 'telegram' && (
                <div className="remote-muted-box">
                  {polling?.running
                    ? 'Telegram polling 已启动，无需公网 webhook；发送 /bind 配对码 后即可使用。'
                    : polling?.lastError != null
                      ? `Telegram polling 未启动：${polling.lastError}`
                      : '保存并启用 Telegram Bot Token 后会自动启动 polling。'}
                </div>
              )}
              {draft.channel === 'feishu' && (
                <div className="remote-muted-box">
                  {longConnection?.running
                    ? '飞书 WebSocket 长连接已启动，无需公网 webhook；在飞书里发送 /bind 配对码 后即可使用。'
                    : longConnection?.lastError != null
                      ? `飞书长连接未启动：${longConnection.lastError}`
                      : '保存并启用 App ID / App Secret 后会自动启动飞书长连接。'}
                </div>
              )}
              {draft.channel === 'qq' && (
                <div className="remote-muted-box">
                  {longConnection?.running
                    ? 'QQ WebSocket 长连接已启动，无需公网 webhook；在 QQ 里发送 /bind 配对码 后即可使用（单聊直接私聊，群聊需 @机器人）。'
                    : longConnection?.lastError != null
                      ? `QQ 长连接未启动：${longConnection.lastError}`
                      : '保存并启用 AppID / AppSecret 后会自动启动 QQ 长连接；建议在 QQ 开放平台配置好群聊与单聊消息能力。'}
                  {/(op:9|code=40(13|14)|code=49(14|15))/.test(longConnection?.lastError ?? '') && (
                    <div className="remote-muted-hint">
                      该报错只影响当前这条连接对应的机器人（多条 QQ 连接相互独立）。常见原因与处理：
                      机器人未开通「群聊与单聊消息」能力（op:9 /
                      code=4014）——连接会自动降低事件订阅重试，
                      开通后重新启用本连接即可恢复全量订阅；机器人未上线时仅允许连接沙箱环境（code=4914）——
                      请到 QQ 开放平台 → 机器人管理核对消息能力与沙箱/上线配置。
                    </div>
                  )}
                </div>
              )}
            </section>
            <section className="remote-editor-section">
              <div className="subsec-h">配对</div>
              <div className="remote-pairing-panel">
                {webhookUrl && draft.channel === 'wechat-claw' && (
                  <div className="remote-webhook-box">
                    <span>{webhookUrl}</span>
                    <Button
                      size="middle"
                      icon={<Icons.Copy size={13} />}
                      onClick={() => void navigator.clipboard?.writeText(webhookUrl)}
                    >
                      复制
                    </Button>
                  </div>
                )}
                <div className="remote-pairing-actions">
                  <Button
                    size="middle"
                    disabled={!draft.id}
                    loading={busy === 'pair:code'}
                    onClick={() => void generatePairing('code')}
                  >
                    生成配对码
                  </Button>
                  <Button
                    size="middle"
                    disabled={!draft.id}
                    loading={busy === 'pair:qr'}
                    onClick={() => void generatePairing('qr')}
                  >
                    生成二维码配对
                  </Button>
                </div>
                {draft.pairing != null ? (
                  <div className="remote-pairing-body">
                    <div>
                      <div className="remote-pair-code">{draft.pairing.code}</div>
                      <div className="remote-pair-tip">
                        在 {REMOTE_CHANNEL_META[draft.channel].label} 中发送{' '}
                        <span className="remote-pair-command">
                          <code>/bind {draft.pairing.code}</code>
                          <button
                            type="button"
                            className="remote-pair-command-copy"
                            title="复制配对命令"
                            aria-label="复制配对命令"
                            onClick={() => void copyPairingCommand()}
                          >
                            <Icons.Copy size={13} />
                          </button>
                        </span>{' '}
                        完成配对。
                      </div>
                      <div className="muted text-xs-12">
                        过期时间：{new Date(draft.pairing.expiresAt).toLocaleString()}
                      </div>
                      <div className="remote-manual-pair">
                        <Input
                          value={manualPairUser}
                          onChange={(e) => setManualPairUser(e.target.value)}
                          placeholder="远程用户 ID"
                        />
                        <Input
                          value={manualPairName}
                          onChange={(e) => setManualPairName(e.target.value)}
                          placeholder="显示名称（可选）"
                        />
                        <Button
                          size="middle"
                          loading={busy === 'confirm-pair'}
                          onClick={() => void confirmPairing()}
                        >
                          手动确认
                        </Button>
                      </div>
                    </div>
                    <QrPayloadPreview payload={draft.pairing.qrPayload} />
                  </div>
                ) : (
                  <div className="remote-muted-box">
                    连接保存后生成一次性配对码，然后在远程聊天里发送 /bind 配对码 完成绑定。
                  </div>
                )}
                {draft.pairedDevices.length > 0 && (
                  <div className="remote-paired-list">
                    {draft.pairedDevices.map((device) => (
                      <Tag key={device.id} size="middle" color="green">
                        {device.displayName || device.remoteUserId}
                      </Tag>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="remote-editor-section">
              <div className="subsec-h">授权</div>
              <div className="form-grid remote-form-grid">
                <label>
                  允许用户 ID<span className="sub">英文逗号或换行分隔，留空表示配对后允许</span>
                </label>
                <TextArea
                  value={joinCsv(draft.allowedUserIds)}
                  onChange={(e) => updateDraft({ allowedUserIds: splitCsv(e.target.value) })}
                  rows={2}
                />

                <label>
                  允许会话/群 ID<span className="sub">用于群聊、频道或飞书群限制</span>
                </label>
                <TextArea
                  value={joinCsv(draft.allowedChatIds)}
                  onChange={(e) => updateDraft({ allowedChatIds: splitCsv(e.target.value) })}
                  rows={2}
                />
              </div>
              <div className="remote-cap-grid">
                {(
                  Object.entries(draft.capabilities) as Array<
                    [keyof RemoteConnectionCapabilities, boolean]
                  >
                )
                  .filter(([key]) => draft.channel !== 'wechat' || key !== 'transferFiles')
                  .map(([key, value]) => (
                    <div key={key} className="settings-card-row">
                      <div className="flex1 min-w-0">
                        <div className="row-title">{REMOTE_CAPABILITY_LABELS[key]}</div>
                        <div className="row-desc">{REMOTE_CAPABILITY_DESCS[key]}</div>
                      </div>
                      <div className="row-action">
                        <Switch
                          size="middle"
                          checked={value}
                          onChange={(v) => updateCapability(key, v)}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </section>

            <section className="remote-editor-section">
              <div className="subsec-h">命令</div>
              {draft.channel === 'telegram' && (
                <TextArea
                  value={draft.telegramCommands.join('\n')}
                  onChange={(e) => updateDraft({ telegramCommands: splitCsv(e.target.value) })}
                  rows={5}
                  placeholder="help&#10;sessions&#10;models&#10;agents"
                />
              )}
              {draft.channel === 'qq' && (
                <>
                  <TextArea
                    value={draft.qqCommands.join('\n')}
                    onChange={(e) => updateDraft({ qqCommands: splitCsv(e.target.value) })}
                    rows={5}
                    placeholder="help&#10;sessions&#10;models&#10;agents"
                  />
                  <div className="remote-muted-box">
                    保存并启用后自动注册为 QQ「指令面板」，单聊/群聊输入框上方可快捷点击；
                    命令名超出 14 字符的面板项会被跳过。
                  </div>
                </>
              )}
              <div className="remote-command-list">
                {commands.map((cmd) => (
                  <div key={cmd.name} className="remote-command-row">
                    <code>{cmd.usage}</code>
                    <span>{cmd.description}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </Modal>
    </div>
  )
}

const REMOTE_CAPABILITY_LABELS: Record<keyof RemoteConnectionCapabilities, string> = {
  sendMessages: '发送消息到会话',
  switchModel: '切换模型 / Provider',
  switchSession: '切换会话',
  switchAgent: '切换 Agent',
  manageWorkspace: '查看工作区',
  runCommands: '运行内置命令',
  approvePermissions: '远程审批权限',
  observeDesktop: '观察桌面',
  controlDesktop: '控制桌面',
  useInternalBrowser: '使用内置浏览器窗口',
  transferFiles: '传输文件',
  manageRuntime: '管理运行时',
  dangerousActions: '高危动作确认',
}

const REMOTE_CAPABILITY_DESCS: Record<keyof RemoteConnectionCapabilities, string> = {
  sendMessages: '允许远程端向当前聊天绑定的会话提交 /send 或普通消息',
  switchModel: '允许 /models、/providers、/use-model、/use-provider',
  switchSession: '允许 /sessions 与 /use-session',
  switchAgent: '允许 /agents 与 /use-agent',
  manageWorkspace: '允许 /workspaces 查看项目入口',
  runCommands: '允许解析命令前缀并执行命令目录',
  approvePermissions: '将待审批的权限请求发回本聊天；/approve 只对本次授权，/deny 拒绝',
  observeDesktop: '允许 /screen、/windows 查看桌面与窗口概览',
  controlDesktop: '允许 /focus、/click、/type、/hotkey 等桌面控制命令，默认关闭',
  useInternalBrowser:
    '允许远程会话打开本机可见的 spark_browser 窗口，并读取控制台 / 网络元信息，默认关闭',
  transferFiles:
    '允许 Telegram、飞书和 QQ 双向传输图片：入站图片进入当前会话识别；QQ 大图及 Telegram 发送失败时可使用 Spark 临时存储中转',
  manageRuntime: '允许 /progress、/queue、/history、/cancel 管理远程任务',
  dangerousActions: '允许 /confirm 确认高危动作，仍需二次确认',
}

function RemoteCredentialFields({
  draft,
  updateCredential,
}: {
  draft: RemoteConnectionConfig
  updateCredential: (key: keyof RemoteConnectionConfig['credentials'], value: string) => void
}) {
  if (draft.channel === 'telegram') {
    return (
      <>
        <label>Bot Token</label>
        <Input
          value={draft.credentials.botToken ?? ''}
          onChange={(e) => updateCredential('botToken', e.target.value)}
          placeholder="123456:ABC..."
        />
      </>
    )
  }
  if (draft.channel === 'feishu') {
    return (
      <>
        <label>App ID</label>
        <Input
          value={draft.credentials.appId ?? ''}
          onChange={(e) => updateCredential('appId', e.target.value)}
        />
        <label>App Secret</label>
        <Input
          value={draft.credentials.appSecret ?? ''}
          onChange={(e) => updateCredential('appSecret', e.target.value)}
        />
      </>
    )
  }
  if (draft.channel === 'qq') {
    return (
      <>
        <label>机器人 AppID</label>
        <Input
          value={draft.credentials.qqBotAppId ?? ''}
          onChange={(e) => updateCredential('qqBotAppId', e.target.value)}
        />
        <label>机器人 AppSecret</label>
        <Input
          value={draft.credentials.qqBotSecret ?? ''}
          onChange={(e) => updateCredential('qqBotSecret', e.target.value)}
        />
      </>
    )
  }
  if (draft.channel === 'wechat') {
    return (
      <>
        <label>授权方式</label>
        <span>使用微信 ClawBot 扫码授权，访问凭证由 SparkWork 保存在本机设置中。</span>
      </>
    )
  }
  return (
    <>
      <label>Claw Endpoint</label>
      <Input
        value={draft.credentials.clawEndpoint ?? ''}
        onChange={(e) => updateCredential('clawEndpoint', e.target.value)}
        placeholder="http://127.0.0.1:..."
      />
      <label>Access Token</label>
      <Input
        value={draft.credentials.clawAccessToken ?? ''}
        onChange={(e) => updateCredential('clawAccessToken', e.target.value)}
      />
    </>
  )
}

function QrPayloadPreview({ payload }: { payload: string }) {
  return (
    <button
      className="remote-qr"
      title={payload}
      onClick={() => void navigator.clipboard?.writeText(payload)}
    >
      <QRCodeSVG
        value={payload}
        size={128}
        level="M"
        includeMargin
        bgColor="transparent"
        fgColor="currentColor"
      />
      <small>点击复制二维码负载</small>
    </button>
  )
}
