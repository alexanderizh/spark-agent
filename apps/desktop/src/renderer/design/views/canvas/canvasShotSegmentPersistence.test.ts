// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCanvasHotCache, canvasApi, type CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-07-18T00:00:00.000Z'

function seedProject(): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: '分镜字段持久化',
        status: 'active',
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
        name: 'Canvas',
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
  __resetCanvasHotCache()
}

describe('canvas shot segment persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('window', window)
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({}) },
    })
    seedProject()
  })

  it('persists every structured storyboard field accepted by the canvas contract', async () => {
    const groupResult = await canvasApi.createShotGroup('project-1', { name: '第一场' })
    const groupId = groupResult.shotGroups[0]!.id

    const result = await canvasApi.createShotSegment('project-1', groupId, {
      title: '推进到特写',
      durationSec: 4,
      inSec: 0,
      outSec: 4,
      shotSize: '近景',
      angle: '平视',
      movement: '缓慢推进',
      sceneLayout: '前景雨帘，中景角色，背景茶馆',
      blocking: '林岚从画面左侧走到中央',
      lighting: '左侧暖光，右侧冷色轮廓光',
      focalLength: '50mm',
      aperture: 'f/2.8',
      iso: 'ISO 800',
      colorTone: '低饱和青橙',
      mood: '克制、紧张',
      microExpression: '眼神向右偏移，嘴角轻抿',
      costume: '深色防水外套',
      description: '林岚推门进入茶馆。',
      dialogue: '林岚：还有空房吗？',
      characterAssetIds: ['character-1'],
      sceneAssetId: 'scene-1',
      propAssetIds: ['prop-1'],
      shotPrompt: '雨夜茶馆内景，电影感近景',
      negativePrompt: '多余人物、文字水印',
      keyframeNodeIds: ['frame-1'],
      cameraDesignId: 'camera-1',
      actionDesignId: 'action-1',
      frameDesignId: 'frame-design-1',
    })

    expect(result.shotGroups[0]?.segments[0]).toMatchObject({
      durationSec: 4,
      inSec: 0,
      outSec: 4,
      shotSize: '近景',
      angle: '平视',
      movement: '缓慢推进',
      sceneLayout: '前景雨帘，中景角色，背景茶馆',
      blocking: '林岚从画面左侧走到中央',
      lighting: '左侧暖光，右侧冷色轮廓光',
      focalLength: '50mm',
      aperture: 'f/2.8',
      iso: 'ISO 800',
      colorTone: '低饱和青橙',
      mood: '克制、紧张',
      microExpression: '眼神向右偏移，嘴角轻抿',
      costume: '深色防水外套',
      negativePrompt: '多余人物、文字水印',
      keyframeNodeIds: ['frame-1'],
      cameraDesignId: 'camera-1',
      actionDesignId: 'action-1',
      frameDesignId: 'frame-design-1',
    })
  })
})
