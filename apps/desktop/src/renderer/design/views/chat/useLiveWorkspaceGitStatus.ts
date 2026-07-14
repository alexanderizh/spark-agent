import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentEvent,
  SessionId,
  WorkspaceFileChangePayload,
  WorkspaceGitStatusResponse,
} from '@spark/protocol'
import { useIpcInvoke, useIpcStream } from '../../hooks/useIpc'
import type { BranchState } from './ChatComposerTypes'

const FILE_CHANGE_REFRESH_DELAY_MS = 250
const LIVE_STATUS_POLL_INTERVAL_MS = 2_000

type UseLiveWorkspaceGitStatusOptions = {
  workspaceId: string | null
  sessionId: SessionId | null
  refreshSignal: number
  live: boolean
  onBranchStateChange: (state: BranchState) => void
}

type UseLiveWorkspaceGitStatusResult = {
  gitStatus: WorkspaceGitStatusResponse | null
  applyGitStatus: (status: WorkspaceGitStatusResponse | null) => void
  refreshGitStatus: () => Promise<void>
}

/**
 * Keeps the chat Git snapshot aligned with workspace files and Git metadata.
 *
 * File-system and agent events provide low-latency refreshes. A lightweight
 * poll while Git UI is visible covers index-only changes such as `git add`,
 * which the workspace watcher intentionally ignores.
 */
export function useLiveWorkspaceGitStatus({
  workspaceId,
  sessionId,
  refreshSignal,
  live,
  onBranchStateChange,
}: UseLiveWorkspaceGitStatusOptions): UseLiveWorkspaceGitStatusResult {
  const { invoke: getGitStatus } = useIpcInvoke('workspace:git-status')
  const { invoke: startWatch } = useIpcInvoke('workspace:watch-start')
  const { invoke: stopWatch } = useIpcInvoke('workspace:watch-stop')
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatusResponse | null>(null)
  const workspaceIdRef = useRef(workspaceId)
  const requestVersionRef = useRef(0)
  const activeRequestCountRef = useRef(0)
  const statusFingerprintRef = useRef<string | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduledForceRef = useRef(false)

  workspaceIdRef.current = workspaceId

  const commitStatus = useCallback(
    (status: WorkspaceGitStatusResponse | null, force: boolean) => {
      const fingerprint = status == null ? null : JSON.stringify(status)
      if (force || fingerprint !== statusFingerprintRef.current) {
        statusFingerprintRef.current = fingerprint
        setGitStatus(status)
      }
      if (status?.isGitRepo === true) {
        onBranchStateChange({ currentBranch: status.currentBranch, branches: status.branches })
      }
    },
    [onBranchStateChange],
  )

  const requestGitStatus = useCallback(
    async (force: boolean): Promise<void> => {
      const requestedWorkspaceId = workspaceId
      // Background polling must never keep invalidating a slow status request.
      // Forced refreshes (user/file events) may supersede it and are race-guarded below.
      if (!force && activeRequestCountRef.current > 0) return
      const requestVersion = ++requestVersionRef.current
      if (requestedWorkspaceId == null) {
        commitStatus(null, true)
        return
      }
      activeRequestCountRef.current += 1
      try {
        const status = await getGitStatus({ workspaceId: requestedWorkspaceId })
        if (
          requestVersion !== requestVersionRef.current ||
          workspaceIdRef.current !== requestedWorkspaceId
        ) {
          return
        }
        commitStatus(status, force)
      } catch {
        if (
          requestVersion === requestVersionRef.current &&
          workspaceIdRef.current === requestedWorkspaceId
        ) {
          commitStatus(null, force)
        }
      } finally {
        activeRequestCountRef.current = Math.max(0, activeRequestCountRef.current - 1)
      }
    },
    [commitStatus, getGitStatus, workspaceId],
  )

  const refreshGitStatus = useCallback(
    () => requestGitStatus(true),
    [requestGitStatus],
  )

  const applyGitStatus = useCallback(
    (status: WorkspaceGitStatusResponse | null) => {
      // A command response is newer than any status request already in flight.
      requestVersionRef.current += 1
      commitStatus(status, true)
    },
    [commitStatus],
  )

  const scheduleRefresh = useCallback(
    (force: boolean) => {
      scheduledForceRef.current ||= force
      if (refreshTimerRef.current != null) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        const scheduledForce = scheduledForceRef.current
        scheduledForceRef.current = false
        void requestGitStatus(scheduledForce)
      }, FILE_CHANGE_REFRESH_DELAY_MS)
    },
    [requestGitStatus],
  )

  useEffect(() => {
    requestVersionRef.current += 1
    statusFingerprintRef.current = null
    void requestGitStatus(true)
    return () => {
      requestVersionRef.current += 1
    }
  }, [refreshSignal, requestGitStatus])

  useEffect(() => {
    if (workspaceId == null) return
    let disposed = false
    void startWatch({ workspaceId })
      .then(() => {
        if (disposed) void stopWatch({ workspaceId })
      })
      .catch(() => {
        // Focus/session/manual refresh and polling remain available as fallbacks.
      })
    return () => {
      disposed = true
      void stopWatch({ workspaceId }).catch(() => {})
    }
  }, [startWatch, stopWatch, workspaceId])

  useIpcStream('stream:workspace:file-change', (payload: WorkspaceFileChangePayload) => {
    if (payload.workspaceId === workspaceIdRef.current) scheduleRefresh(true)
  })

  useIpcStream('stream:session:agent-event', (event: AgentEvent) => {
    if (event.type !== 'file_change') return
    if (sessionId == null || event.sessionId !== sessionId) return
    scheduleRefresh(true)
  })

  useEffect(() => {
    if (!live || workspaceId == null) return
    const interval = setInterval(() => scheduleRefresh(false), LIVE_STATUS_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [live, scheduleRefresh, workspaceId])

  useEffect(
    () => () => {
      if (refreshTimerRef.current != null) clearTimeout(refreshTimerRef.current)
    },
    [],
  )

  return { gitStatus, applyGitStatus, refreshGitStatus }
}
