import type { AppControlCommand } from '@spark/protocol'
import type { ThemeMode, ViewId } from './AppContext'

export async function applyAppControlCommand(
  command: AppControlCommand,
  context: {
    hasDialogOpen: boolean
    setTheme(theme: ThemeMode): void
    setView(view: ViewId): void
    currentView(): ViewId
    prefillComposer(text: string): Promise<boolean>
    waitForRender(): Promise<void>
  },
): Promise<'applied' | 'rejected'> {
  if (context.hasDialogOpen) return 'rejected'
  if (command.name === 'set_theme') {
    context.setTheme(command.theme)
    await context.waitForRender()
    return 'applied'
  }
  if (command.name === 'prefill_composer') {
    context.setView('chat')
    await context.waitForRender()
    await context.waitForRender()
    if (!(await context.prefillComposer(command.text))) return 'rejected'
    await context.waitForRender()
    await context.waitForRender()
    return 'applied'
  }
  context.setView(command.view)
  await context.waitForRender()
  await context.waitForRender()
  return context.currentView() === command.view ? 'applied' : 'rejected'
}

export function appliedAppControlMessage(command: AppControlCommand): string {
  switch (command.name) {
    case 'set_theme':
      return 'Agent 已通过应用内控制切换主题'
    case 'navigate':
      return 'Agent 已通过应用内控制切换页面'
    case 'prefill_composer':
      return 'Agent 已通过应用内控制填写草稿（未发送）'
  }
}
