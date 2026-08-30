export type ComposerPrimaryAction = 'send' | 'stop'

export function resolveComposerPrimaryAction(
  isWorking: boolean,
  canSubmit: boolean,
): ComposerPrimaryAction {
  return isWorking && !canSubmit ? 'stop' : 'send'
}

export function resolveComposerPrimaryActionTitle(
  action: ComposerPrimaryAction,
  isWorking: boolean,
  voiceInputActive: boolean,
  needsTeamSelection: boolean,
): string {
  if (action === 'stop') return '停止会话'
  if (voiceInputActive) return '请先结束语音输入'
  if (needsTeamSelection) return '请先创建并选择团队'
  return isWorking ? '发送并排队' : '发送'
}
