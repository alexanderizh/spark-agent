export const AGENTS_TARGET_TAB_EVENT = 'spark-agent:agents-target-tab'
export const AGENTS_TARGET_TAB_STORAGE_KEY = 'spark-agent:agents-target-tab'

export type AgentsTargetTab = 'agents' | 'teams'

export function readAgentsTargetTab(): AgentsTargetTab {
  if (typeof window === 'undefined') return 'agents'
  return window.localStorage.getItem(AGENTS_TARGET_TAB_STORAGE_KEY) === 'teams' ? 'teams' : 'agents'
}

export function requestAgentsTargetTab(tab: AgentsTargetTab): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AGENTS_TARGET_TAB_STORAGE_KEY, tab)
  window.dispatchEvent(new CustomEvent(AGENTS_TARGET_TAB_EVENT, { detail: { tab } }))
}
