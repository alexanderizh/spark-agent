import { useCallback, useEffect, useRef, useState } from 'react'
import type { VideoWorkbenchData } from '../videoWorkbench.types'
import { readVideoWorkbenchProject } from './projectParser'
import {
  reduceVideoWorkbenchProject,
  type VideoWorkbenchProjectCommand,
  type VideoWorkbenchProjectCommandResult,
} from './projectReducer'
import type { VideoWorkbenchProjectV2 } from './projectTypes'
import {
  updateVideoWorkbenchProjectFromLegacy,
  videoWorkbenchProjectToLegacyData,
} from './projectLegacyAdapter'

const PROJECT_HISTORY_LIMIT = 100
const PROJECT_PERSIST_DEBOUNCE_MS = 300

interface ProjectHistory {
  past: VideoWorkbenchProjectV2[]
  present: VideoWorkbenchProjectV2
  future: VideoWorkbenchProjectV2[]
}

interface Options {
  raw: unknown
  open: boolean
  onSave: (project: VideoWorkbenchProjectV2) => Promise<void>
  onSaveError?: ((error: unknown) => void) | undefined
}

export interface VideoWorkbenchProjectSession {
  project: VideoWorkbenchProjectV2
  legacyDraft: VideoWorkbenchData
  issues: string[]
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
  applyCommand: (command: VideoWorkbenchProjectCommand) => VideoWorkbenchProjectCommandResult
  updateProject: (
    updater: (project: VideoWorkbenchProjectV2) => VideoWorkbenchProjectV2,
    recordHistory?: boolean,
  ) => void
  updateLegacyDraft: (updater: (draft: VideoWorkbenchData) => VideoWorkbenchData) => void
  undo: () => void
  redo: () => void
  saveNow: (project?: VideoWorkbenchProjectV2) => Promise<void>
}

export function useVideoWorkbenchProjectSession({
  raw,
  open,
  onSave,
  onSaveError,
}: Options): VideoWorkbenchProjectSession {
  const [initial] = useState(() => readVideoWorkbenchProject(raw))
  const fallback = useState(() => readVideoWorkbenchProject(undefined).project)[0]
  if (!fallback) throw new Error('Video workbench default project is unavailable')

  const readOnly = initial.project == null
  const [history, setHistory] = useState<ProjectHistory>(() => ({
    past: [],
    present: initial.project ?? fallback,
    future: [],
  }))
  const presentRef = useRef(history.present)
  presentRef.current = history.present

  const pendingProjectRef = useRef<VideoWorkbenchProjectV2 | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstPersistRef = useRef(true)
  const onSaveRef = useRef(onSave)
  const onSaveErrorRef = useRef(onSaveError)
  useEffect(() => {
    onSaveRef.current = onSave
    onSaveErrorRef.current = onSaveError
  }, [onSave, onSaveError])

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current == null) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
  }, [])

  const flushPendingSave = useCallback(async () => {
    clearSaveTimer()
    const pending = pendingProjectRef.current
    pendingProjectRef.current = null
    if (!pending || readOnly) return
    try {
      await onSaveRef.current(pending)
    } catch (error) {
      onSaveErrorRef.current?.(error)
    }
  }, [clearSaveTimer, readOnly])

  useEffect(() => {
    if (firstPersistRef.current) {
      firstPersistRef.current = false
      return
    }
    if (readOnly) return
    pendingProjectRef.current = history.present
    clearSaveTimer()
    saveTimerRef.current = setTimeout(() => void flushPendingSave(), PROJECT_PERSIST_DEBOUNCE_MS)
    return clearSaveTimer
  }, [clearSaveTimer, flushPendingSave, history.present, readOnly])

  useEffect(() => {
    if (open) return
    void flushPendingSave()
  }, [flushPendingSave, open])

  useEffect(() => () => void flushPendingSave(), [flushPendingSave])

  const commit = useCallback((next: VideoWorkbenchProjectV2, recordHistory: boolean) => {
    setHistory((current) => {
      if (next === current.present) return current
      if (!recordHistory) return { ...current, present: next, future: [] }
      return {
        past: [...current.past, current.present].slice(-PROJECT_HISTORY_LIMIT),
        present: next,
        future: [],
      }
    })
  }, [])

  const updateProject = useCallback(
    (
      updater: (project: VideoWorkbenchProjectV2) => VideoWorkbenchProjectV2,
      recordHistory = false,
    ) => {
      if (readOnly) return
      const current = presentRef.current
      commit(updater(current), recordHistory)
    },
    [commit, readOnly],
  )

  const updateLegacyDraft = useCallback(
    (updater: (draft: VideoWorkbenchData) => VideoWorkbenchData) => {
      updateProject((project) => updateVideoWorkbenchProjectFromLegacy(project, updater))
    },
    [updateProject],
  )

  const applyCommand = useCallback(
    (command: VideoWorkbenchProjectCommand): VideoWorkbenchProjectCommandResult => {
      if (readOnly) {
        return { applied: false, project: presentRef.current, reason: 'invalid-command' }
      }
      const result = reduceVideoWorkbenchProject(presentRef.current, command)
      if (result.applied) commit(result.project, true)
      return result
    },
    [commit, readOnly],
  )

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1)
      if (!previous) return current
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, PROJECT_HISTORY_LIMIT),
      }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0]
      if (!next) return current
      return {
        past: [...current.past, current.present].slice(-PROJECT_HISTORY_LIMIT),
        present: next,
        future: current.future.slice(1),
      }
    })
  }, [])

  const saveNow = useCallback(
    async (project = presentRef.current) => {
      if (readOnly) return
      clearSaveTimer()
      pendingProjectRef.current = null
      await onSaveRef.current(project)
    },
    [clearSaveTimer, readOnly],
  )

  return {
    project: history.present,
    legacyDraft: videoWorkbenchProjectToLegacyData(history.present),
    issues: initial.issues,
    readOnly,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    applyCommand,
    updateProject,
    updateLegacyDraft,
    undo,
    redo,
    saveNow,
  }
}
