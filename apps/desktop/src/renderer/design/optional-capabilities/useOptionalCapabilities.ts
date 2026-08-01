import { useEffect, useSyncExternalStore } from 'react'
import type {
  OptionalCapabilityId,
  OptionalCapabilityProgress,
  OptionalCapabilitySnapshot,
} from '@spark/protocol'

type StoreState = {
  snapshot: OptionalCapabilitySnapshot | null
  progress: Partial<Record<OptionalCapabilityId, OptionalCapabilityProgress>>
  loading: boolean
}

let state: StoreState = { snapshot: null, progress: {}, loading: false }
let started = false
const listeners = new Set<() => void>()

function emit(next: StoreState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): StoreState {
  return state
}

function ensureStarted(): void {
  if (started || !window.spark) return
  started = true
  window.spark.on('stream:optional-capability:snapshot', (snapshot) => {
    emit({ ...state, snapshot, loading: false })
  })
  window.spark.on('stream:optional-capability:progress', (progress) => {
    emit({
      ...state,
      progress: { ...state.progress, [progress.capabilityId]: progress },
    })
  })
  emit({ ...state, loading: true })
  void window.spark
    .invoke('optional-capability:list', {})
    .then((snapshot) => emit({ ...state, snapshot, loading: false }))
    .catch(() => emit({ ...state, loading: false }))
}

async function refresh(forceRemote = false): Promise<OptionalCapabilitySnapshot> {
  emit({ ...state, loading: true })
  try {
    const snapshot = await window.spark.invoke('optional-capability:check', { forceRemote })
    emit({ ...state, snapshot, loading: false })
    return snapshot
  } catch (error) {
    emit({ ...state, loading: false })
    throw error
  }
}

async function mutate(
  action: 'install' | 'update' | 'repair' | 'cancel' | 'uninstall',
  capabilityId: OptionalCapabilityId,
): Promise<void> {
  const result = await window.spark.invoke(`optional-capability:${action}`, { capabilityId })
  emit({ ...state, snapshot: result.snapshot })
  if (!result.success) throw new Error(result.message)
}

async function setAutoUpdate(
  capabilityId: OptionalCapabilityId,
  enabled: boolean,
): Promise<void> {
  const snapshot = await window.spark.invoke('optional-capability:set-auto-update', {
    capabilityId,
    enabled,
  })
  emit({ ...state, snapshot })
}

export function useOptionalCapabilities() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(ensureStarted, [])
  return {
    ...current,
    refresh,
    install: (id: OptionalCapabilityId) => mutate('install', id),
    update: (id: OptionalCapabilityId) => mutate('update', id),
    repair: (id: OptionalCapabilityId) => mutate('repair', id),
    cancel: (id: OptionalCapabilityId) => mutate('cancel', id),
    uninstall: (id: OptionalCapabilityId) => mutate('uninstall', id),
    setAutoUpdate,
  }
}
