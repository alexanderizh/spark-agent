import path from 'node:path'
import type { SubAppJob, SubAppJobStatus } from '@spark/protocol'
import type { SparkDatabase } from '@spark/storage'
import type { PlatformBridgeDeps } from '@spark/agent-runtime'
import { SubAppBackend } from './subAppBackend.js'
import { registerSubAppIpc } from './registerSubAppIpc.js'

type RuntimeBridge = NonNullable<PlatformBridgeDeps['subAppRuntime']>

export function registerSubAppPlatformIpc(options: {
  database: SparkDatabase
  userDataPath: string
  platformVersion: string
  setRuntimeBridge: (bridge: RuntimeBridge) => void
  emitServiceEvent: (event: { appId: string; event: string; payload: unknown }) => void
  emitJobChanged: (event: { appId: string; job: SubAppJob }) => void
}): void {
  const backend = new SubAppBackend(
    options.database,
    path.join(options.userDataPath, 'sub-app-files'),
    {
      platformVersion: options.platformVersion,
      backupsDir: path.join(options.userDataPath, 'sub-app-backups'),
      onServiceEvent: options.emitServiceEvent,
      onJobChanged: options.emitJobChanged,
    },
  )
  options.setRuntimeBridge(createSubAppRuntimeBridge(backend))
  registerSubAppIpc({ backend })
}

function createSubAppRuntimeBridge(backend: SubAppBackend): RuntimeBridge {
  return {
    serviceStatus: (params) => backend.serviceStatus({ appId: text(params.appId) }),
    serviceLogs: (params) =>
      backend.serviceLogs({
        appId: text(params.appId),
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
      }),
    serviceRestart: (params) => backend.serviceRestart({ appId: text(params.appId) }),
    jobCreate: (params) =>
      backend.jobCreate({
        appId: text(params.appId),
        type: text(params.type),
        ...(params.input !== undefined ? { input: params.input } : {}),
      }),
    jobGet: (params) => backend.jobGet({ appId: text(params.appId), jobId: text(params.jobId) }),
    jobList: (params) =>
      backend.jobList({
        appId: text(params.appId),
        ...(isJobStatus(params.status) ? { status: params.status } : {}),
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
        ...(typeof params.offset === 'number' ? { offset: params.offset } : {}),
      }),
    jobCancel: (params) =>
      backend.jobCancel({ appId: text(params.appId), jobId: text(params.jobId) }),
    diagnose: (params) =>
      backend.diagnose({
        appId: text(params.appId),
        ...(params.mode === 'published' ? { mode: 'published' as const } : {}),
        ...(typeof params.includeService === 'boolean'
          ? { includeService: params.includeService }
          : {}),
      }),
    releaseChanged: (params) => backend.releaseChanged(text(params.appId)),
    preflightProject: (params) => backend.preflightProject(text(params.appId)),
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isJobStatus(value: unknown): value is SubAppJobStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'interrupted'
  )
}
