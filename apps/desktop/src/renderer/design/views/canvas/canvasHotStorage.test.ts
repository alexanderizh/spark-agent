// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasApi, __resetCanvasHotCache } from './canvas.api'
import type { CanvasDb } from './canvas.api'
import type { ParsedChapter } from './canvasManuscript'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-06-18T00:00:00.000Z'

function seedProject(): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: '长篇小说项目',
        status: 'active',
        // 给 rootPath 让 openSnapshot 不必走 ensureCanvasProjectDirectory
        rootPath: '/tmp/project-1',
        settings: {},
        nodeCount: 0,
        assetCount: 0,
        taskCount: 0,
        createdAt: at,
        updatedAt: at,
      },
    ],
    boards: [
      {
        id: 'board-1',
        projectId: 'project-1',
        userId: 0,
        name: 'Board',
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

/** 造一篇超过 localStorage ~5MB 配额的长文稿（用于触发内存兜底路径） */
function hugeChapters(count: number, charsEach: number): ParsedChapter[] {
  const body = '这是一段正文。'.repeat(Math.ceil(charsEach / 7))
  return Array.from({ length: count }, (_, index) => ({
    index,
    title: `第${index + 1}章`,
    content: body,
    charCount: body.length,
  }))
}

describe('canvas 热存储：大文稿内存兜底', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
    vi.stubGlobal('window', window)
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }) },
    })
    seedProject()
  })

  const kindOf = (a: { metadata?: unknown }) =>
    (a.metadata as { kind?: string } | undefined)?.kind

  it('导入超配额长篇小说不丢数据，且再次打开仍能读回全部章节', async () => {
    // ~12 章 × 500K 字 ≈ 6MB，远超 4MB 的 localStorage 阈值 → 走内存兜底
    const chapters = hugeChapters(12, 500_000)
    const snapshot = await canvasApi.importManuscript('project-1', {
      title: '七界传说',
      mode: 'length',
      chapters,
    })

    // 整篇索引 + 每章各一个资产
    expect(snapshot.assets.filter((a) => kindOf(a) === 'manuscript')).toHaveLength(1)
    const chapterAssets = snapshot.assets.filter((a) => kindOf(a) === 'chapter')
    expect(chapterAssets).toHaveLength(12)
    // 正文完整保留，没有被截断
    expect(chapterAssets[0]?.contentText?.length).toBe(chapters[0]?.content.length)

    // 关键：超配额时不应把大数据塞进 localStorage（否则会 QuotaExceededError）
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? ''
    expect(raw.length).toBeLessThan(1_000_000)

    // 脏状态下再次 openSnapshot 走热存储（内存兜底），章节仍在
    const reopened = await canvasApi.openSnapshot('project-1')
    expect(reopened.assets.filter((a) => kindOf(a) === 'chapter')).toHaveLength(12)
  })
})
