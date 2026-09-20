// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { isContextMenuDivider, type ContextMenuEntry } from '../../components/contextMenuModel'
import {
  buildQuickCreateTaskMenuItems,
  outputKeyOf,
  viewableOutputsOf,
  type QuickCreateTaskMenuHandlers,
} from './quickCreateTaskContextMenu'
import type { QuickCreateTaskRecord } from './quickCreateTaskStore'

const IMAGE_TASK: QuickCreateTaskRecord = {
  id: 'task-image',
  mode: 'image',
  operation: 'text_to_image',
  prompt: '清晨窗边的静物',
  inputFiles: [],
  modelParams: {},
  status: 'succeeded',
  assets: [
    { type: 'image', filePath: '/tmp/output-a.png' },
    { type: 'image', filePath: '/tmp/output-b.png' },
  ],
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
}

function handlers(
  overrides: Partial<QuickCreateTaskMenuHandlers> = {},
): QuickCreateTaskMenuHandlers {
  return {
    onToggleDetail: vi.fn(),
    onViewOutput: vi.fn(),
    onCopyPrompt: vi.fn(),
    onCopyImage: vi.fn(),
    onSaveOutput: vi.fn(),
    onRevealOutput: vi.fn(),
    onReuse: vi.fn(),
    onRetry: vi.fn(),
    onSavePrompt: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
}

function labelsOf(items: ContextMenuEntry[]): string[] {
  return items.map((item) => (isContextMenuDivider(item) ? '---' : item.label))
}

function findByLabel(items: ContextMenuEntry[], label: string) {
  const item = items.find((entry) => !isContextMenuDivider(entry) && entry.label === label)
  if (!item || isContextMenuDivider(item)) throw new Error(`missing menu item: ${label}`)
  return item
}

describe('buildQuickCreateTaskMenuItems', () => {
  it('图片产物：产物动作在前、任务动作在后，删除任务为危险项', () => {
    const items = buildQuickCreateTaskMenuItems(
      IMAGE_TASK,
      { taskId: IMAGE_TASK.id, assetRef: '/tmp/output-b.png' },
      handlers(),
    )

    expect(labelsOf(items)).toEqual([
      '查看大图',
      '复制图片',
      '另存为…',
      '打开所在文件夹',
      '---',
      '查看详情',
      '复制提示词',
      '复用配置',
      '重新生成',
      '存入提示词库',
      '---',
      '删除任务',
    ])
    const remove = findByLabel(items, '删除任务')
    expect(remove.danger).toBe(true)
  })

  it('产物动作作用于右键命中的那一张，而不是始终第一张', () => {
    const h = handlers()
    const items = buildQuickCreateTaskMenuItems(
      IMAGE_TASK,
      { taskId: IMAGE_TASK.id, assetRef: '/tmp/output-b.png' },
      h,
    )

    findByLabel(items, '查看大图').onClick?.()
    expect(h.onViewOutput).toHaveBeenCalledWith(IMAGE_TASK, 1)

    findByLabel(items, '另存为…').onClick?.()
    expect(h.onSaveOutput).toHaveBeenCalledWith(IMAGE_TASK.assets[1])

    findByLabel(items, '删除任务').onClick?.()
    expect(h.onDelete).toHaveBeenCalledWith(IMAGE_TASK.id)
  })

  it('视频产物不给「复制图片」，给「查看视频」', () => {
    const videoTask: QuickCreateTaskRecord = {
      ...IMAGE_TASK,
      id: 'task-video',
      mode: 'video',
      operation: 'text_to_video',
      assets: [{ type: 'video', filePath: '/tmp/output.mp4' }],
    }
    const items = buildQuickCreateTaskMenuItems(
      videoTask,
      { taskId: videoTask.id, assetRef: '/tmp/output.mp4' },
      handlers(),
    )

    expect(labelsOf(items)).toContain('查看视频')
    expect(labelsOf(items)).not.toContain('复制图片')
    expect(labelsOf(items)).not.toContain('查看大图')
  })

  it('产物没有本地文件时不显示「另存为…」与「打开所在文件夹」', () => {
    const remoteTask: QuickCreateTaskRecord = {
      ...IMAGE_TASK,
      assets: [{ type: 'image', url: 'https://cdn.example.com/a.png' }],
    }
    const items = buildQuickCreateTaskMenuItems(
      remoteTask,
      { taskId: remoteTask.id, assetRef: 'https://cdn.example.com/a.png' },
      handlers(),
    )

    expect(labelsOf(items)).toContain('复制图片')
    expect(labelsOf(items)).not.toContain('另存为…')
    expect(labelsOf(items)).not.toContain('打开所在文件夹')
  })

  it('目标产物已被替换（assetRef 找不到）时只给任务动作，不误伤别的产物', () => {
    const items = buildQuickCreateTaskMenuItems(
      IMAGE_TASK,
      { taskId: IMAGE_TASK.id, assetRef: '/tmp/gone.png' },
      handlers(),
    )

    expect(labelsOf(items)[0]).toBe('查看详情')
    expect(labelsOf(items)).not.toContain('查看大图')
  })

  it('运行中任务不提供重试，且详情弹层（无 onToggleDetail）不显示查看详情', () => {
    const running: QuickCreateTaskRecord = { ...IMAGE_TASK, status: 'running', assets: [] }
    const items = buildQuickCreateTaskMenuItems(
      running,
      { taskId: running.id, assetRef: null },
      handlers({ onToggleDetail: undefined }),
    )

    expect(labelsOf(items)).toEqual(['复制提示词', '复用配置', '存入提示词库', '---', '删除任务'])
  })

  it('反推任务的复制项针对反推产物提示词', () => {
    const reverse: QuickCreateTaskRecord = {
      ...IMAGE_TASK,
      id: 'task-reverse',
      mode: 'reverse',
      operation: 'image_prompt_reverse',
      prompt: '',
      assets: [],
      text: '逆光下的柯基特写',
    }
    const h = handlers()
    const items = buildQuickCreateTaskMenuItems(reverse, { taskId: reverse.id, assetRef: null }, h)

    findByLabel(items, '复制反推提示词').onClick?.()
    expect(h.onCopyPrompt).toHaveBeenCalledWith('逆光下的柯基特写', '反推提示词已复制')
  })

  it('产物定位用 filePath 优先、回退展示 URL，顺序变化后仍能命中同一张', () => {
    const outputs = viewableOutputsOf(IMAGE_TASK)
    expect(outputs.map(outputKeyOf)).toEqual(['/tmp/output-a.png', '/tmp/output-b.png'])

    const reordered: QuickCreateTaskRecord = {
      ...IMAGE_TASK,
      assets: [...IMAGE_TASK.assets].reverse(),
    }
    const h = handlers()
    const items = buildQuickCreateTaskMenuItems(
      reordered,
      { taskId: reordered.id, assetRef: '/tmp/output-b.png' },
      h,
    )
    findByLabel(items, '查看大图').onClick?.()
    expect(h.onViewOutput).toHaveBeenCalledWith(reordered, 0)
  })

  it('提供 onEditImage 时图片产物菜单出现「去图编辑」并回调对应产物', () => {
    const h = handlers({ onEditImage: vi.fn() })
    const items = buildQuickCreateTaskMenuItems(
      IMAGE_TASK,
      { taskId: IMAGE_TASK.id, assetRef: '/tmp/output-b.png' },
      h,
    )

    expect(labelsOf(items)).toEqual([
      '查看大图',
      '复制图片',
      '去图编辑',
      '另存为…',
      '打开所在文件夹',
      '---',
      '查看详情',
      '复制提示词',
      '复用配置',
      '重新生成',
      '存入提示词库',
      '---',
      '删除任务',
    ])
    findByLabel(items, '去图编辑').onClick?.()
    expect(h.onEditImage).toHaveBeenCalledWith(IMAGE_TASK.assets[1])
  })

  it('视频产物不显示「去图编辑」', () => {
    const videoTask: QuickCreateTaskRecord = {
      ...IMAGE_TASK,
      id: 'task-video-edit',
      mode: 'video',
      operation: 'text_to_video',
      assets: [{ type: 'video', filePath: '/tmp/output.mp4' }],
    }
    const items = buildQuickCreateTaskMenuItems(
      videoTask,
      { taskId: videoTask.id, assetRef: '/tmp/output.mp4' },
      handlers({ onEditImage: vi.fn() }),
    )

    expect(labelsOf(items)).not.toContain('去图编辑')
  })
})
