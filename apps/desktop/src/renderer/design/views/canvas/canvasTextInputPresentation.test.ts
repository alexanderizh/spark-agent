import { describe, expect, it } from 'vitest'
import {
  formatCanvasTextInputContext,
  formatStoryboardCameraParamsForEditor,
  presentCanvasTextForModel,
  updateStoryboardCameraParams,
} from './canvasTextInputPresentation'
import type { CanvasNode } from './canvas.types'

describe('canvasTextInputPresentation', () => {
  it('converts storyboard JSON to readable markdown before sending it to a model', () => {
    const source = JSON.stringify({
      shots: [
        { index: 1, title: '走廊', durationSec: 3, shotSize: '中景', description: '人物向前走' },
      ],
    })
    const result = presentCanvasTextForModel(source)
    expect(result).toContain('| 镜号 |')
    expect(result).toContain('人物向前走')
    expect(result).not.toContain('"shots"')
  })

  it('keeps ordinary text unchanged', () => {
    expect(presentCanvasTextForModel('雨夜里的旧车站')).toBe('雨夜里的旧车站')
  })

  it('labels parsed storyboard content in node context', () => {
    const node = {
      id: 'storyboard-1',
      type: 'text',
      title: '第一场分镜',
      data: { text: '| 镜号 | 画面 |\n| --- | --- |\n| 1 | 门缓慢打开 |' },
    } as CanvasNode
    expect(formatCanvasTextInputContext(node)).toContain('【分镜脚本｜第一场分镜】')
  })

  it('combines structured lens settings for the storyboard editor camera field', () => {
    expect(
      formatStoryboardCameraParamsForEditor({
        title: '镜1',
        focalLength: '50mm',
        aperture: 'f/2.8',
        iso: '800',
      }),
    ).toBe('焦距 50mm；光圈 f/2.8；ISO 800')
    expect(
      formatStoryboardCameraParamsForEditor({
        title: '镜1',
        cameraParams: '手持摄影，浅景深',
        focalLength: '50mm',
      }),
    ).toBe('手持摄影，浅景深')
    expect(
      formatStoryboardCameraParamsForEditor({
        title: '镜1',
        cameraParams: '',
        focalLength: '50mm',
      }),
    ).toBe('')
  })

  it('collapses structured lens fields after the camera field is edited', () => {
    expect(
      updateStoryboardCameraParams(
        [
          {
            title: '镜1',
            focalLength: '50mm',
            aperture: 'f/2.8',
            iso: '800',
          },
        ],
        0,
        '手持摄影，浅景深',
      ),
    ).toEqual([{ title: '镜1', cameraParams: '手持摄影，浅景深' }])
  })
})
