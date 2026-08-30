import type { SearchPanelMode } from './searchPanelVisibility'

export type SearchResultLayout = 'tree' | 'list'

export interface SearchPanelWorkspaceState {
  queries: Record<SearchPanelMode, string>
  caseSensitive: boolean
  resultLayout: SearchResultLayout
}

const STORAGE_PREFIX = 'spark-agent:code-search-workspace:'

export const DEFAULT_SEARCH_PANEL_WORKSPACE_STATE: SearchPanelWorkspaceState = {
  queries: { files: '', content: '' },
  caseSensitive: false,
  resultLayout: 'tree',
}

function storageKey(workspaceId: string | null): string {
  return `${STORAGE_PREFIX}${workspaceId ?? 'no-workspace'}`
}

/** 同一项目切换文件树 / Git / 搜索时恢复搜索上下文；无效缓存安全回退默认值。 */
export function readSearchPanelWorkspaceState(
  workspaceId: string | null,
): SearchPanelWorkspaceState {
  if (typeof window === 'undefined') return DEFAULT_SEARCH_PANEL_WORKSPACE_STATE
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId))
    if (raw == null) return DEFAULT_SEARCH_PANEL_WORKSPACE_STATE
    const parsed = JSON.parse(raw) as Partial<SearchPanelWorkspaceState>
    return {
      queries: {
        files: typeof parsed.queries?.files === 'string' ? parsed.queries.files : '',
        content: typeof parsed.queries?.content === 'string' ? parsed.queries.content : '',
      },
      caseSensitive: parsed.caseSensitive === true,
      resultLayout: parsed.resultLayout === 'list' ? 'list' : 'tree',
    }
  } catch {
    return DEFAULT_SEARCH_PANEL_WORKSPACE_STATE
  }
}

export function writeSearchPanelWorkspaceState(
  workspaceId: string | null,
  state: SearchPanelWorkspaceState,
): void {
  try {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(state))
  } catch {
    /* localStorage 不可用时保留当前组件内存态 */
  }
}
