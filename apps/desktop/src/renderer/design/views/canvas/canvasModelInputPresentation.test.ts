import { describe, expect, it } from 'vitest'
import {
  renderCanvasReferenceImageList,
  renderCanvasTextReference,
} from './canvasModelInputPresentation'

describe('canvasModelInputPresentation', () => {
  it('renders storyboard JSON as bounded field-value records instead of a table', () => {
    const rendered = renderCanvasTextReference({
      ordinal: 1,
      label: '分镜脚本',
      relation: 'storyboard',
      content: JSON.stringify({
        shots: [
          {
            index: 1,
            title: '烟雾与拒绝',
            durationSec: 8,
            sceneName: '狭窄出租房',
            characters: ['苏烬'],
            shotSize: '特写',
            description: '苏烬面对电脑屏幕缓慢吐出烟雾',
          },
        ],
      }),
    })

    expect(rendered).toContain('[文本引用 T1 开始]')
    expect(rendered).toContain('类型：分镜脚本')
    expect(rendered).toContain('名称：烟雾与拒绝')
    expect(rendered).toContain('角色：苏烬')
    expect(rendered).toContain('场景：狭窄出租房')
    expect(rendered).toContain('时长（秒）：8')
    expect(rendered).toContain('[/文本引用 T1 结束]')
    expect(rendered).not.toContain('|')
  })

  it('normalizes a storyboard Markdown table to the same semantic fields', () => {
    const rendered = renderCanvasTextReference({
      ordinal: 2,
      label: '镜头表',
      relation: 'storyboard',
      content: [
        '| 镜号 | 标题 | 角色 | 场景名 | 时长(秒) | 画面/动作 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| 1 | 烟雾与拒绝 | 苏烬 | 狭窄出租房 | 8 | 缓慢吐出烟雾 |',
      ].join('\n'),
    })

    expect(rendered).toContain('[文本引用 T2 开始]')
    expect(rendered).toContain('名称：烟雾与拒绝')
    expect(rendered).toContain('角色：苏烬')
    expect(rendered).toContain('场景：狭窄出租房')
    expect(rendered).not.toContain('| ---')
  })

  it('converts a generic Markdown table into named records using the original headers', () => {
    const rendered = renderCanvasTextReference({
      ordinal: 3,
      label: '资料表',
      relation: 'generic',
      content: [
        '| 名称 | 角色 | 场景 | 备注 |',
        '| --- | --- | --- | --- |',
        '| 第一幕 | 苏烬 | 出租房 | 冷色<br>低照度 |',
      ].join('\n'),
    })

    expect(rendered).toContain('记录 1')
    expect(rendered).toContain('名称：第一幕')
    expect(rendered).toContain('角色：苏烬')
    expect(rendered).toContain('备注：冷色\n  低照度')
    expect(rendered).not.toContain('|')
  })

  it('preserves prose before and after a generic Markdown table', () => {
    const rendered = renderCanvasTextReference({
      ordinal: 4,
      label: '补充资料',
      relation: 'generic',
      content: [
        '以下资料用于约束角色：',
        '',
        '| 名称 | 角色 |',
        '| --- | --- |',
        '| 第一幕 | 苏烬 |',
        '',
        '请严格保持以上角色关系。',
      ].join('\n'),
    })

    expect(rendered).toContain('以下资料用于约束角色：')
    expect(rendered).toContain('记录 1\n名称：第一幕\n角色：苏烬')
    expect(rendered).toContain('请严格保持以上角色关系。')
    expect(rendered).not.toContain('| --- |')
  })

  it('keeps raw text intact while adding an unambiguous boundary', () => {
    const rendered = renderCanvasTextReference({
      ordinal: 5,
      label: 'Text note',
      relation: 'generic',
      content: '第一行\n第二行',
    })

    expect(rendered).toBe(
      '[文本引用 T5 开始]\n类型：文本\n名称：Text note\n\n第一行\n第二行\n[/文本引用 T5 结束]',
    )
  })

  it('renders reference image labels with one-based provider ordinals', () => {
    expect(
      renderCanvasReferenceImageList([
        { ordinal: 1, label: '生成角色身份板 · 苏烬', relation: 'character' },
        { ordinal: 2, label: '出租屋', relation: 'scene' },
      ]),
    ).toBe(
      '[图片引用]\n参考图 #1：生成角色身份板 · 苏烬（角色）\n参考图 #2：出租屋（场景）\n[/图片引用]',
    )
  })
})
