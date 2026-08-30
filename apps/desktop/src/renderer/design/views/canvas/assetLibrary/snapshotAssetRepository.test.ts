// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotAssetRepository } from './snapshotAssetRepository'
import type { SnapshotAssetDb } from './assetRepository'
import type { CanvasAsset, CanvasNode } from '../canvas.types'

const at = '2026-08-29T00:00:00.000Z'

function makeAsset(id: string, overrides: Partial<CanvasAsset> = {}): CanvasAsset {
  return {
    id,
    projectId: 'project-1',
    userId: 0,
    type: 'image',
    source: 'upload',
    title: id,
    metadata: {},
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function makeNode(id: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function seedDb(): SnapshotAssetDb {
  return {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: 'Project',
        status: 'active',
        rootPath: '/tmp/project-1',
        nodeCount: 0,
        assetCount: 0,
        taskCount: 0,
        createdAt: at,
        updatedAt: at,
      },
    ],
    boards: [],
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
}

describe('createSnapshotAssetRepository', () => {
  let db: SnapshotAssetDb
  let writeCount: number
  const repo = createSnapshotAssetRepository({
    readDb: () => db,
    writeDb: (next) => {
      db = next
      writeCount += 1
    },
  })

  beforeEach(() => {
    db = seedDb()
    writeCount = 0
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({ ok: true }) },
    })
  })

  it('list 按 kind / 关键词 / 收藏筛选并分页', async () => {
    db.assets = [
      makeAsset('a1', { title: '女主角', metadata: { kind: 'character', favorite: true } }),
      makeAsset('a2', { title: '街道', metadata: { kind: 'scene' } }),
      makeAsset('a3', { title: '铜钥匙', metadata: { kind: 'prop' } }),
      makeAsset('a4', { title: '未分类' }),
    ]
    const characters = await repo.list('project-1', { kind: 'character' })
    expect(characters.items.map((item) => item.id)).toEqual(['a1'])
    expect(characters.total).toBe(1)

    const keyword = await repo.list('project-1', { keyword: '钥匙' })
    expect(keyword.items.map((item) => item.id)).toEqual(['a3'])

    const favorites = await repo.list('project-1', { favorite: true })
    expect(favorites.items.map((item) => item.id)).toEqual(['a1'])

    const page = await repo.list('project-1', { page: 2, pageSize: 2 })
    expect(page.items.map((item) => item.id)).toEqual(['a3', 'a4'])
    expect(page.hasMore).toBe(false)
  })

  it('list 的 usage 排序只统计未软删引用节点', async () => {
    db.assets = [makeAsset('a1'), makeAsset('a2')]
    db.nodes = [
      makeNode('n1', { assetId: 'a2' }),
      makeNode('n2', { assetId: 'a2' }),
      makeNode('n2b', { assetId: 'a2', hidden: true }),
      makeNode('n3', { assetId: 'a1' }),
    ]
    const page = await repo.list('project-1', { sortBy: 'usage' })
    // a2 有 2 个可见引用（hidden 的 n2b 不计），a1 只有 1 个
    expect(page.items.map((item) => item.id)).toEqual(['a2', 'a1'])
  })

  it('upsert 更新合并既有字段，创建补齐治理字段', async () => {
    const created = await repo.upsert({
      projectId: 'project-1',
      type: 'image',
      source: 'upload',
      title: '新资产',
      metadata: { kind: 'prop' },
    })
    expect(created.id).toBeTruthy()
    expect(created.metadata.kind).toBe('prop')

    const updated = await repo.upsert({
      id: created.id,
      projectId: 'project-1',
      type: 'image',
      source: 'upload',
      title: '改名',
      metadata: { favorite: true },
    })
    expect(updated.title).toBe('改名')
    expect(updated.metadata.kind).toBe('prop')
    expect(updated.metadata.favorite).toBe(true)
    expect(writeCount).toBe(2)
  })

  it('addReference / removeReference 维护 usageCount', () => {
    db.assets = [makeAsset('a1', { metadata: { usageCount: 1 } })]
    db.nodes = [makeNode('n1', { assetId: 'a1' })]

    repo.addReference('a1', 'n1')
    expect(db.assets[0]?.metadata.usageCount).toBe(2)

    repo.removeReference('n1')
    expect(db.assets[0]?.metadata.usageCount).toBe(1)

    // 无资产节点的 removeReference 是 no-op
    repo.removeReference('missing-node')
    expect(writeCount).toBe(2)
  })

  it('recordGenerationOrigin 只补齐缺失字段，不覆盖既有值', () => {
    db.assets = [
      makeAsset('a1', { metadata: { providerProfileId: 'profile-kept' } }),
      makeAsset('a2'),
    ]
    repo.recordGenerationOrigin('a1', {
      taskId: 'task-1',
      providerProfileId: 'profile-new',
      fileId: 'pf-1',
    })
    expect(db.assets[0]?.metadata).toEqual({
      providerProfileId: 'profile-kept',
      originTaskId: 'task-1',
      fileId: 'pf-1',
    })

    repo.recordGenerationOrigin('a2', { taskId: 'task-2' })
    expect(db.assets[1]?.metadata).toEqual({ originTaskId: 'task-2' })
  })

  it('batchDelete 单次遍历级联软删引用节点并单次清理 IPC', async () => {
    db.assets = [
      makeAsset('a1', { storageKey: 'assets/images/a1.png', metadata: {} }),
      makeAsset('a2', {
        metadata: { providerProfileId: 'profile-x', fileId: 'pf-2' },
      }),
      makeAsset('a3'),
    ]
    db.nodes = [
      makeNode('n1', { assetId: 'a1' }),
      makeNode('n2', { assetId: 'a1', hidden: true }),
      makeNode('n3', { assetId: 'a2' }),
    ]
    db.edges = [
      {
        id: 'e1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        sourceNodeId: 'n9',
        targetNodeId: 'n1',
        type: 'used_as_input',
        metadata: {},
        createdAt: at,
      },
    ]
    db.tasks = [
      {
        id: 'task-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        operation: 'text_to_image',
        status: 'completed',
        progress: 100,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: ['n1'],
        outputAssetIds: ['a1'],
        modelParams: {},
        createdAt: at,
        updatedAt: at,
      },
    ]

    const result = await repo.batchDelete('project-1', ['a1', 'a2', 'missing'])

    expect(result.deletedAssetIds.sort()).toEqual(['a1', 'a2'])
    expect(result.missingAssetIds).toEqual(['missing'])
    expect(result.removedNodeIds.sort()).toEqual(['n1', 'n3'])
    expect(result.cleanupDispatched).toBe(true)

    expect(db.assets.map((item) => item.id)).toEqual(['a3'])
    expect(db.nodes.filter((node) => node.id === 'n1' && !node.hidden)).toEqual([])
    expect(db.edges).toEqual([])
    expect(db.tasks[0]?.outputNodeIds).toEqual([])
    expect(db.tasks[0]?.outputAssetIds).toEqual([])
    expect(db.projects[0]?.assetCount).toBe(1)
    expect(db.projects[0]?.nodeCount).toBe(0)

    const invoke = window.spark.invoke as unknown as ReturnType<typeof vi.fn>
    const cleanupCalls = invoke.mock.calls.filter(
      (call) => call[0] === 'canvas:asset:cleanup-files',
    )
    expect(cleanupCalls).toHaveLength(1)
    expect(cleanupCalls[0]?.[1]).toEqual({
      providerFiles: [{ providerProfileId: 'profile-x', fileId: 'pf-2' }],
      localPaths: ['/tmp/project-1/assets/images/a1.png'],
    })
  })

  it('batchDelete(hardDelete=false) 只移除记录不清理文件', async () => {
    db.assets = [makeAsset('a1', { storageKey: '/tmp/project-1/a1.png' })]
    const result = await repo.batchDelete('project-1', ['a1'], { hardDelete: false })
    expect(result.deletedAssetIds).toEqual(['a1'])
    expect(result.cleanupDispatched).toBe(false)
    expect(window.spark.invoke).not.toHaveBeenCalled()
  })

  it('removeReference 对已软删节点 no-op，不重复递减', () => {
    // 节点软删时引用已在 deleteNodes / deleteBoard 回收；hidden 节点再次调用不得再减。
    db.assets = [makeAsset('a1', { metadata: { usageCount: 1 } })]
    db.nodes = [makeNode('n1', { assetId: 'a1', hidden: true })]

    repo.removeReference('n1')
    expect(db.assets[0]?.metadata.usageCount).toBe(1)
    expect(writeCount).toBe(0)
  })

  it('list 的 archived 过滤：true 只看已归档，false 排除已归档', async () => {
    db.assets = [makeAsset('a1'), makeAsset('a2', { metadata: { archived: true } })]
    const archivedOnly = await repo.list('project-1', { archived: true })
    expect(archivedOnly.items.map((item) => item.id)).toEqual(['a2'])

    const activeOnly = await repo.list('project-1', { archived: false })
    expect(activeOnly.items.map((item) => item.id)).toEqual(['a1'])

    const all = await repo.list('project-1')
    expect(all.total).toBe(2)
  })

  it('list 关键词命中影视资产的结构化描述（角色外貌 / 场景描述）', async () => {
    db.assets = [
      makeAsset('a1', {
        title: '女主角',
        metadata: { kind: 'character', attributes: { appearance: '银发红瞳的少女' } },
      }),
      makeAsset('a2', {
        title: '废弃车站',
        metadata: { kind: 'scene', attributes: { description: '月光下的废弃站台' } },
      }),
    ]
    const byAppearance = await repo.list('project-1', { keyword: '银发' })
    expect(byAppearance.items.map((item) => item.id)).toEqual(['a1'])

    const byScene = await repo.list('project-1', { keyword: '站台' })
    expect(byScene.items.map((item) => item.id)).toEqual(['a2'])
  })
})
