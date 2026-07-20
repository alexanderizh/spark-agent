import { describe, expect, it } from 'vitest'
import {
  formatCanvasTextInputContext,
  formatStoryboardCameraParamsForEditor,
  formatStoryboardRowsAsMarkdown,
  presentCanvasTextForModel,
  resolveStoryboardRowsForEditing,
  updateStoryboardCameraParams,
} from './canvasTextInputPresentation'
import type { CanvasNode } from './canvas.types'

describe('canvasTextInputPresentation', () => {
  it('converts storyboard JSON to field-value text before sending it to a model', () => {
    const source = JSON.stringify({
      shots: [
        { index: 1, title: '走廊', durationSec: 3, shotSize: '中景', description: '人物向前走' },
      ],
    })
    const result = presentCanvasTextForModel(source)
    expect(result).toContain('名称：走廊')
    expect(result).toContain('景别：中景')
    expect(result).toContain('人物向前走')
    expect(result).not.toContain('| 镜号 |')
    expect(result).not.toContain('"shots"')
  })

  it('完整保留电影级控制字段到 Markdown 展示文本', () => {
    const markdown = formatStoryboardRowsAsMarkdown([
      {
        title: '推门',
        composition: '主体落在右上交点',
        characterReferences: '林岚=雨夜造型图',
        actionBeats: '0.0–0.5s：手接近门把',
        soundEffects: '0.5s：金属轻响',
        transition: '入：硬切',
        firstFrame: '门关闭',
        lastFrame: '门开 45°',
        continuity: '右手保持握门把',
      },
    ])

    expect(markdown).toContain('| 构图 |')
    expect(markdown).toContain('| 角色参考 |')
    expect(markdown).toContain('| 动作节拍 |')
    expect(markdown).toContain('| 音效 |')
    expect(markdown).toContain('| 转场 |')
    expect(markdown).toContain('| 首帧 |')
    expect(markdown).toContain('| 尾帧 |')
    expect(markdown).toContain('| 连续性 |')
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

  it('restores fields missing from a legacy split node using its full storyboard source', () => {
    const legacyText = [
      '# 镜 16 · 报警与脑内警告',
      '',
      '| 镜号 | 标题 | 时长(秒) | 景别 | 角度 | 运镜 | 画面/动作 | 对白 | 角色 | 布光 | 站位/调度 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 16 | 报警与脑内警告 | 10 | 近景 | 平视 | 固定 | 恶作剧的想法让苏烬背心发凉。 | 苏烬：喂！ | 苏烬 | 屋内灯光昏暗。 | 苏烬拿起手机报警。 |',
    ].join('\n')
    const sourceNode = {
      id: 'full-storyboard',
      type: 'text',
      data: {
        text: JSON.stringify({
          shots: [
            {
              index: 16,
              title: '报警与脑内警告',
              durationSec: 10,
              shotSize: '近景',
              angle: '平视',
              movement: '固定',
              focalLength: '35mm',
              aperture: 'f/2.0',
              iso: 'ISO 800',
              lighting: '屋内灯光昏暗。',
              colorTone: '冷白与暗部混合',
              mood: '困惑、恐慌',
              sceneLayout: '电脑桌前，屏幕显示查无此公司。',
              blocking: '苏烬拿起手机报警。',
              characters: ['苏烬'],
              microExpression: '瞳孔涣散，眼神焦急。',
              costume: '灰色旧卫衣',
              description: '恶作剧的想法让苏烬背心发凉。',
              dialogue: '苏烬：喂！',
              shotPrompt: '近景镜头，35mm，冷白屏幕光。',
              negativePrompt: '其他人物，过曝，水印。',
            },
          ],
        }),
      },
    } as CanvasNode

    expect(resolveStoryboardRowsForEditing(legacyText, [sourceNode])[0]).toMatchObject({
      index: 16,
      sceneLayout: '电脑桌前，屏幕显示查无此公司。',
      focalLength: '35mm',
      aperture: 'f/2.0',
      iso: 'ISO 800',
      performance: '瞳孔涣散，眼神焦急。',
      shotPrompt: '近景镜头，35mm，冷白屏幕光。',
      negativePrompt: '其他人物，过曝，水印。',
    })
  })
})
