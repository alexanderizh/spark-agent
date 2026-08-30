import type { SearchPanelMode } from './search-panel/searchPanelVisibility'

export interface CodeSearchShortcutLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** 代码面板局部快捷键：不受应用全局 Ctrl/Cmd+F 命令面板和 Monaco find action 干扰。 */
export function resolveCodeSearchShortcut(event: CodeSearchShortcutLike): SearchPanelMode | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null
  const key = event.key.toLowerCase()
  if (key === 'f') return 'content'
  if (key === 'p') return 'files'
  return null
}
