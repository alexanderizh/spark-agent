import type { SidebarOrderState } from '../../../packages/protocol/src/sidebar-order'
import * as SecureStore from 'expo-secure-store'
import { randomUUID } from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Image,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  useColorScheme,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AccountPages, type AccountPage } from './AccountPages'
import { BridgeDevices } from './BridgeDevices'
import { AccountError, logout, me, refreshSession, type AuthSession } from './auth'
import { ChatCache } from './ChatCache'
import { Chat } from './Chat'
import { ChatDrafts } from './chat-draft'
import { DeviceList, NavigationRow, Profile, TabBar } from './CompanionTabs'
import { Projects } from './Projects'
import { ProjectComposer } from './ProjectComposer'
import {
  ProjectSessionControls,
  ProjectSessionHeading,
  ProjectSessionIcon,
  ProjectSessionRow,
  projectSessionGroups,
  type ProjectLabelFilter,
} from './ProjectSessionView'
import { readComposerFile, type ComposerFile } from './ChatComposerMedia'
import { REASONING_LABELS } from '../../mobile/src/utils/session-config-labels'
import type { Tab } from './CompanionTabs'
import { SessionSettings } from './SessionSettings'
import { SessionTasks } from './SessionTasks'
import { PasswordPage } from './PasswordPage'
import { DemoPage } from './DemoPage'
import { QuickStart } from './QuickStart'
import { WorkbenchDevices } from './WorkbenchDevices'
import { WorkbenchSettings, type WorkbenchConfig } from './WorkbenchSettings'
import {
  getSessionLabelMeta,
  getSessionPinTime,
  isSessionPinnedZone,
  sortByManualOrder,
  SESSION_LABELS,
} from '../../mobile/src/utils/sidebar-order'
import { DEFAULT_SESSION_FILTER, matchSession } from '../../mobile/src/utils/session-filters'
import { SessionFilters } from './ListFilters'
import { moveRowActions, RowMenu, type RowAction } from './RowMenu'
import { Login } from './Login'
import { Relay } from './relay'
import type { Device, Project, Session, SessionSearchHit } from './relay'
import { Action, ThemeContext, type ThemePreference, useUi } from './ui'

