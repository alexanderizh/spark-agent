import { useState, useEffect, useCallback, useMemo } from 'react'
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
import { useI18n, type TranslateFn } from '../i18n'
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

/** 全部渠道类型（用于「上次渠道」合法性判断，勿与对外可选渠道白名单混用）。 */
const REMOTE_CHANNEL_TYPES: readonly RemoteChannelType[] = [
  'telegram',
  'feishu',
  'qq',
  'wechat',
  'wechat-claw',
]

/** 渠道显示名（按语言生成）。 */
function getRemoteChannelLabels(t: TranslateFn): Record<RemoteChannelType, string> {
  return {
    telegram: 'Telegram',
    feishu: t('settings.remote.channel.feishu'),
    qq: t('settings.remote.channel.qq'),
    wechat: t('settings.remote.channel.wechat'),
    'wechat-claw': t('settings.remote.channel.wechatClaw'),
  }
}

/**
 * 对外可「新建」的远程通道白名单。
 * QQ 通道已改为官方 WebSocket 长连接接入（与飞书同构，客户端主动拉取，无需公网），
 * 微信 ClawBot 使用独立的 `wechat` 通道；旧 `wechat-claw` 自建网关连接仍保留兼容。
 */
const AVAILABLE_REMOTE_CHANNELS: RemoteChannelType[] = ['telegram', 'feishu', 'qq', 'wechat']

function getRemoteStatusLabels(
  t: TranslateFn,
): Record<RemoteConnectionConfig['status'], string> {
  return {
    disabled: t('settings.remote.status.disabled'),
    draft: t('settings.remote.status.draft'),
    'pending-pairing': t('settings.remote.status.pendingPairing'),
    connected: t('settings.remote.status.connected'),
    error: t('settings.remote.status.error'),
  }
}

const REMOTE_STATUS_TONES: Record<RemoteConnectionConfig['status'], string> = {
  disabled: 'default',
  draft: 'blue',
  'pending-pairing': 'orange',
  connected: 'green',
  error: 'red',
}

interface RemoteChannelMeta {
  label: string
  short: string
  icon: string
  consoleLabel: string
  setupHint: string
}

