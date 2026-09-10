// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  getProjectFilesExpandedDirs,
  getSelectedProjectFilesWorkspaceId,
  resetProjectFilesPanelStoreForTest,
  setProjectFilesExpandedDirs,
  setSelectedProjectFilesWorkspaceId,
} from './projectFilesPanelStore'
import {
  OPEN_PROJECT_FILES_EVENT,
  clearPendingOpenProjectFiles,
  consumePendingOpenProjectFiles,
  requestOpenProjectFiles,
} from './projectFilesPanelNavigation'

const SELECTED_KEY = 'spark-agent:project-files-selected-workspace'
const EXPANDED_KEY = 'spark-agent:project-files-expanded-dirs'
const PENDING_KEY = 'spark-agent:open-project-files-pending'

describe('projectFilesPanelStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetProjectFilesPanelStoreForTest()
  })

  it('选中项目写入即持久化；清除时内存与 localStorage 同步移除', () => {
    expect(getSelectedProjectFilesWorkspaceId()).toBeNull()

    setSelectedProjectFilesWorkspaceId('ws-1')
    expect(getSelectedProjectFilesWorkspaceId()).toBe('ws-1')
    expect(window.localStorage.getItem(SELECTED_KEY)).toBe('ws-1')

    setSelectedProjectFilesWorkspaceId(null)
    expect(getSelectedProjectFilesWorkspaceId()).toBeNull()
    expect(window.localStorage.getItem(SELECTED_KEY)).toBeNull()
  })

  it('各项目展开目录相互隔离并持久化；未写入项目与 null 返回空集', () => {
    setProjectFilesExpandedDirs('ws-a', new Set(['src', 'docs']))
    setProjectFilesExpandedDirs('ws-b', new Set(['packages']))

    expect([...getProjectFilesExpandedDirs('ws-a')].sort()).toEqual(['docs', 'src'])
    expect([...getProjectFilesExpandedDirs('ws-b')]).toEqual(['packages'])
    expect(getProjectFilesExpandedDirs('ws-c').size).toBe(0)
    expect(getProjectFilesExpandedDirs(null).size).toBe(0)

    const raw: Record<string, string[]> = JSON.parse(
      window.localStorage.getItem(EXPANDED_KEY) ?? '{}',
    )
    expect(raw['ws-a']?.sort()).toEqual(['docs', 'src'])
    expect(raw['ws-b']).toEqual(['packages'])
  })

  it('reset 重读持久化数据（模拟重启恢复）', () => {
    setSelectedProjectFilesWorkspaceId('ws-1')
    setProjectFilesExpandedDirs('ws-1', new Set(['src']))
    resetProjectFilesPanelStoreForTest()
    expect(getSelectedProjectFilesWorkspaceId()).toBe('ws-1')
    expect([...getProjectFilesExpandedDirs('ws-1')]).toEqual(['src'])
  })
})

describe('projectFilesPanelNavigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('请求写入待处理标记、派发事件，且消费为一次性', () => {
    const events: Event[] = []
    const handler = (event: Event): void => {
      events.push(event)
    }
    window.addEventListener(OPEN_PROJECT_FILES_EVENT, handler)

    try {
      requestOpenProjectFiles('ws-9')
      expect(events).toHaveLength(1)

      expect(consumePendingOpenProjectFiles()).toEqual({ workspaceId: 'ws-9' })
      // 消费后标记清除：再次消费返回 null（不会在下次挂载重复打开）
      expect(consumePendingOpenProjectFiles()).toBeNull()
    } finally {
      window.removeEventListener(OPEN_PROJECT_FILES_EVENT, handler)
    }
  })

  it('无待处理标记时消费返回 null；超期残留视为无效并清除', () => {
    expect(consumePendingOpenProjectFiles()).toBeNull()

    const stale = { workspaceId: 'ws-old', writtenAt: Date.now() - 60_000 }
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(stale))
    expect(consumePendingOpenProjectFiles()).toBeNull()
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
  })

  it('workspaceId 缺失的待处理请求也能被消费（workspaceId 为 null）', () => {
    window.localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ workspaceId: null, writtenAt: Date.now() }),
    )
    expect(consumePendingOpenProjectFiles()).toEqual({ workspaceId: null })
    clearPendingOpenProjectFiles() // 幂等清理不抛错
  })
})