function DesktopSession({
  token,
  renew,
  exit,
}: {
  token: string
  renew(): Promise<AuthSession | undefined>
  exit(): void
}) {
  const { ui, colors, r } = useUi()
  const [settingsRevision, setSettingsRevision] = useState(0)
  const [devices, setDevices] = useState<Device[]>([])
  const [device, setDevice] = useState<Device>()
  const [tab, setTab] = useState<Tab>('工作台')
  const [accountPage, setAccountPage] = useState<
    AccountPage | '设备管理' | '修改密码' | '界面预览'
  >()
  const [picker, setPicker] = useState(false)
  const [project, setProject] = useState<Project>()
  const [focusProjectComposer, setFocusProjectComposer] = useState(false)
  const [showQuickSettings, setShowQuickSettings] = useState(false)
  const [projectText, setProjectText] = useState('')
  const [projectFiles, setProjectFiles] = useState<ComposerFile[]>([])
  const [projectSettings, setProjectSettings] = useState(false)
  const [projectConfig, setProjectConfig] = useState<WorkbenchConfig>({ runtime: {} })
  const [quickConfig, setQuickConfig] = useState<WorkbenchConfig>({ runtime: {} })
  const [showSettings, setShowSettings] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [quickText, setQuickText] = useState('')
  const [quickState, setQuickState] = useState<'ready' | 'sending' | 'unconfirmed'>('ready')
  const quickPending = useRef(false)
  const accountActive = useRef(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const session = sessions.at(-1)
  const [connection, setConnection] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [issue, setIssue] = useState('')
  const [drafts] = useState(() => new ChatDrafts())
  const [chatCache] = useState(() => new ChatCache())
  const renewAccount = useRef(renew)
  const refreshing = useRef(false)
  const renewed = useRef(false)
  const [relay] = useState(
    () =>
      new Relay(token, `rn-${randomUUID()}`, {
        presence: setDevices,
        state: setStatus,
        authExpired: () => {
          if (refreshing.current || renewed.current) return
          refreshing.current = true
          void renewAccount
            .current()
            .catch(() => {
              if (accountActive.current) {
                setIssue('暂时无法续期登录，重新进入 App 后重试')
                relay.retryAuthOnResume()
              }
            })
            .finally(() => {
              refreshing.current = false
            })
        },
        issue: setIssue,
        restored: () => {
          renewed.current = false
          setIssue('')
          setConnection((value) => value + 1)
        },
      }),
  )

  useEffect(() => {
    renewAccount.current = renew
    relay.renewToken(token, AppState.currentState !== 'background')
  }, [relay, renew, token])

  useEffect(() => {
    accountActive.current = true
    if (AppState.currentState !== 'background') relay.resume()
    const handle = AppState.addEventListener('change', (state) => {
      if (state === 'active') relay.resume()
      else if (state === 'background') relay.pause()
    })
    return () => {
      accountActive.current = false
      handle.remove()
      relay.pause()
    }
  }, [relay])

  const onlineDevices = status === 'online' ? devices : []
  const selected = device ?? onlineDevices[0]
  const desktopOnline =
    !!selected && onlineDevices.some((entry) => entry.deviceId === selected.deviceId)
  const nested = !!session || !!project || showAll || picker || !!accountPage
  const closeSettings = () => {
    setShowSettings(false)
    setSettingsRevision((value) => value + 1)
  }
  const back = () => {
    if (showTasks) setShowTasks(false)
    else if (showSettings) closeSettings()
    else if (session) setSessions((previous) => previous.slice(0, -1))
    else if (picker) setPicker(false)
    else if (accountPage) setAccountPage(undefined)
    else if (projectSettings) setProjectSettings(false)
    else if (project) {
      setProject(undefined)
      setProjectText('')
      setProjectFiles([])
    } else setShowAll(false)
  }
  useEffect(() => {
    if (!nested) return
    const handle = BackHandler.addEventListener('hardwareBackPress', () => {
      back()
      return true
    })
    return () => handle.remove()
  })

  const openExisting = () => {
    if (selected) setShowAll(true)
    else setPicker(true)
  }
  const openNew = async (
    projectToCreate?: Project,
    projectText = '',
    files: ComposerFile[] = [],
  ) => {
    const message =
      (projectToCreate ? projectText : quickText).trim() || (files.length ? '请查看附件' : '')
    const runtime = (projectToCreate ? projectConfig : quickConfig).runtime
    if (!selected || !desktopOnline || !message || quickPending.current || quickState !== 'ready')
      return
    const nextDevice = selected
    quickPending.current = true
    setQuickState('sending')
    try {
      const nextSession = await relay.createSession(
        nextDevice.deviceId,
        projectToCreate
          ? projectToCreate.id === 'default'
            ? undefined
            : projectToCreate.id
          : quickConfig.project?.id,
        message.slice(0, 30) || undefined,
      )
      if (!accountActive.current) return
      const target = { deviceId: nextDevice.deviceId, sessionId: nextSession.id }
      const draft = drafts.forTarget(target)
      draft.setText(message)
      if (files.length) chatCache.setFiles(target, files)
      if (Object.keys(runtime).length) {
        try {
          if (!(await relay.updateSession(target, runtime))) throw new Error('会话配置未确认')
        } catch {
          if (!accountActive.current) return
          Alert.alert('配置未确认', '会话已创建，首条消息保留为草稿。')
          setDevice(nextDevice)
          if (projectToCreate) {
            setProjectText('')
            setProjectFiles([])
          } else setQuickText('')
          setQuickState('ready')
          setSessions([nextSession])
          return
        }
      }
      if (!accountActive.current) return
      if (files.length) {
        const paths: string[] = []
        try {
          for (const file of files) {
            if (!accountActive.current) return
            paths.push(await relay.uploadAttachment(target, await readComposerFile(file)))
          }
          if (!accountActive.current) return
          if (await draft.send((text) => relay.submit(target, text, randomUUID(), paths))) {
            chatCache.setFiles(target, [])
          }
        } catch {
          if (!accountActive.current) return
          Alert.alert('附件上传失败', '会话已创建，消息和附件已保留为草稿。')
        }
      } else if (message) {
        void draft.send((text) => relay.submit(target, text, randomUUID()))
      }
      if (!accountActive.current) return
      setFocusProjectComposer(false)
      setDevice(nextDevice)
      if (projectToCreate) {
        setProjectText('')
        setProjectFiles([])
      } else setQuickText('')
      setQuickState('ready')
      setSessions([nextSession])
    } catch {
      if (accountActive.current) setQuickState('unconfirmed')
    } finally {
      quickPending.current = false
    }
  }

  const workbench = !nested && tab === '工作台'
  const chooseDevice = (selection: Device) => {
    setDevice(selection)
    if (selected?.deviceId !== selection.deviceId) setQuickConfig({ runtime: {} })
    if (picker && tab === '我的') setShowAll(true)
    else setTab('项目')
    setPicker(false)
  }
  const projectDetail = !!project && !session && !accountPage && !picker
  return (
    <SafeAreaView
      style={[ui.screen, projectDetail && { backgroundColor: colors.entry }]}
      edges={nested ? ['bottom'] : []}
    >
      {nested && (
        <View style={ui.header}>
          <View style={ui.headerSide}>
            {accountPage === '设备管理' || projectDetail ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="返回"
                hitSlop={8}
                onPress={back}
                style={({ pressed }) => ({
                  width: r(68),
                  height: r(68),
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: r(34),
                  borderColor: colors.line,
                  borderWidth: 0.5,
                  backgroundColor: pressed ? colors.tint : colors.paper,
                })}
              >
                {projectDetail ? (
                  <ProjectSessionIcon name="left" size={32} />
                ) : (
                  <Text style={{ color: colors.text, fontSize: r(38), lineHeight: r(42) }}>‹</Text>
                )}
              </Pressable>
            ) : (
              <Action label="返回" symbol="‹" onPress={back} />
            )}
          </View>
          <Text accessibilityRole="header" numberOfLines={1} style={ui.headerTitle}>
            {showTasks ? '定时任务' : session?.title || (picker ? '选择电脑' : accountPage || '')}
          </Text>
          <View style={ui.headerSide}>
            {session && !showTasks && !showSettings && (
              <Action label="更多会话操作" symbol="⋯" onPress={() => setShowSettings(true)} />
            )}
          </View>
        </View>
      )}
      {(!!issue || (session && !desktopOnline && !showTasks)) && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
          <Text accessibilityLiveRegion="polite" style={ui.error}>
            {issue || '电脑离线 · 可查看已同步的会话记录'}
          </Text>
        </View>
      )}
      {showTasks && selected && session ? (
        <SessionTasks
          relay={relay}
          deviceId={selected.deviceId}
          sessionId={session.id}
          online={desktopOnline}
        />
      ) : accountPage === '界面预览' ? (
        <DemoPage />
      ) : accountPage === '修改密码' ? (
        <PasswordPage token={token} exit={exit} />
      ) : accountPage === '设备管理' ? (
        <BridgeDevices token={token} onlineDevices={onlineDevices} />
      ) : accountPage ? (
        <AccountPages key={accountPage} token={token} page={accountPage} />
      ) : session && selected ? (
        <Chat
          key={JSON.stringify([selected.deviceId, session.id])}
          deviceId={selected.deviceId}
          sessionId={session.id}
          cache={chatCache}
          draft={drafts.forTarget({ deviceId: selected.deviceId, sessionId: session.id })}
          relay={relay}
          online={desktopOnline}
          connection={connection}
          openSettings={() => setShowSettings(true)}
          settingsRevision={settingsRevision}
          onNavigate={(next) => setSessions((previous) => [...previous, next])}
          back={() => {
            setSessions([])
            setProject(undefined)
            setShowAll(false)
            setTab('工作台')
          }}
        />
      ) : (project || showAll) && selected ? (
        <KeyboardAvoidingView
          style={ui.screen}
          behavior={project && Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SessionList
            key={JSON.stringify([selected.deviceId, project?.id, connection])}
            deviceId={selected.deviceId}
            projectId={project?.id}
            title={project?.name ?? '全部会话'}
            deviceLabel={selected.label}
            online={desktopOnline}
            relay={relay}
            backToProjects={back}
            manage={() => {
              setFocusProjectComposer(false)
              setAccountPage('设备管理')
            }}
            onSelect={(selection) => {
              setDevice(selected)
              setSessions([selection])
            }}
          />
          {project && (
            <ProjectComposer
              key={JSON.stringify([selected.deviceId, project.id])}
              name={project.name}
              text={projectText}
              setText={setProjectText}
              files={projectFiles}
              setFiles={setProjectFiles}
              unassigned={project.id === 'default'}
              model={projectConfig.modelName ?? projectConfig.providerName ?? '电脑默认模型'}
              effort={REASONING_LABELS[projectConfig.runtime.reasoningEffort ?? 'medium'] ?? ''}
              openSettings={() => {
                Keyboard.dismiss()
                setProjectSettings(true)
              }}
              autoFocus={focusProjectComposer}
              online={desktopOnline}
              state={quickState}
              send={(text, files) => void openNew(project, text, files)}
              unlock={() => setQuickState('ready')}
            />
          )}
          {project && projectSettings && (
            <WorkbenchSettings
              device={selected}
              relay={relay}
              config={projectConfig}
              change={setProjectConfig}
              close={() => setProjectSettings(false)}
            />
          )}
        </KeyboardAvoidingView>
      ) : picker || tab === '工作台' || (tab === '项目' && !selected) ? (
        <View style={ui.screen}>
          {workbench ? (
            <WorkbenchDevices
              token={token}
              onlineDevices={onlineDevices}
              active={device?.deviceId}
              onSelect={chooseDevice}
              manage={() => setAccountPage('设备管理')}
              profile={() => setTab('我的')}
              demo={() => setAccountPage('界面预览')}
            />
          ) : (
            <DeviceList
              devices={onlineDevices}
              active={selected?.deviceId}
              empty={status === 'online' ? '当前没有在线电脑' : '等候云中继连接'}
              onSelect={chooseDevice}
            />
          )}
          {!picker && tab === '工作台' && (
            <QuickStart
              device={desktopOnline ? selected : undefined}
              initialText={quickText}
              setText={setQuickText}
              send={() => void openNew()}
              state={quickState}
              unlock={() => setQuickState('ready')}
              showConfig={() => {
                if (quickState === 'ready' && selected) {
                  setDevice(selected)
                  setShowQuickSettings(true)
                }
              }}
              configSummary={[
                selected?.label ?? '选择电脑',
                quickConfig.project?.name ?? '未归属项目',
                quickConfig.modelName ?? quickConfig.providerName ?? '电脑默认模型',
              ].join(' · ')}
              showExisting={openExisting}
            />
          )}
          {workbench && showQuickSettings && selected && (
            <WorkbenchSettings
              key={selected.deviceId}
              device={selected}
              devices={onlineDevices}
              relay={relay}
              config={quickConfig}
              change={setQuickConfig}
              selectDevice={(selection) => {
                if (selection.deviceId === selected.deviceId) return
                setDevice(selection)
                setQuickConfig({ runtime: {} })
              }}
              close={() => setShowQuickSettings(false)}
            />
          )}
        </View>
      ) : tab === '项目' && selected ? (
        <Projects
          key={selected.deviceId}
          relay={relay}
          deviceId={selected.deviceId}
          deviceLabel={selected.label}
          online={desktopOnline}
          connection={connection}
          showAll={openExisting}
          changeDevice={() => setPicker(true)}
          backToComputers={() => setTab('工作台')}
          manage={() => setAccountPage('设备管理')}
          create={(value) => {
            setDevice(selected)
            setFocusProjectComposer(true)
            setProjectConfig({ runtime: {} })
            setProjectText('')
            setProjectFiles([])
            setProject(value)
          }}
          select={(value) => {
            setFocusProjectComposer(false)
            setDevice(selected)
            setProjectConfig({ runtime: {} })
            setProjectText('')
            setProjectFiles([])
            setProject(value)
          }}
        />
      ) : (
        <Profile
          token={token}
          status={status === 'online' ? '已连接' : '未连接'}
          desktopStatus={onlineDevices.length ? `${onlineDevices.length} 台在线` : '暂无在线电脑'}
          exit={exit}
          showExisting={openExisting}
          selectPage={setAccountPage}
        />
      )}
      {showSettings && selected && session && !showTasks && (
        <Modal transparent animationType="slide" onRequestClose={closeSettings}>
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
            <SafeAreaView
              edges={['bottom']}
              style={{
                height: '72%',
                backgroundColor: colors.paper,
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                overflow: 'hidden',
              }}
            >
              <View style={ui.header}>
                <Text style={ui.headerTitle}>会话配置</Text>
                <Action label="完成" onPress={closeSettings} />
              </View>
              <SessionSettings
                relay={relay}
                deviceId={selected.deviceId}
                sessionId={session.id}
                title={session.title}
                online={desktopOnline}
                openTasks={() => {
                  closeSettings()
                  setShowTasks(true)
                }}
                rename={(title) =>
                  setSessions((stack) =>
                    stack.map((item) => (item.id === session.id ? { ...item, title } : item)),
                  )
                }
                deleted={() => {
                  setShowSettings(false)
                  setSessions((stack) => stack.filter((item) => item.id !== session.id))
                }}
              />
            </SafeAreaView>
          </View>
        </Modal>
      )}
      {!nested && (
        <TabBar
          tab={tab}
          select={(nextTab) => {
            setShowQuickSettings(false)
            setTab(nextTab)
          }}
        />
      )}
    </SafeAreaView>
  )
}

