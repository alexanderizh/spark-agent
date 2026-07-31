import type { AppControlCommand } from '@spark/protocol'
import type { ThemeMode, ViewId } from './AppContext'

export async function applyAppControlCommand(
  command: AppControlCommand,
  context: {
    hasDialogOpen: boolean
    setTheme(theme: ThemeMode): void
    setView(view: ViewId): void
    currentView(): ViewId
    waitForRender(): Promise<void>
  },
): Promise<'applied' | 'rejected'> {
  if (context.hasDialogOpen) return 'rejected'
  if (command.name === 'set_theme') {
    context.setTheme(command.theme)
    await context.waitForRender()
    return 'applied'
  }
  context.setView(command.view)
  await context.waitForRender()
  await context.waitForRender()
  return context.currentView() === command.view ? 'applied' : 'rejected'
}
