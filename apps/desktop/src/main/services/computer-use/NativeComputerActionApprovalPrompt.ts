import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { getMainWindow } from '../../windows/index.js'
import type { ExactComputerActionApprovalPrompt } from './ComputerActionApprovalPresenter.js'

interface NativeApprovalPromptDependencies {
  getWindow: () => BrowserWindow | null
  showMessageBox: (
    window: BrowserWindow,
    options: MessageBoxOptions,
  ) => Promise<{ response: number }>
}

export function createNativeComputerActionApprovalPrompt(
  dependencies: NativeApprovalPromptDependencies = {
    getWindow: getMainWindow,
    showMessageBox: (window, options) => dialog.showMessageBox(window, options),
  },
): (input: ExactComputerActionApprovalPrompt) => Promise<boolean> {
  return async (input) => {
    const window = dependencies.getWindow()
    if (window == null || window.isDestroyed()) return false
    try {
      const result = await dependencies.showMessageBox(window, {
        type: 'warning',
        title: 'SparkWork 电脑操作确认',
        message: input.riskLevel === 'L3' ? '确认高影响电脑操作？' : '确认这一步电脑操作？',
        detail: approvalDetail(input),
        buttons: ['拒绝', '仅允许这一次'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      return result.response === 1
    } catch {
      return false
    }
  }
}

function approvalDetail(input: ExactComputerActionApprovalPrompt): string {
  const intent = typeof input.toolInput.intent === 'string' ? input.toolInput.intent : '(未提供)'
  const targetAppId =
    typeof input.toolInput.targetAppId === 'string' ? input.toolInput.targetAppId : '(未知应用)'
  const targetWindowId =
    typeof input.toolInput.targetWindowId === 'string'
      ? input.toolInput.targetWindowId
      : '(未知窗口)'
  const action = JSON.stringify(input.toolInput.action ?? {})
  return [
    `意图：${intent.slice(0, 1_000)}`,
    `应用：${targetAppId.slice(0, 200)}`,
    `窗口：${targetWindowId.slice(0, 200)}`,
    `动作：${action.slice(0, 2_000)}`,
    '',
    '批准只对当前画面、当前目标和当前动作生效，不会记住或复用。',
  ].join('\n')
}