function SessionList({
  deviceId,
  projectId,
  title,
  deviceLabel,
  online,
  relay,
  backToProjects,
  manage,
  onSelect,
}: {
  deviceId: string
  projectId?: string
  title: string
  deviceLabel: string
  online: boolean
  relay: Relay
  backToProjects(): void
  manage(): void
  onSelect(session: Session): void
}) {
  const { colors, ui, page, r } = useUi()
  const [sessions, setSessions] = useState<Session[]>([])
  const [offset, setOffset] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SessionSearchHit[]>()
  const [searchFailed, setSearchFailed] = useState(false)
  const query = search.trim()
  const [menu, setMenu] = useState<Session>()
  const [labels, setLabels] = useState(false)
  const [filter, setFilter] = useState(DEFAULT_SESSION_FILTER)
  const [labelFilter, setLabelFilter] = useState<ProjectLabelFilter>('')
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false)
  const matchProjectFilter = (row: Session) =>
    matchSession(row, filter) &&
    (!labelFilter ||
      (labelFilter === 'labeled'
        ? !!row.sessionLabel
        : (row.sessionLabel ?? 'unlabeled') === labelFilter))
  const [sidebar, setSidebar] = useState<SidebarOrderState>()
  const orderedProjectId = projectId && projectId !== 'default' ? projectId : undefined
  useEffect(() => {
    if (!online || !orderedProjectId) return
    let active = true
    void relay
      .readSidebarOrder(deviceId)
      .then((order) => {
        if (active) setSidebar(order)
      })
      .catch(() => {
        if (active) setSidebar(undefined)
      })
    return () => {
      active = false
    }
  }, [deviceId, online, orderedProjectId, relay, reload])
  const getSection = (pinned: boolean) =>
    sortByManualOrder(
      sessions
        .filter((row) => isSessionPinnedZone(row) === pinned)
        .sort((a, b) => {
          if (!projectId) return 0
          if (pinned) {
            const byPin = (getSessionPinTime(b) ?? '').localeCompare(getSessionPinTime(a) ?? '')
            if (byPin) return byPin
          }
          return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
        }),
      orderedProjectId
        ? (pinned ? sidebar?.pinnedSessionIdsByProject : sidebar?.sessionIdsByProject)?.[
            orderedProjectId
          ]
        : undefined,
      (row) => row.id,
    )
  const refresh = () => {
    setOffset(0)
    setReload((n) => n + 1)
  }
  const actions: RowAction[] = []
  if (menu) {
    const target = { deviceId, sessionId: menu.id }
    const labelAction = (sessionLabel: Session['sessionLabel'], label: string): RowAction => ({
      label,
      run: async () => {
        const result = await relay.updateSession(target, { sessionLabel })
        if (!result || !('sessionLabel' in result) || result.sessionLabel !== sessionLabel)
          throw new Error('会话标记未确认')
      },
    })
    if (labels)
      actions.push(
        ...SESSION_LABELS.map((label) => labelAction(label.key, label.label)),
        labelAction(null, '清除标记'),
      )
    else
      actions.push(
        {
          label: '重命名',
          prompt: { initial: menu.title },
          run: async (title) => {
            if ((await relay.updateSession(target, { title }))?.title !== title)
              throw new Error('标题未确认')
          },
        },
        {
          label: menu.pinnedAt ? '取消置顶' : '置顶',
          run: async () => {
            const changed = await relay.updateSession(target, { pinned: !menu.pinnedAt })
            if (!changed || (typeof changed.pinnedAt === 'string') === !!menu.pinnedAt)
              throw new Error('置顶未确认')
          },
        },
        {
          label: '归档',
          prompt: { confirmation: '归档后会话将从列表隐藏。' },
          run: async () => {
            if (!(await relay.updateSession(target, { archived: true })))
              throw new Error('归档未确认')
          },
        },
        {
          label: '删除会话',
          prompt: { confirmation: `「${menu.title}」将被删除，且不可恢复。` },
          run: async () => {
            if (!(await relay.deleteSession(target))) throw new Error('删除未确认')
          },
        },
      )
    if (!labels && orderedProjectId && sidebar && !loading && !issue && nextOffset === null) {
      const pinned = isSessionPinnedZone(menu)
      const section = getSection(pinned)
      actions.push(
        ...moveRowActions(
          menu.id,
          section.map((row) => row.id),
          section.filter(matchProjectFilter).map((row) => row.id),
          (itemIds) =>
            relay.saveSidebarOrder(deviceId, {
              scope: pinned ? 'pinned-sessions' : 'sessions',
              projectId: orderedProjectId,
              itemIds,
            }),
        ),
      )
    }
  }

  useEffect(() => {
    if (!online) return
    let current = true
    setLoading(true)
    setIssue('')
    void relay
      .sessions(deviceId, offset, projectId)
      .then((page) => {
        if (!current) return
        setSessions((previous) => {
          const rows = new Map((offset === 0 ? [] : previous).map((row) => [row.id, row]))
          for (const row of page.sessions) rows.set(row.id, row)
          return [...rows.values()]
        })
        setNextOffset(page.nextOffset)
      })
      .catch(() => {
        if (current) setIssue(offset === 0 ? '会话列表加载失败' : '更多会话加载失败')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [deviceId, offset, online, projectId, relay, reload])

  useEffect(() => {
    setSearchResults(undefined)
    setSearchFailed(false)
    if (!online || !query) return
    let current = true
    const timer = setTimeout(() => {
      void relay
        .searchSessions(deviceId, query, projectId)
        .then((rows) => {
          if (current) setSearchResults(rows)
        })
        .catch(() => {
          if (current) setSearchFailed(true)
        })
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [deviceId, online, projectId, query, relay, reload])

  const shown = query
    ? (searchResults ??
      (searchFailed
        ? sessions.filter((row) =>
            row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          )
        : []))
    : sessions

  const ordered = query ? shown : [...getSection(true), ...getSection(false)]
  const footer =
    !query && online && issue ? (
      <View style={ui.row}>
        <Text accessibilityLiveRegion="polite" style={[ui.error, { flex: 1 }]}>
          {issue}
        </Text>
        <Action
          label="重试"
          onPress={() => {
            setLoading(true)
            setIssue('')
            setReload((value) => value + 1)
          }}
        />
      </View>
    ) : (!query || searchFailed) && online && nextOffset !== null ? (
      <Action
        label={loading ? '正在加载…' : '加载更多'}
        disabled={loading}
        onPress={() => {
          if (nextOffset === null || loading) return
          setLoading(true)
          setOffset(nextOffset)
        }}
      />
    ) : null
  const rowMenu = menu && (
    <RowMenu
      key={labels ? 'labels' : 'session'}
      title={labels ? '设置标记' : menu.title}
      actions={actions}
      more={labels ? undefined : { label: '设置标记', open: () => setLabels(true) }}
      online={online}
      close={() => setMenu(undefined)}
      refresh={refresh}
    />
  )
  if (projectId) {
    const titleMatches = (row: Session) =>
      !query || row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    const qualifies = (row: Session) => titleMatches(row) && matchProjectFilter(row)
    const knownRows = new Map(sessions.map((row) => [row.id, row]))
    const titleHits: Session[] = []
    const snippets = new Map<string, string>()
    const contentMatches = query
      ? (searchResults ?? []).flatMap((hit) => {
          const known = knownRows.get(hit.id)
          if (known && titleMatches(known)) return []
          const row = { ...hit, ...known, updatedAt: known?.updatedAt ?? hit.updatedAt }
          if (!matchProjectFilter(row)) return []
          if (hit.matchType === 'title' || titleMatches(row)) {
            titleHits.push(row)
            return []
          }
          if (hit.snippet) snippets.set(row.id, hit.snippet)
          return [row]
        })
      : []
    type Entry =
      | { kind: 'controls'; id: 'controls' }
      | { kind: 'group'; id: string; label: string; pinned: boolean }
      | { kind: 'row'; id: string; row: Session; separator: boolean; match: boolean }
    const entries: Entry[] = [{ kind: 'controls', id: 'controls' }]
    if (online) {
      for (const group of projectSessionGroups(
        getSection(true).filter(qualifies),
        [...getSection(false).filter(qualifies), ...titleHits],
        contentMatches,
      )) {
        const pinned = group.key === 0
        entries.push({
          kind: 'group',
          id: `group:${group.key}`,
          label: pinned ? `${group.title} · ${group.rows.length}` : group.title,
          pinned,
        })
        if (pinned && pinnedCollapsed) continue
        group.rows.forEach((row, index) =>
          entries.push({
            kind: 'row',
            id: `row:${row.id}`,
            row,
            separator: index > 0,
            match: group.key === 6,
          }),
        )
      }
    }
    const empty = !online
      ? '这台电脑当前离线'
      : loading && offset === 0
        ? '加载中…'
        : query && !searchResults && !searchFailed
          ? '正在搜索…'
          : query || filter.statuses.length || labelFilter || filter.activity !== 'all'
            ? '没有匹配的会话'
            : '项目下还没有会话'
    return (
      <View style={ui.screen}>
        <FlatList
          data={entries}
          stickyHeaderIndices={[1]}
          keyExtractor={(entry) => entry.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <ProjectSessionHeading
              title={title}
              device={deviceLabel}
              online={online}
              back={backToProjects}
              manage={manage}
            />
          }
          ListFooterComponent={
            <View style={{ paddingHorizontal: r(32), paddingBottom: r(12) }}>
              {entries.length === 1 && !issue && (
                <Text style={[ui.muted, { textAlign: 'center', padding: r(48) }]}>{empty}</Text>
              )}
              {footer}
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'controls')
              return (
                <ProjectSessionControls
                  search={search}
                  setSearch={setSearch}
                  filter={filter}
                  setFilter={setFilter}
                  label={labelFilter}
                  setLabel={setLabelFilter}
                  searchFailed={searchFailed}
                />
              )
            if (item.kind === 'group') {
              const title = <Text style={ui.groupTitle}>{item.label}</Text>
              const style = { paddingHorizontal: r(32), paddingTop: r(24), paddingBottom: r(8) }
              return item.pinned ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !pinnedCollapsed }}
                  onPress={() => setPinnedCollapsed(!pinnedCollapsed)}
                  style={[ui.row, style, { justifyContent: 'space-between' }]}
                >
                  {title}
                  <ProjectSessionIcon
                    name={pinnedCollapsed ? 'right' : 'down'}
                    size={28}
                    color={colors.placeholder}
                  />
                </Pressable>
              ) : (
                <View style={style}>{title}</View>
              )
            }
            return (
              <ProjectSessionRow
                row={item.row}
                separator={item.separator}
                match={item.match}
                snippet={item.match ? snippets.get(item.row.id) : undefined}
                open={() => onSelect(item.row)}
                menu={
                  item.match
                    ? undefined
                    : () => {
                        setLabels(false)
                        setMenu(item.row)
                      }
                }
              />
            )
          }}
        />
        {rowMenu}
      </View>
    )
  }
  return (
    <View style={ui.screen}>
      <FlatList
        data={online ? (query ? ordered : ordered.filter((row) => matchSession(row, filter))) : []}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: r(14), marginBottom: r(12) }}>
            <Text accessibilityRole="header" style={ui.title}>
              {title}
            </Text>
            <Text style={ui.muted}>
              电脑 · {deviceLabel}
              {online ? '' : ' · 离线'}
            </Text>
            <TextInput
              style={[ui.input, ui.search]}
              placeholder="搜索会话标题或内容"
              accessibilityLabel="搜索会话"
              value={search}
              onChangeText={setSearch}
            />
            {!query && <SessionFilters filter={filter} change={setFilter} />}
            {searchFailed && <Text style={ui.muted}>仅搜索已加载的会话标题</Text>}
          </View>
        }
        contentContainerStyle={page(projectId ? 'project-sessions' : 'all-sessions')}
        ItemSeparatorComponent={() => <View style={ui.separator} />}
        keyExtractor={(row) => row.id}
        ListEmptyComponent={
          <Text style={ui.muted}>
            {!online
              ? '电脑不在线'
              : query
                ? searchResults || searchFailed
                  ? '没有匹配会话'
                  : '正在搜索…'
                : loading && offset === 0
                  ? '正在加载会话…'
                  : !issue && nextOffset === null
                    ? '没有匹配的会话'
                    : ''}
          </Text>
        }
        ListFooterComponent={footer}
        renderItem={({ item }) => (
          <NavigationRow
            label={item.title || '未命名会话'}
            subtitle={[
              item.pinnedAt ? '置顶' : undefined,
              getSessionLabelMeta(item.sessionLabel)?.label,
              item.preview,
            ]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => onSelect(item)}
            onLongPress={
              !query
                ? () => {
                    setLabels(false)
                    setMenu(item)
                  }
                : undefined
            }
          />
        )}
      />
      {rowMenu}
    </View>
  )
}

