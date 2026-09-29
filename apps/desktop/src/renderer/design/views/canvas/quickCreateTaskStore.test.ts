// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  QUICK_CREATE_MODES,
  isQuickCreateMode,
  readQuickCreateTasks,
  writeQuickCreateTasks,
  type QuickCreateTaskRecord,
} from './quickCreateTaskStore'

const STORAGE_KEY = 'spark-canvas:quick-create-tasks:v1'

function audioTask(): QuickCreateTaskRecord {
  return {
    id: 'quick-create-audio',
    mode: 'audio',
    operation: 'text_to_audio',
    prompt: '欢迎收听今天的早间资讯',
    inputFiles: [],
    modelParams: { voice: 'Cherry' },
    status: 'succeeded',
    assets: [{ type: 'audio', filePath: '/tmp/out.mp3', mimeType: 'audio/mpeg' }],
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
  }
}

describe('quickCreateTaskStore 模式白名单', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('audio 是受支持的模式', () => {
    expect(QUICK_CREATE_MODES).toContain('audio')
    expect(isQuickCreateMode('audio')).toBe(true)
    expect(isQuickCreateMode('wallpaper')).toBe(false)
    expect(isQuickCreateMode(undefined)).toBe(false)
  })

  it('语音任务写入后读回仍是 audio + text_to_audio（不被强转成 image）', () => {
    writeQuickCreateTasks([audioTask()])

    const [restored] = readQuickCreateTasks()
    expect(restored?.mode).toBe('audio')
    expect(restored?.operation).toBe('text_to_audio')
    expect(restored?.assets).toEqual([
      { type: 'audio', filePath: '/tmp/out.mp3', mimeType: 'audio/mpeg' },
    ])
  })

  it('缺失/非法 operation 的语音任务按 text_to_audio 兜底，未知模式仍回退 image', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'a', mode: 'audio', prompt: '文稿', operation: 'not-an-operation' },
        { id: 'b', mode: 'wallpaper', prompt: '未知模式' },
      ]),
    )

    const [audio, unknown] = readQuickCreateTasks()
    expect(audio?.operation).toBe('text_to_audio')
    expect(unknown?.mode).toBe('image')
    expect(unknown?.operation).toBe('text_to_image')
  })
})
