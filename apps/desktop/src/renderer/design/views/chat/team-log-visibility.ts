import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'spark-agent:team-activity-logs-visible'
const listeners = new Set<() => void>()

function readStoredValue(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

let visible = readStoredValue()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): boolean {
  return visible
}

export function setTeamActivityLogsVisible(next: boolean): void {
  if (visible === next) return
  visible = next
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // Restricted renderer contexts can still use the in-memory preference.
  }
  for (const listener of listeners) listener()
}

export function useTeamActivityLogsVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function resetTeamActivityLogsVisibilityForTest(): void {
  visible = readStoredValue()
  for (const listener of listeners) listener()
}
