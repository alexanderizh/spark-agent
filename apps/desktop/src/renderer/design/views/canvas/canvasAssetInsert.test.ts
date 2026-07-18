// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasApi, __resetCanvasHotCache } from './canvas.api'
import type { CanvasDb } from './canvas.api'
import { fitMediaNodeSize, fitTextNodeSize, readAssetTextForNode } from './canvas.api'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import type { FilmAssetKind } from './canvasFilmAssets'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-06-18T00:00:00.000Z'
const pipelineRoleByKind: Partial<Record<FilmAssetKind, CanvasNode['data']['pipelineRole']>> = {
  chapter: 'chapter',
  script: 'screenplay',
  character: 'character',
  scene: 'scene',
  prop: 'prop',
  effect: 'effect',
}

function seedProject(): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: '影视资产项目',
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

function longAssetText(label: string): string {
  return Array.from(
    { length: 8 },
    (_, index) =>
      `${label}第${index + 1}段：角色在雨夜街口停下，霓虹和雾气压低画面，动作、情绪、环境细节都需要保留在画布节点中。`,
  ).join('\n')
}

describe('canvas asset insertion', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
    vi.stubGlobal('window', window)
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }) },
    })
    seedProject()
  })

  it('creates prompt nodes when requested by the canvas menu', async () => {
    const node = await canvasApi.createTextNode({
      projectId: 'project-1',
      boardId: 'board-1',
      kind: 'prompt',
      text: '',
      x: 32,
      y: 48,
    })

    const snapshot = await canvasApi.openSnapshot('project-1')
    const asset = snapshot.assets.find((item) => item.id === node.assetId)

    expect(node.type).toBe('prompt')
    expect(node.title).toBe('Prompt')
    expect(node.data.format).toBe('prompt')
    expect(asset?.type).toBe('prompt')
  })

  it('keeps screenplay text after inserting a film asset and tagging pipeline role', async () => {
    const scriptText = longAssetText('剧本')
    const asset = await canvasApi.createFilmAsset('project-1', {
      kind: 'script',
      name: '雨夜追逐',
      text: scriptText,
    })

    const node = await canvasApi.insertAssetToBoard({
      projectId: 'project-1',
      boardId: 'board-1',
      assetId: asset.id,
      x: 100,
      y: 120,
    })

    expect(node?.type).toBe('text')
    expect(node?.data.text).toBe(scriptText)
    expect(node?.width).toBeGreaterThan(300)
    expect(node?.height).toBeGreaterThan(164)

    await canvasApi.updateNodeData('project-1', node!.id, { pipelineRole: 'screenplay' })
    const snapshot = await canvasApi.openSnapshot('project-1')
    const updatedNode = snapshot.nodes.find((item) => item.id === node!.id)
    const updatedAsset = snapshot.assets.find((item) => item.id === asset.id)

    expect(updatedNode?.data.text).toBe(scriptText)
    expect(updatedNode?.data.pipelineRole).toBe('screenplay')
    expect(updatedAsset?.contentText).toBe(scriptText)
  })

  it.each([
    ['manuscript', 'text'],
    ['chapter', 'text'],
    ['script', 'text'],
    ['character', 'prompt'],
    ['scene', 'prompt'],
    ['prop', 'prompt'],
    ['effect', 'prompt'],
  ] as Array<[FilmAssetKind, CanvasNode['type']]>)(
    'inserts %s assets with their text and adaptive text size',
    async (kind, expectedNodeType) => {
      const text = longAssetText(kind)
      const asset = await canvasApi.createFilmAsset('project-1', {
        kind,
        name: `${kind} asset`,
        text,
      })

      const node = await canvasApi.insertAssetToBoard({
        projectId: 'project-1',
        boardId: 'board-1',
        assetId: asset.id,
        x: 10,
        y: 20,
      })

      expect(node?.type).toBe(expectedNodeType)
      expect(node?.data.text).toBe(text)
      expect(node?.width).toBeGreaterThan(300)
      expect(node?.height).toBeGreaterThan(164)

      const role = pipelineRoleByKind[kind]
      if (node && role) {
        await canvasApi.updateNodeData('project-1', node.id, { pipelineRole: role })
        const snapshot = await canvasApi.openSnapshot('project-1')
        const updatedNode = snapshot.nodes.find((item) => item.id === node.id)
        expect(updatedNode?.data.text).toBe(text)
        expect(updatedNode?.data.pipelineRole).toBe(role)
      }
    },
  )

  it('uses prompt metadata when a prompt-like film asset has no contentText', async () => {
    const prompt = longAssetText('场景提示词')
    const asset = await canvasApi.createFilmAsset('project-1', {
      kind: 'scene',
      name: '雨夜巷口',
      prompt,
    })

    const node = await canvasApi.insertAssetToBoard({
      projectId: 'project-1',
      boardId: 'board-1',
      assetId: asset.id,
      x: 0,
      y: 0,
    })

    expect(node?.type).toBe('prompt')
    expect(node?.data.text).toBe(prompt)
  })

  it('fits portrait image assets to the full-bleed image ratio', async () => {
    const asset = await canvasApi.createImageAsset({
      projectId: 'project-1',
      file: new File([new Uint8Array([1, 2, 3])], 'portrait.png', { type: 'image/png' }),
      filePath: '/tmp/project-1/portrait.png',
      imageWidth: 800,
      imageHeight: 1200,
    })

    const node = await canvasApi.insertAssetToBoard({
      projectId: 'project-1',
      boardId: 'board-1',
      assetId: asset.id,
      x: 24,
      y: 48,
    })

    expect(node?.type).toBe('image')
    expect(node?.width).toBe(480)
    expect(node?.height).toBe(720)
  })

  it('fits landscape image assets to their visible content height', async () => {
    const asset = await canvasApi.createImageAsset({
      projectId: 'project-1',
      file: new File([new Uint8Array([1, 2, 3])], 'landscape.png', { type: 'image/png' }),
      filePath: '/tmp/project-1/landscape.png',
      imageWidth: 1920,
      imageHeight: 1080,
    })

    const node = await canvasApi.insertAssetToBoard({
      projectId: 'project-1',
      boardId: 'board-1',
      assetId: asset.id,
      x: 24,
      y: 48,
    })

    expect(node?.type).toBe('image')
    expect(node?.width).toBe(540)
    expect(node?.height).toBe(304)
  })

  // 居中落点依赖 resolveAssetInsertSize 算出的尺寸与 insertAssetToBoard 最终节点
  // 尺寸完全一致。这里镜像 CanvasWorkspaceView.resolveAssetInsertSize 的分支逻辑，
  // 验证对图片/视频/文本资产，两种算法结果相同——否则插入位置会偏出视口中心。
  it.each([
    { type: 'image', width: 800, height: 1200 },
    { type: 'image', width: 1920, height: 1080 },
    { type: 'video', width: 1280, height: 720 },
  ] as Array<{ type: CanvasAsset['type']; width: number; height: number }>)(
    'resolveAssetInsertSize matches insertAssetToBoard node size for $type $widthx$height',
    async ({ type, width, height }) => {
      const db = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as CanvasDb
      const asset: CanvasAsset = {
        id: `${type}-asset-1`,
        projectId: 'project-1',
        userId: 0,
        type,
        source: 'upload',
        title: `${type} asset`,
        width,
        height,
        metadata: {},
        createdAt: at,
        updatedAt: at,
      }
      db.assets.push(asset)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))

      const node = await canvasApi.insertAssetToBoard({
        projectId: 'project-1',
        boardId: 'board-1',
        assetId: asset.id,
        x: 0,
        y: 0,
      })

      const resolved = resolveAssetInsertSize(asset)
      expect(resolved.width).toBe(node?.width)
      expect(resolved.height).toBe(node?.height)
    },
  )

  it('resolveAssetInsertSize matches text asset node size', async () => {
    const text = longAssetText('文本')
    const db = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as CanvasDb
    const asset: CanvasAsset = {
      id: 'text-asset-1',
      projectId: 'project-1',
      userId: 0,
      type: 'text',
      source: 'manual',
      title: '文本资产',
      contentText: text,
      metadata: {},
      createdAt: at,
      updatedAt: at,
    }
    db.assets.push(asset)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))

    const node = await canvasApi.insertAssetToBoard({
      projectId: 'project-1',
      boardId: 'board-1',
      assetId: asset.id,
      x: 0,
      y: 0,
    })

    const resolved = resolveAssetInsertSize(asset)
    expect(resolved.width).toBe(node?.width)
    expect(resolved.height).toBe(node?.height)
  })
})

/** 镜像 CanvasWorkspaceView.resolveAssetInsertSize：插入前预测节点尺寸。 */
function resolveAssetInsertSize(asset: CanvasAsset): { width: number; height: number } {
  if (asset.type === 'text' || asset.type === 'prompt') {
    return fitTextNodeSize(readAssetTextForNode(asset))
  }
  return fitMediaNodeSize(asset.type, asset.width, asset.height)
}