/** 渠道元数据（图标与品牌名固定，文案按语言生成）。 */
function getRemoteChannelMeta(t: TranslateFn): Record<RemoteChannelType, RemoteChannelMeta> {
  return {
    telegram: {
      label: 'Telegram',
      short: 'Telegram',
      icon: telegramLogo,
      consoleLabel: 'BotFather',
      setupHint: t('settings.remote.meta.telegramHint'),
    },
    feishu: {
      label: t('settings.remote.meta.feishuLabel'),
      short: t('settings.remote.meta.feishuShort'),
      icon: feishuLogo,
      consoleLabel: t('settings.remote.meta.feishuConsole'),
      setupHint: t('settings.remote.meta.feishuHint'),
    },
    qq: {
      label: t('settings.remote.meta.qqLabel'),
      short: 'QQ',
      icon: qqLogo,
      consoleLabel: t('settings.remote.meta.qqConsole'),
      setupHint: t('settings.remote.meta.qqHint'),
    },
    wechat: {
      label: t('settings.remote.meta.wechatLabel'),
      short: t('settings.remote.meta.wechatShort'),
      icon: wechatLogo,
      consoleLabel: t('settings.remote.meta.wechatConsole'),
      setupHint: t('settings.remote.meta.wechatHint'),
    },
    'wechat-claw': {
      label: t('settings.remote.meta.wechatClawLabel'),
      short: t('settings.remote.meta.wechatClawShort'),
      icon: wechatLogo,
      consoleLabel: t('settings.remote.meta.wechatClawConsole'),
      setupHint: t('settings.remote.meta.wechatClawHint'),
    },
  }
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

function createRemoteDraft(channel: RemoteChannelType, t: TranslateFn): RemoteConnectionConfig {
  const now = new Date().toISOString()
  return {
    id: '',
    channel,
    name: getRemoteChannelLabels(t)[channel],
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
  const { t } = useI18n()
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
  const [draft, setDraft] = useState<RemoteConnectionConfig>(() =>
    createRemoteDraft('telegram', t),
  )
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [manualPairUser, setManualPairUser] = useState('')
  const [manualPairName, setManualPairName] = useState('')
  const [wechatQrSession, setWechatQrSession] = useState<WechatQrSession | null>(null)
  const [wechatVerifyCode, setWechatVerifyCode] = useState('')
  const connectionMenu = useContextMenu<RemoteConnectionConfig>()

  const statusLabels = useMemo(() => getRemoteStatusLabels(t), [t])
  const channelMeta = useMemo(() => getRemoteChannelMeta(t), [t])

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
        if (
          res &&
          typeof res.value === 'string' &&
          REMOTE_CHANNEL_TYPES.includes(res.value as RemoteChannelType)
        ) {
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
        toast.error(err instanceof Error ? err.message : t('settings.remote.loadFailed'))
      } finally {
        setLoading(false)
      }
    },
    [selectedId, toast, t],
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
                message: t('settings.remote.authPollFailedDesc', { detail }),
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
    t,
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
      toast.success(t('settings.remote.wechatAuthorizedToast'))
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
        message: t('settings.remote.wechatScanHintDesc'),
      })
      setWechatVerifyCode('')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.remote.wechatQrFailed'))
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
              message: t('settings.remote.verifySubmitFailedDesc', { detail }),
            }
          : current,
      )
      toast.error(err instanceof Error ? err.message : t('settings.remote.wechatVerifyFailed'))
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = async () => {
    setBusy('save')
    try {
      await persistDraft()
      setEditorOpen(true)
      toast.success(t('settings.remote.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.remote.saveFailed'))
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
        toast.success(
          t('settings.remote.draftCreatedDesc', { channel: getRemoteChannelLabels(t)[channel] }),
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.remote.draftCreateFailed'))
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
      toast.error(err instanceof Error ? err.message : t('settings.remote.testFailed'))
    } finally {
      setBusy(null)
    }
  }

  const generatePairing = async (mode: RemotePairingMode) => {
    if (!draft.id) {
      toast.error(t('settings.remote.saveFirst'))
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
      toast.success(
        mode === 'qr'
          ? t('settings.remote.qrPairingGenerated')
          : t('settings.remote.pairingGenerated'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.remote.pairingFailed'))
    } finally {
      setBusy(null)
    }
  }

  const copyPairingCommand = async () => {
    if (draft.pairing == null) return
    try {
      if (navigator.clipboard == null) throw new Error(t('settings.remote.clipboardUnsupported'))
      await navigator.clipboard.writeText(`/bind ${draft.pairing.code}`)
      toast.success(t('settings.remote.pairCommandCopied'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.remote.copyPairCommandFailed'))
    }
  }

  const confirmPairing = async () => {
    if (!draft.id || draft.pairing == null) return
    if (manualPairUser.trim().length === 0) {
      toast.error(t('settings.remote.userIdRequired'))
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
      toast.success(t('settings.remote.pairingConfirmed'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.remote.confirmPairingFailed'))
    } finally {
      setBusy(null)
    }
  }

  const deleteConnection = async (id = draft.id) => {
    if (!id) {
      clearWechatQrSession()
      setDraft(createRemoteDraft(draft.channel, t))
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
        setDraft(fallback ?? createRemoteDraft(removed?.channel ?? 'telegram', t))
        setEditorOpen(false)
      }
      await refreshRuntime()
      toast.success(t('settings.remote.deleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.remote.deleteFailed'))
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
      toast.success(
        enabled ? t('settings.remote.enabledToast') : t('settings.remote.disabledToast'),
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : enabled
            ? t('settings.remote.enableFailed')
            : t('settings.remote.disableFailed'),
      )
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
      toast.success(t('settings.remote.restarted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.remote.restartFailed'))
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
  const draftChannelMeta = channelMeta[draft.channel]
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
            label: t('settings.remote.menuConfigure'),
            icon: <Icons.Settings size={14} />,
            disabled: busy != null,
            onClick: () => openConnectionEditor(menuTarget),
          },
          { type: 'divider' },
          {
            key: 'restart',
            label: t('settings.remote.menuRestart'),
            icon: <Icons.Refresh size={14} />,
            disabled: busy != null || !menuTarget.enabled,
            onClick: () => void restartConnection(menuTarget),
          },
          {
            key: 'close',
            label: t('settings.remote.menuDisable'),
            icon: <Icons.Pause size={14} />,
            disabled: busy != null || !menuTarget.enabled,
            onClick: () => void setConnectionEnabled(menuTarget, false),
          },
          {
            key: 'enable',
            label: t('settings.remote.menuEnable'),
            icon: <Icons.Play size={14} />,
            disabled: busy != null || menuTarget.enabled,
            onClick: () => void setConnectionEnabled(menuTarget, true),
          },
          { type: 'divider' },
          {
            key: 'delete',
            label: t('settings.remote.menuDelete'),
            icon: <Icons.Trash size={14} />,
            danger: true,
            disabled: busy != null,
            onClick: () => void deleteConnection(menuTarget.id),
          },
        ]

  const editorNavItems = [
    [t('settings.remote.navBasic'), t('settings.remote.navBasicDesc')],
    [
      t('settings.remote.navCredentials'),
      t('settings.remote.navCredentialsDesc', { name: draftChannelMeta.short }),
    ],
    [t('settings.remote.navAuth'), t('settings.remote.navAuthDesc')],
    [t('settings.remote.navPairing'), t('settings.remote.navPairingDesc')],
    [t('settings.remote.navCommands'), t('settings.remote.navCommandsDesc')],
  ] as const

  return (
    <div className="settings-section remote-settings">
      <div className="remote-settings-hero">
        <div>
          <h2>{t('settings.remote.title')}</h2>
          <div className="lede">{t('settings.remote.ledeDesc')}</div>
        </div>
        <div className="remote-runtime-summary">
          <span className={runtimeStatus.running ? 'live' : ''}>
            {runtimeStatus.running
              ? t('settings.remote.running')
              : t('settings.remote.notRunning')}
          </span>
          <strong>
            {connectedCount}/{connections.length}
          </strong>
          <em>{t('settings.remote.connectedLabel')}</em>
        </div>
      </div>

      <div className="remote-runtime-bar">
        <div>
          <strong>
            {runtimeStatus.localBaseUrl ?? t('settings.remote.webhookNotStarted')}
          </strong>
          <span>
            {enabledCount > 0
              ? t('settings.remote.enabledChannelsDesc', { count: enabledCount })
              : t('settings.remote.noneEnabledDesc')}
          </span>
        </div>
        <Button
          size="middle"
          icon={<Icons.Refresh size={13} />}
          onClick={() => void refreshRuntime()}
        >
          {t('settings.remote.refreshBtn')}
        </Button>
      </div>

      <div className="remote-platform-strip">
        {AVAILABLE_REMOTE_CHANNELS.map((channel) => {
          const meta = channelMeta[channel]
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
                <em>
                  {busy === `create:${channel}` ? t('settings.remote.creating') : meta.consoleLabel}
                </em>
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
            setDraft(createRemoteDraft(lastChannel, t))
            setEditorOpen(true)
          }}
        >
          <span className="remote-card-icon">
            <Icons.Plus size={18} />
          </span>
          <span className="remote-card-main">
            <span className="remote-card-title">{t('settings.remote.newConnection')}</span>
            <span className="remote-card-desc">
              {t('settings.remote.defaultPlatformDesc', { platform: channelMeta[lastChannel].label })}
            </span>
          </span>
        </button>
        {loading && <div className="remote-muted-box">{t('settings.remote.loading')}</div>}
        {connections.map((item) => {
          const meta = channelMeta[item.channel]
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
                  {statusLabels[item.status]}
                </Tag>
              </span>
              <span className="remote-card-meta">
                <span>
                  {item.enabled
                    ? t('settings.remote.enabledLabel')
                    : t('settings.remote.notEnabledLabel')}
                </span>
                <span>{t('settings.remote.deviceCount', { count: item.pairedDevices.length })}</span>
                <span>
                  {session?.title || item.defaultSessionId || t('settings.remote.noSession')}
                </span>
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
          ariaLabel={t('settings.remote.connectionActionsAria', {
            name: connectionMenu.menu.target.name,
          })}
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
              <strong>
                {draft.id
                  ? draft.name
                  : t('settings.remote.newNamedTitle', { name: draftChannelMeta.label })}
              </strong>
              <span>{draftChannelMeta.setupHint}</span>
            </span>
            <Tag size="middle" color={REMOTE_STATUS_TONES[draft.status]}>
              {statusLabels[draft.status]}
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
              {t('settings.remote.deleteBtn')}
            </Button>
            <span className="remote-actions-spacer" />
            <Button
              size="middle"
              onClick={() => {
                clearWechatQrSession()
                setEditorOpen(false)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="middle"
              loading={busy === 'test'}
              disabled={!draft.id}
              icon={<Icons.Refresh size={13} />}
              onClick={() => void testConnection()}
            >
              {t('settings.remote.testBtn')}
            </Button>
            <Button
              size="middle"
              type="primary"
              loading={busy === 'save'}
              icon={<Icons.Check size={14} />}
              onClick={() => void saveDraft()}
            >
              {t('settings.remote.saveBtn')}
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
            {editorNavItems.map(([title, desc]) => (
              <span key={title}>
                <strong>{title}</strong>
                <em>{desc}</em>
              </span>
            ))}
          </aside>

          <div className="remote-editor-scroll">
            <section className="remote-editor-section">
              <div className="subsec-h">{t('settings.remote.navBasic')}</div>
              <div className="remote-channel-picker">
                {AVAILABLE_REMOTE_CHANNELS.map((channel) => {
                  const meta = channelMeta[channel]
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
                <label>{t('settings.remote.connectionNameLabel')}</label>
                <Input value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} />

                <label>
                  {t('settings.remote.enableLabel')}
                  <span className="sub">{t('settings.remote.enableHint')}</span>
                </label>
                <Switch
                  size="middle"
                  checked={draft.enabled}
                  onChange={(v) => updateDraft({ enabled: v })}
                />

                <label>
                  {t('settings.remote.prefixLabel')}
                  <span className="sub">{t('settings.remote.prefixHint')}</span>
                </label>
                <Input
                  value={draft.commandPrefix}
                  onChange={(e) => updateDraft({ commandPrefix: e.target.value || '/' })}
                />

                <label>
                  {t('settings.remote.defaultSessionLabel')}
                  <span className="sub">{t('settings.remote.defaultSessionHintDesc')}</span>
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
                    { label: t('settings.remote.noSelection'), value: '' },
                    ...sessions.map((session) => ({
                      label: `${session.title || t('settings.remote.newSessionFallback')} · ${session.id}`,
                      value: session.id,
                    })),
                  ]}
                />

                <label>
                  {t('settings.remote.shareSession')}
                  <span className="sub">{t('settings.remote.shareSessionHint')}</span>
                </label>
                <Switch
                  size="middle"
                  checked={draft.allowSharedSession === true}
                  onChange={(value) => updateDraft({ allowSharedSession: value })}
                />
              </div>
              {sessionBindingConflicts.length > 0 && (
                <div className="remote-muted-box">
                  {t('settings.remote.conflictNoticeLongDesc', {
                    names: sessionBindingConflicts.map((item) => item.name).join(', '),
                  })}
                </div>
              )}
              {selectedSession == null && draft.defaultSessionId != null && (
                <div className="remote-muted-box">
                  {t('settings.remote.sessionNotFoundDesc', { id: draft.defaultSessionId })}
                </div>
              )}
            </section>

            <section className="remote-editor-section">
              <div className="subsec-h">{t('settings.remote.navCredentials')}</div>
              <div className="form-grid remote-form-grid">
                <RemoteCredentialFields draft={draft} updateCredential={updateCredential} />
              </div>
              {draft.channel === 'wechat' && (
                <div className="remote-muted-box">
                  <strong>
                    {draft.credentials.wechatBotToken
                      ? t('settings.remote.wechatAuthorized', {
                          suffix: draft.credentials.wechatBotId
                            ? ` · ${draft.credentials.wechatBotId}`
                            : '',
                        })
                      : t('settings.remote.wechatNeedAuth')}
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
                            placeholder={t('settings.remote.wechatCodePlaceholder')}
                          />
                          <Button
                            size="middle"
                            loading={busy === 'wechat-verify'}
                            onClick={() => void submitWechatVerifyCode()}
                          >
                            {t('settings.remote.submitCodeBtn')}
                          </Button>
                        </div>
                      )}
                      <small>
                        {t('settings.remote.qrExpires', {
                          time: new Date(wechatQrSession.expiresAt).toLocaleString(),
                        })}
                      </small>
                    </div>
                  )}
                  {polling?.running ? (
                    <span>{t('settings.remote.wechatPollingOnDesc')}</span>
                  ) : polling?.lastError != null ? (
                    <span>
                      {t('settings.remote.wechatPollingOffDesc', { error: polling.lastError })}
                    </span>
                  ) : draft.credentials.wechatBotToken ? (
                    <span>{t('settings.remote.wechatPollingHintDesc')}</span>
                  ) : null}
                  <Button
                    size="middle"
                    loading={busy === 'wechat-login'}
                    onClick={() => void startWechatQrLogin()}
                  >
                    {draft.credentials.wechatBotToken
                      ? t('settings.remote.wechatReauthBtn')
                      : t('settings.remote.wechatAuthBtn')}
                  </Button>
                </div>
              )}
              {draft.channel === 'telegram' && (
                <div className="remote-muted-box">
                  {polling?.running
                    ? t('settings.remote.telegramPollingOnDesc')
                    : polling?.lastError != null
                      ? t('settings.remote.telegramPollingOffDesc', { error: polling.lastError })
                      : t('settings.remote.telegramPollingHintDesc')}
                </div>
              )}
              {draft.channel === 'feishu' && (
                <div className="remote-muted-box">
                  {longConnection?.running
                    ? t('settings.remote.feishuConnOnDesc')
                    : longConnection?.lastError != null
                      ? t('settings.remote.feishuConnOffDesc', { error: longConnection.lastError })
                      : t('settings.remote.feishuConnHintDesc')}
                </div>
              )}
              {draft.channel === 'qq' && (
                <div className="remote-muted-box">
                  {longConnection?.running
                    ? t('settings.remote.qqConnOnLongDesc')
                    : longConnection?.lastError != null
                      ? t('settings.remote.qqConnOffDesc', { error: longConnection.lastError })
                      : t('settings.remote.qqConnHintLongDesc')}
                  {/(op:9|code=40(13|14)|code=49(14|15))/.test(longConnection?.lastError ?? '') && (
                    <div className="remote-muted-hint">
                      {t('settings.remote.qqErrorHintLongDesc')}
                    </div>
                  )}
                </div>
              )}
            </section>
            <section className="remote-editor-section">
              <div className="subsec-h">{t('settings.remote.navPairing')}</div>
              <div className="remote-pairing-panel">
                {webhookUrl && draft.channel === 'wechat-claw' && (
                  <div className="remote-webhook-box">
                    <span>{webhookUrl}</span>
                    <Button
                      size="middle"
                      icon={<Icons.Copy size={13} />}
                      onClick={() => void navigator.clipboard?.writeText(webhookUrl)}
                    >
                      {t('settings.remote.copyBtn')}
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
                    {t('settings.remote.generateCodeBtn')}
                  </Button>
                  <Button
                    size="middle"
                    disabled={!draft.id}
                    loading={busy === 'pair:qr'}
                    onClick={() => void generatePairing('qr')}
                  >
                    {t('settings.remote.generateQrBtn')}
                  </Button>
                </div>
                {draft.pairing != null ? (
                  <div className="remote-pairing-body">
                    <div>
                      <div className="remote-pair-code">{draft.pairing.code}</div>
                      <div className="remote-pair-tip">
                        {t('settings.remote.pairTipPrefix', {
                          channel: channelMeta[draft.channel].label,
                        })}{' '}
                        <span className="remote-pair-command">
                          <code>/bind {draft.pairing.code}</code>
                          <button
                            type="button"
                            className="remote-pair-command-copy"
                            title={t('settings.remote.copyPairCommand')}
                            aria-label={t('settings.remote.copyPairCommand')}
                            onClick={() => void copyPairingCommand()}
                          >
                            <Icons.Copy size={13} />
                          </button>
                        </span>{' '}
                        {t('settings.remote.pairTipSuffix')}
                      </div>
                      <div className="muted text-xs-12">
                        {t('settings.remote.pairExpires', {
                          time: new Date(draft.pairing.expiresAt).toLocaleString(),
                        })}
                      </div>
                      <div className="remote-manual-pair">
                        <Input
                          value={manualPairUser}
                          onChange={(e) => setManualPairUser(e.target.value)}
                          placeholder={t('settings.remote.remoteUserIdPlaceholder')}
                        />
                        <Input
                          value={manualPairName}
                          onChange={(e) => setManualPairName(e.target.value)}
                          placeholder={t('settings.remote.displayNamePlaceholder')}
                        />
                        <Button
                          size="middle"
                          loading={busy === 'confirm-pair'}
                          onClick={() => void confirmPairing()}
                        >
                          {t('settings.remote.confirmManualBtn')}
                        </Button>
                      </div>
                    </div>
                    <QrPayloadPreview payload={draft.pairing.qrPayload} />
                  </div>
                ) : (
                  <div className="remote-muted-box">{t('settings.remote.pairingHintDesc')}</div>
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
              <div className="subsec-h">{t('settings.remote.navAuth')}</div>
              <div className="form-grid remote-form-grid">
                <label>
                  {t('settings.remote.allowedUsersLabel')}
                  <span className="sub">{t('settings.remote.allowedUsersHint')}</span>
                </label>
                <TextArea
                  value={joinCsv(draft.allowedUserIds)}
                  onChange={(e) => updateDraft({ allowedUserIds: splitCsv(e.target.value) })}
                  rows={2}
                />

                <label>
                  {t('settings.remote.allowedChatsLabel')}
                  <span className="sub">{t('settings.remote.allowedChatsHint')}</span>
                </label>
                <TextArea
                  value={joinCsv(draft.allowedChatIds)}
                  onChange={(e) => updateDraft({ allowedChatIds: splitCsv(e.target.value) })}
                  rows={2}
                />
              </div>
              <div className="remote-cap-grid">
                <RemoteCapabilityGrid
                  capabilities={draft.capabilities}
                  channel={draft.channel}
                  onChange={updateCapability}
                />
              </div>
            </section>

            <section className="remote-editor-section">
              <div className="subsec-h">{t('settings.remote.navCommands')}</div>
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
                    {t('settings.remote.qqPanelHintLongDesc')}
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

function getRemoteCapabilityLabels(
  t: TranslateFn,
): Record<keyof RemoteConnectionCapabilities, string> {
  return {
    sendMessages: t('settings.remote.cap.sendMessagesTitle'),
    switchModel: t('settings.remote.cap.switchModelTitle'),
    switchSession: t('settings.remote.cap.switchSessionTitle'),
    switchAgent: t('settings.remote.cap.switchAgentTitle'),
    manageWorkspace: t('settings.remote.cap.manageWorkspaceTitle'),
    runCommands: t('settings.remote.cap.runCommandsTitle'),
    approvePermissions: t('settings.remote.cap.approvePermissionsTitle'),
    observeDesktop: t('settings.remote.cap.observeDesktopTitle'),
    controlDesktop: t('settings.remote.cap.controlDesktopTitle'),
    useInternalBrowser: t('settings.remote.cap.useInternalBrowserTitle'),
    transferFiles: t('settings.remote.cap.transferFilesTitle'),
    manageRuntime: t('settings.remote.cap.manageRuntimeTitle'),
    dangerousActions: t('settings.remote.cap.dangerousActionsTitle'),
  }
}

function getRemoteCapabilityDescs(
  t: TranslateFn,
): Record<keyof RemoteConnectionCapabilities, string> {
  return {
    sendMessages: t('settings.remote.cap.sendMessagesDesc'),
    switchModel: t('settings.remote.cap.switchModelDesc'),
    switchSession: t('settings.remote.cap.switchSessionDesc'),
    switchAgent: t('settings.remote.cap.switchAgentDesc'),
    manageWorkspace: t('settings.remote.cap.manageWorkspaceDesc'),
    runCommands: t('settings.remote.cap.runCommandsDesc'),
    approvePermissions: t('settings.remote.cap.approvePermissionsDesc'),
    observeDesktop: t('settings.remote.cap.observeDesktopDesc'),
    controlDesktop: t('settings.remote.cap.controlDesktopDesc'),
    useInternalBrowser: t('settings.remote.cap.useInternalBrowserLongDesc'),
    transferFiles: t('settings.remote.cap.transferFilesLongDesc'),
    manageRuntime: t('settings.remote.cap.manageRuntimeDesc'),
    dangerousActions: t('settings.remote.cap.dangerousActionsDesc'),
  }
}

function RemoteCapabilityGrid({
  capabilities,
  channel,
  onChange,
}: {
  capabilities: RemoteConnectionCapabilities
  channel: RemoteChannelType
  onChange: (key: keyof RemoteConnectionCapabilities, value: boolean) => void
}) {
  const { t } = useI18n()
  const labels = useMemo(() => getRemoteCapabilityLabels(t), [t])
  const descs = useMemo(() => getRemoteCapabilityDescs(t), [t])
  return (
    <>
      {(
        Object.entries(capabilities) as Array<[keyof RemoteConnectionCapabilities, boolean]>
      )
        .filter(([key]) => channel !== 'wechat' || key !== 'transferFiles')
        .map(([key, value]) => (
          <div key={key} className="settings-card-row">
            <div className="flex1 min-w-0">
              <div className="row-title">{labels[key]}</div>
              <div className="row-desc">{descs[key]}</div>
            </div>
            <div className="row-action">
              <Switch
                size="middle"
                checked={value}
                onChange={(v) => onChange(key, v)}
              />
            </div>
          </div>
        ))}
    </>
  )
}

function RemoteCredentialFields({
  draft,
  updateCredential,
}: {
  draft: RemoteConnectionConfig
  updateCredential: (key: keyof RemoteConnectionConfig['credentials'], value: string) => void
}) {
  const { t } = useI18n()
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
        <label>{t('settings.remote.cred.appIdLabel')}</label>
        <Input
          value={draft.credentials.qqBotAppId ?? ''}
          onChange={(e) => updateCredential('qqBotAppId', e.target.value)}
        />
        <label>{t('settings.remote.cred.appSecretLabel')}</label>
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
        <label>{t('settings.remote.cred.authModeLabel')}</label>
        <span>{t('settings.remote.cred.wechatAuthDesc')}</span>
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
  const { t } = useI18n()
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
      <small>{t('settings.remote.qrPayloadHint')}</small>
    </button>
  )
}