const sessionKey = 'sparkwork.companion.account'

function loadSavedSession(stored: string): AuthSession | undefined {
  try {
    const data: unknown = JSON.parse(stored)
    if (data && typeof data === 'object' && 'token' in data && typeof data.token === 'string') {
      return {
        token: data.token,
        refreshToken:
          'refreshToken' in data && typeof data.refreshToken === 'string'
            ? data.refreshToken
            : undefined,
      }
    }
  } catch {
    /* Treat a corrupt secure storage entry as signed out. */
  }
}

export function App() {
  const current = useColorScheme()
  const [preference, setPreference] = useState<ThemePreference>('system')
  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync('sparkwork.companion.theme')
      .then((value) => {
        if (active && (value === 'system' || value === 'light' || value === 'dark'))
          setPreference(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])
  const select = (next: ThemePreference) => {
    setPreference(next)
    void SecureStore.setItemAsync('sparkwork.companion.theme', next).catch(() => undefined)
  }
  return (
    <ThemeContext.Provider
      value={{
        mode: preference === 'system' ? (current === 'dark' ? 'dark' : 'light') : preference,
        preference,
        select,
      }}
    >
      <AppBody />
    </ThemeContext.Provider>
  )
}

function AppBody() {
  const { ui, theme, colors, page, r } = useUi()
  const [account, setAccount] = useState<AuthSession>()
  const [booting, setBooting] = useState(true)
  const activeAccount = useRef<AuthSession | undefined>(undefined)
  const acceptSession = (value: AuthSession) => {
    activeAccount.current = value
    setAccount(value)
    void SecureStore.setItemAsync(sessionKey, JSON.stringify(value)).catch(() => undefined)
  }
  useEffect(() => {
    let current = true
    const restore = async () => {
      const stored = await SecureStore.getItemAsync(sessionKey)
      const saved = stored ? loadSavedSession(stored) : undefined
      if (!saved || !current) return
      try {
        await me(saved.token)
        if (current) {
          activeAccount.current = saved
          setAccount(saved)
        }
      } catch (error) {
        if (!(error instanceof AccountError) || error.status !== 401) {
          if (current) {
            activeAccount.current = saved
            setAccount(saved)
          }
          return
        }
        if (saved.refreshToken && current) {
          const fresh = await refreshSession(saved.refreshToken)
          if (current) acceptSession(fresh)
        }
      }
    }
    void restore()
      .catch(() => undefined)
      .finally(() => {
        if (current) setBooting(false)
      })
    return () => {
      current = false
    }
  }, [])
  const renew = async () => {
    const previous = activeAccount.current
    if (!previous?.refreshToken) return
    try {
      const fresh = await refreshSession(previous.refreshToken)
      if (activeAccount.current === previous) acceptSession(fresh)
      return fresh
    } catch (error) {
      if (error instanceof AccountError && (error.status === 401 || error.status === 403)) return
      throw error
    }
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={ui.screen} edges={account ? ['top', 'left', 'right'] : undefined}>
        <StatusBar barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'} />
        {booting ? (
          <View
            style={[
              ui.screen,
              page('entry'),
              {
                backgroundColor: colors.entry,
                alignItems: 'center',
                justifyContent: 'center',
                gap: r(12),
              },
            ]}
          >
            <Image
              source={require('../../mobile/src/assets/brand/logo.png')}
              style={{
                width: r(144),
                height: r(144),
                borderRadius: r(32),
                backgroundColor: '#fff',
              }}
            />
            <Text style={[ui.section, { fontSize: r(40), letterSpacing: r(2) }]}>SparkWork</Text>
            <Text style={[ui.muted, { fontSize: r(24) }]}>正在恢复登录…</Text>
          </View>
        ) : account ? (
          <DesktopSession
            token={account.token}
            renew={renew}
            exit={() => {
              activeAccount.current = undefined
              setAccount(undefined)
              void SecureStore.deleteItemAsync(sessionKey).catch(() => undefined)
              void logout(account.token).catch(() => undefined)
            }}
          />
        ) : (
          <Login onLogin={acceptSession} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}
