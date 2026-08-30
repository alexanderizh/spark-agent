export type PromptQuickUseAction = 'apply-to-selection' | 'create-at-viewport'

type PromptLibraryShortcutEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

function isUnmodifiedCommandShortcut(event: PromptLibraryShortcutEvent, key: string): boolean {
  return (
    event.key.toLowerCase() === key &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  )
}

export function isPromptLibraryShortcut(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): boolean {
  return isUnmodifiedCommandShortcut(event, 't')
}

export function isPromptLibraryCreateShortcut(event: PromptLibraryShortcutEvent): boolean {
  return isUnmodifiedCommandShortcut(event, 'e')
}

export function resolvePromptQuickUseAction(selectedNodeCount: number): PromptQuickUseAction {
  return selectedNodeCount > 0 ? 'apply-to-selection' : 'create-at-viewport'
}
