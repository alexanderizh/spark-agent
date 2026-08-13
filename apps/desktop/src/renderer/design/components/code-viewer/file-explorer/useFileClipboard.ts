/**
 * 文件剪贴板（模块级单例，切会话保留）。
 *
 * VSCode 式语义：复制/剪切把源条目写入内存单例；粘贴时读取并触发 file:copy / file:move。
 * cut 状态下的节点在 UI 上显示半透明 + 删除线，提供视觉反馈。
 */

import { useSyncExternalStore } from 'react'
import type { FileClipboardEntry } from './fileExplorerTypes'

let clipboard: FileClipboardEntry | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): FileClipboardEntry | null {
  return clipboard
}

/** 写入剪贴板（传 null 清空，如粘贴完成后） */
export function setFileClipboard(entry: FileClipboardEntry | null): void {
  clipboard = entry
  emit()
}

/** 订阅剪贴板状态（供节点行判断 cut/copy 高亮） */
export function useFileClipboard(): FileClipboardEntry | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
