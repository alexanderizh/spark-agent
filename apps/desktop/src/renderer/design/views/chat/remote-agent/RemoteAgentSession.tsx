import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  RemoteAgentDeviceSummary,
  RemoteAgentRelayStatus,
  RemoteAgentTask,
} from '@spark/protocol'
import { useIpcInvoke, useIpcStream } from '../../../hooks/useIpc'

interface RemoteAgentSessionState {
  sessionId: string
  tasks: RemoteAgentTask[]
  devices: RemoteAgentDeviceSummary[]
  relayStatus: RemoteAgentRelayStatus
  taskError: string | null
  relayError: string | null
  taskEventsRevision: number
  drawerOpen: boolean
  selectedTaskId: string | null
  refreshTasks: () => Promise<void>
  refreshRelay: (connectIfNeeded?: boolean) => Promise<void>
  setDrawerOpen: (open: boolean) => void
  selectTask: (taskId: string | null) => void
}

const STOPPED_STATUS: RemoteAgentRelayStatus = {
  state: 'stopped',
  connected: false,
  connectionId: null,
  lastError: null,
  lastSeenAt: null,
}

const RemoteAgentSessionContext = createContext<RemoteAgentSessionState | null>(null)

export function RemoteAgentSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string
  children: ReactNode
}) {
  const [tasks, setTasks] = useState<RemoteAgentTask[]>([])
  const [devices, setDevices] = useState<RemoteAgentDeviceSummary[]>([])
  const [relayStatus, setRelayStatus] = useState(STOPPED_STATUS)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [relayError, setRelayError] = useState<string | null>(null)
  const [taskEventsRevision, setTaskEventsRevision] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const { invoke: listTasks } = useIpcInvoke('remote-agent:task:list')
  const { invoke: getRelayStatus } = useIpcInvoke('remote-agent:relay:get-status')
  const { invoke: connectRelay } = useIpcInvoke('remote-agent:relay:connect')
  const { invoke: listDevices } = useIpcInvoke('remote-agent:relay:list-devices')

  const refreshTasks = useCallback(async () => {
    try {
      const response = await listTasks({ sourceSessionId: sessionId })
      setTasks(response.tasks)
      setTaskError(null)
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error))
    }
  }, [listTasks, sessionId])

  const refreshRelay = useCallback(
    async (connectIfNeeded = false) => {
      try {
        let nextStatus = await getRelayStatus({})
        if (connectIfNeeded && !nextStatus.connected) {
          nextStatus = await connectRelay({})
        }
        setRelayStatus(nextStatus)
        setRelayError(null)
        const response = await listDevices({})
        setDevices(response.devices)
      } catch (error) {
        setRelayError(error instanceof Error ? error.message : String(error))
      }
    },
    [connectRelay, getRelayStatus, listDevices],
  )

  useEffect(() => {
    void refreshTasks()
  }, [refreshTasks])

  useIpcStream('stream:remote-agent:relay-status', setRelayStatus)
  useIpcStream('stream:remote-agent:devices', (response) => setDevices(response.devices))
  useIpcStream('stream:remote-agent:task-updated', (task) => {
    if (task.sourceSessionId !== sessionId) return
    setTasks((current) => {
      const next = current.filter((item) => item.taskId !== task.taskId)
      next.push(task)
      return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    })
    setTaskError(null)
  })
  useIpcStream('stream:remote-agent:task-events', (events) => {
    if (events.some((event) => tasks.some((task) => task.taskId === event.taskId))) {
      setTaskEventsRevision((value) => value + 1)
    }
  })

  const selectTask = useCallback((taskId: string | null) => {
    setSelectedTaskId(taskId)
    if (taskId != null) setDrawerOpen(true)
  }, [])

  const value = useMemo<RemoteAgentSessionState>(
    () => ({
      sessionId,
      tasks,
      devices,
      relayStatus,
      taskError,
      relayError,
      taskEventsRevision,
      drawerOpen,
      selectedTaskId,
      refreshTasks,
      refreshRelay,
      setDrawerOpen,
      selectTask,
    }),
    [
      devices,
      drawerOpen,
      refreshRelay,
      refreshTasks,
      relayError,
      relayStatus,
      selectTask,
      selectedTaskId,
      sessionId,
      taskError,
      taskEventsRevision,
      tasks,
    ],
  )

  return (
    <RemoteAgentSessionContext.Provider value={value}>
      {children}
    </RemoteAgentSessionContext.Provider>
  )
}

export function useRemoteAgentSession(): RemoteAgentSessionState {
  const value = useContext(RemoteAgentSessionContext)
  if (value == null) throw new Error('远程 Agent 会话 UI 必须位于 RemoteAgentSessionProvider 中')
  return value
}
