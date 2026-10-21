import { app } from 'electron'
import path from 'node:path'
import type {
  RemoteAgentApprovalRequest,
  RemoteAgentArtifactFetchRequest,
  RemoteAgentRelayStatus,
  RemoteAgentRemoteAgentListResponse,
  RemoteAgentRemoteProjectListResponse,
  RemoteAgentTaskActionRequest,
  RemoteAgentTaskDispatchRequest,
  RemoteAgentTargetAgentListRequest,
  RemoteAgentTargetProjectListRequest,
  RemoteAgentTaskGetRequest,
  RemoteAgentTaskListRequest,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { RemoteAgentRelayClient } from '../services/RemoteAgentRelayClient.js'
import { RemoteAgentCoordinator } from '../services/RemoteAgentCoordinator.js'
import { getDatabase } from '../db.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

const log = createLogger('remote-agent:ipc')

export interface RemoteAgentIpcDeps {
  getRelayBaseUrl(): string
  getRelayAccessToken(): Promise<string | null>
  getClientLabel(): string
  getVersion(): string
  getCurrentUserId(): string | null
  addLogoutHook(hook: () => Promise<void>): () => void
}

let relayClient: RemoteAgentRelayClient | null = null
let coordinator: RemoteAgentCoordinator | null = null
let beforeQuitHookRegistered = false

function getRelayClient(deps: RemoteAgentIpcDeps): RemoteAgentRelayClient {
  if (relayClient != null) return relayClient
  relayClient = new RemoteAgentRelayClient({
    getBaseUrl: deps.getRelayBaseUrl,
    getAccessToken: deps.getRelayAccessToken,
    getClientLabel: deps.getClientLabel,
    getVersion: deps.getVersion,
    onStatusChange: (status) => {
      pushStreamEvent('stream:remote-agent:relay-status', status)
      coordinator?.handleRelayStatus(status)
    },
    onDevicesChange: (devices) => {
      pushStreamEvent('stream:remote-agent:devices', devices)
      coordinator?.handleDevicesChange(devices)
    },
  })
  coordinator = new RemoteAgentCoordinator({
    getDatabase,
    getCurrentUserId: deps.getCurrentUserId,
    getRelayClient: () => relayClient!,
    getArtifactRoot: () => path.join(app.getPath('userData'), 'remote-agent-results'),
    onTaskUpdated: (task) => pushStreamEvent('stream:remote-agent:task-updated', task),
    onTaskEvents: (events) => pushStreamEvent('stream:remote-agent:task-events', events),
  })
  deps.addLogoutHook(async () => {
    relayClient?.stop()
    log.info('relay stopped after account logout')
  })
  if (!beforeQuitHookRegistered) {
    beforeQuitHookRegistered = true
    app.once('before-quit', () => relayClient?.stop())
  }
  return relayClient
}

function stoppedStatus(): RemoteAgentRelayStatus {
  return {
    state: 'stopped',
    connected: false,
    connectionId: null,
    lastError: null,
    lastSeenAt: null,
  }
}

async function requestRemoteDirectory<T>(
  client: RemoteAgentRelayClient,
  deviceId: string,
  path: string,
  isResponse: (value: unknown) => value is T,
): Promise<T> {
  const response = await client.request(deviceId, 'GET', path)
  if (response.status < 200 || response.status >= 300 || !isResponse(response.body)) {
    throw new Error('目标电脑未能返回有效目录')
  }
  return response.body
}

function isProjectListResponse(value: unknown): value is RemoteAgentRemoteProjectListResponse {
  if (value == null || typeof value !== 'object' || !('projects' in value)) return false
  const projects = (value as { projects?: unknown }).projects
  return (
    Array.isArray(projects) &&
    projects.every(
      (item) =>
        item != null &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string',
    )
  )
}

function isAgentListResponse(value: unknown): value is RemoteAgentRemoteAgentListResponse {
  if (value == null || typeof value !== 'object' || !('agents' in value)) return false
  const agents = (value as { agents?: unknown }).agents
  return (
    Array.isArray(agents) &&
    agents.every(
      (item) =>
        item != null &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string',
    )
  )
}

export function registerRemoteAgentIpc(deps: RemoteAgentIpcDeps): void {
  typedIpcHandle(
    'remote-agent:relay:get-status',
    async () => relayClient?.getStatus() ?? stoppedStatus(),
  )

  typedIpcHandle('remote-agent:relay:connect', async () => {
    const client = getRelayClient(deps)
    await client.start()
    log.info('relay connection requested')
    return client.getStatus()
  })

  typedIpcHandle('remote-agent:relay:disconnect', async () => {
    relayClient?.stop()
    return relayClient?.getStatus() ?? stoppedStatus()
  })

  typedIpcHandle(
    'remote-agent:relay:list-devices',
    async () => relayClient?.listDevices() ?? { devices: [] },
  )

  typedIpcHandle(
    'remote-agent:target:list-projects',
    async (request: RemoteAgentTargetProjectListRequest) => {
      if (typeof request?.deviceId !== 'string' || !request.deviceId.trim()) {
        throw new Error('deviceId 不能为空')
      }
      return requestRemoteDirectory(
        getRelayClient(deps),
        request.deviceId,
        '/v1/remote-agent/projects',
        isProjectListResponse,
      )
    },
  )

  typedIpcHandle(
    'remote-agent:target:list-agents',
    async (request: RemoteAgentTargetAgentListRequest) => {
      if (
        typeof request?.deviceId !== 'string' ||
        !request.deviceId.trim() ||
        typeof request.projectId !== 'string' ||
        !request.projectId.trim()
      ) {
        throw new Error('deviceId 与 projectId 不能为空')
      }
      const projectId = encodeURIComponent(request.projectId.trim())
      return requestRemoteDirectory(
        getRelayClient(deps),
        request.deviceId,
        `/v1/remote-agent/agents?projectId=${projectId}`,
        isAgentListResponse,
      )
    },
  )

  typedIpcHandle('remote-agent:task:list', async (request: RemoteAgentTaskListRequest) => {
    if (typeof request?.sourceSessionId !== 'string' || !request.sourceSessionId.trim()) {
      throw new Error('sourceSessionId 不能为空')
    }
    if (deps.getCurrentUserId() == null) return { tasks: [] }
    const activeCoordinator = getCoordinator(deps)
    return { tasks: activeCoordinator.list(request.sourceSessionId) }
  })

  typedIpcHandle('remote-agent:task:get', async (request: RemoteAgentTaskGetRequest) => {
    if (typeof request?.taskId !== 'string' || !request.taskId.trim()) {
      throw new Error('taskId 不能为空')
    }
    if (deps.getCurrentUserId() == null) return null
    return getCoordinator(deps).get(request.taskId)
  })

  typedIpcHandle('remote-agent:task:dispatch', async (request: RemoteAgentTaskDispatchRequest) =>
    getCoordinator(deps).dispatch(request),
  )

  typedIpcHandle('remote-agent:task:reconcile', async (request: RemoteAgentTaskActionRequest) =>
    getCoordinator(deps).reconcile(request),
  )

  typedIpcHandle('remote-agent:task:approve', async (request: RemoteAgentApprovalRequest) =>
    getCoordinator(deps).approve(request),
  )

  typedIpcHandle('remote-agent:task:cancel', async (request: RemoteAgentTaskActionRequest) =>
    getCoordinator(deps).cancel(request),
  )

  typedIpcHandle('remote-agent:task:get-history', async (request: RemoteAgentTaskActionRequest) =>
    getCoordinator(deps).getHistory(request),
  )

  typedIpcHandle(
    'remote-agent:task:list-artifacts',
    async (request: RemoteAgentTaskActionRequest) => getCoordinator(deps).listArtifacts(request),
  )

  typedIpcHandle(
    'remote-agent:task:fetch-artifact',
    async (request: RemoteAgentArtifactFetchRequest) => getCoordinator(deps).fetchArtifact(request),
  )
}

function getCoordinator(deps: RemoteAgentIpcDeps): RemoteAgentCoordinator {
  getRelayClient(deps)
  if (coordinator == null) throw new Error('远程 Agent 编排器尚未初始化')
  return coordinator
}
