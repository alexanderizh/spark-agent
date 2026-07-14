import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CanvasShotScriptTable } from './CanvasShotScriptTable'

describe('CanvasShotScriptTable', () => {
  it('在节点表格中展示完整分镜制作字段', () => {
    const html = renderToStaticMarkup(
      <CanvasShotScriptTable
        rows={[
          {
            index: 1,
            title: '雨夜追逐',
            durationSec: 4,
            shotSize: '近景',
            angle: '低机位',
            movement: '跟拍',
            groupName: '追逐段落',
            sceneName: '雨夜窄巷',
            sceneLayout: '纵深构图',
            description: '主角冲出巷口',
            blocking: '主角前景，追兵后景',
            performance: '喘息并回望',
            focalLength: '35mm',
            aperture: 'f/2.8',
            iso: '800',
            cameraParams: '手持轻微抖动',
            lighting: '冷色侧逆光',
            colorTone: '青蓝',
            mood: '紧张',
            dialogue: '快跑！',
            narration: '雨越下越大。',
            characterNames: ['苏黎', '追兵'],
            costume: '深色风衣',
            shotPrompt: '电影感雨夜跟拍镜头',
            negativePrompt: '文字、水印、畸形手指',
          },
        ]}
      />,
    )

    for (const value of [
      '镜号 / 时长',
      '雨夜追逐',
      '低机位',
      '追逐段落',
      '纵深构图',
      '主角前景，追兵后景',
      '喘息并回望',
      '35mm',
      'f/2.8',
      '手持轻微抖动',
      '冷色侧逆光',
      '青蓝',
      '紧张',
      '快跑！',
      '雨越下越大。',
      '苏黎、追兵',
      '深色风衣',
      '电影感雨夜跟拍镜头',
      '文字、水印、畸形手指',
    ]) {
      expect(html).toContain(value)
    }
  })
})
