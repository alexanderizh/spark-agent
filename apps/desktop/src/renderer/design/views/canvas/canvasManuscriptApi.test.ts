// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasApi, __resetCanvasHotCache } from './canvas.api'
import type { CanvasDb } from './canvas.api'
import { readAssetKind } from './canvasFilmAssets'
import { readManuscriptIndex } from './canvasPipeline'
import type { ParsedChapter } from './canvasManuscript'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-06-18T00:00:00.000Z'

function seedProject(): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: '小说项目',
        status: 'active',
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

function chapters(n: number): ParsedChapter[] {
  return Array.from({ length: n }, (_, index) => ({
    index,
    title: `第${index + 1}章`,
    content: `第${index + 1}章正文内容`,
    charCount: 8,
  }))
}

describe('文稿导入 + 级联删除', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
    vi.stubGlobal('window', window)
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }) },
    })
    seedProject()
  })

  it('章节带 manuscriptId/order，正文按范围切片导入', async () => {
    // 模拟「1600 章里只导前 5 章」：取前 5 章
    const snapshot = await canvasApi.importManuscript('project-1', {
      title: '七界传说',
      mode: 'length',
      chapters: chapters(5),
    })
    const chapterAssets = snapshot.assets.filter((a) => readAssetKind(a) === 'chapter')
    expect(chapterAssets).toHaveLength(5)
    // 每章归属同一个 manuscriptId，且带 order
    const manuscript = snapshot.assets.find((a) => readAssetKind(a) === 'manuscript')!
    expect(chapterAssets.every((c) => (c.metadata as { manuscriptId?: string }).manuscriptId === manuscript.id)).toBe(true)
    expect(chapterAssets.map((c) => (c.metadata as { order?: number }).order)).toEqual([0, 1, 2, 3, 4])
    // 项目级索引已写入
    expect(readManuscriptIndex(snapshot.project.metadata)?.chapters).toHaveLength(5)
  })

  it('不分章导入时文稿摘要标记为单章模式', async () => {
    const snapshot = await canvasApi.importManuscript('project-1', {
      title: '整本文稿',
      mode: 'single',
      chapters: chapters(1),
    })
    const manuscript = snapshot.assets.find((a) => readAssetKind(a) === 'manuscript')!
    expect(manuscript.contentText).toContain('导入方式：不分章')
  })

  it('删除文稿级联删除全部章节并清空索引', async () => {
    const imported = await canvasApi.importManuscript('project-1', {
      title: '七界传说',
      mode: 'length',
      chapters: chapters(5),
    })
    const manuscript = imported.assets.find((a) => readAssetKind(a) === 'manuscript')!

    const { snapshot, deletedChapters } = await canvasApi.deleteManuscript('project-1', manuscript.id)
    expect(deletedChapters).toBe(5)
    expect(snapshot.assets.filter((a) => readAssetKind(a) === 'chapter')).toHaveLength(0)
    expect(snapshot.assets.filter((a) => readAssetKind(a) === 'manuscript')).toHaveLength(0)
    expect(readManuscriptIndex(snapshot.project.metadata)).toBeNull()
  })

  it('只删除目标文稿的章节，不误删其它文稿', async () => {
    const first = await canvasApi.importManuscript('project-1', {
      title: '甲',
      mode: 'length',
      chapters: chapters(3),
    })
    const manuscriptA = first.assets.find(
      (a) => readAssetKind(a) === 'manuscript' && a.title === '甲',
    )!
    await canvasApi.importManuscript('project-1', {
      title: '乙',
      mode: 'length',
      chapters: chapters(4),
    })

    const { snapshot } = await canvasApi.deleteManuscript('project-1', manuscriptA.id)
    // 乙 的 4 章应保留
    const remaining = snapshot.assets.filter((a) => readAssetKind(a) === 'chapter')
    expect(remaining).toHaveLength(4)
    expect(snapshot.assets.filter((a) => readAssetKind(a) === 'manuscript')).toHaveLength(1)
  })
})
