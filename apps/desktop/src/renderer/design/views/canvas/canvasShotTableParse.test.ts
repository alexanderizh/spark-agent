import { describe, expect, it } from 'vitest'
import { parseShotTable } from './canvasShotTableParse'

const TABLE = `
分镜 agent 输出：

| 镜号 | 时长(秒) | 景别 | 运镜 | 画面/动作 | 对白 | 角色 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 近景 | 推 | 少年握紧剑柄 | 住手！ | 少年 |
| 2 | 4.5 | 全景 | 跟 | 黑衣人后退半步 | — | 黑衣人、少年 |
| 3 | 2 | 特写 | 固定 | 剑尖滴血 |  |  |

总镜数：3 · 总时长：9.5s
`

describe('canvasShotTableParse', () => {
  it('无表格返回空数组', () => {
    expect(parseShotTable('这里没有表格，只是一段说明。')).toEqual([])
  })

  it('解析标准分镜表为结构化行', () => {
    const rows = parseShotTable(TABLE)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      index: 1,
      durationSec: 3,
      shotSize: '近景',
      movement: '推',
      description: '少年握紧剑柄',
      dialogue: '住手！',
      characterNames: ['少年'],
    })
    expect(rows[0]!.shotPrompt).toContain('近景')
    expect(rows[0]!.shotPrompt).toContain('推')
  })

  it('优先解析 JSON shots', () => {
    const rows = parseShotTable(
      JSON.stringify({
        shots: [
          {
            index: 1,
            durationSec: 3,
            shotSize: '近景',
            movement: '推',
            description: '少年握紧剑柄',
            dialogue: '住手！',
            characters: ['少年'],
            shotPrompt: '近景，推镜',
          },
        ],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      index: 1,
      durationSec: 3,
      description: '少年握紧剑柄',
      characterNames: ['少年'],
      shotPrompt: '近景，推镜',
    })
  })

  it('忽略合计行与表头分隔行', () => {
    const rows = parseShotTable(TABLE)
    expect(rows.some((r) => /总镜数/.test(r.description ?? ''))).toBe(false)
    expect(rows.every((r) => r.title.startsWith('镜'))).toBe(true)
  })

  it('多角色按分隔符拆分，— 视为空', () => {
    const rows = parseShotTable(TABLE)
    expect(rows[1]!.characterNames).toEqual(['黑衣人', '少年'])
    expect(rows[1]!.dialogue).toBeUndefined()
    expect(rows[2]!.characterNames).toBeUndefined()
  })

  it('容忍时长写成 "3s" / "3 秒"', () => {
    const rows = parseShotTable(
      `| 镜号 | 时长 | 画面 |\n| - | - | - |\n| 1 | 3s | a |\n| 2 | 5 秒 | b |`,
    )
    expect(rows[0]!.durationSec).toBe(3)
    expect(rows[1]!.durationSec).toBe(5)
  })

  it('列乱序也能按表头识别', () => {
    const rows = parseShotTable(
      `| 画面/动作 | 对白 | 时长(秒) | 镜号 |\n| - | - | - | - |\n| 拔剑 | 喝！ | 2 | 7 |`,
    )
    expect(rows[0]).toMatchObject({ index: 7, durationSec: 2, description: '拔剑', dialogue: '喝！' })
  })

  it('导演 agent 增强表（多出角度/镜头列）也能解析', () => {
    const rows = parseShotTable(
      `| 镜号 | 时长(秒) | 景别 | 角度 | 运镜 | 画面 | 对白 | 角色 |\n` +
        `| - | - | - | - | - | - | - | - |\n` +
        `| 1 | 3 | 中景 | 仰拍 | 环绕 | 英雄登场 | 我来了 | 英雄 |`,
    )
    expect(rows[0]).toMatchObject({
      shotSize: '中景',
      angle: '仰拍',
      movement: '环绕',
      description: '英雄登场',
    })
    expect(rows[0]!.shotPrompt).toContain('仰拍')
  })

  it('无表头识别时按默认列序兜底', () => {
    const rows = parseShotTable(`| 1 | 3 | 近景 | 推 | 拔剑 | 住手 | 少年 |`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ durationSec: 3, description: '拔剑', dialogue: '住手' })
  })

  it('解析 groups[].segments[] 嵌套 JSON（分镜 agent 实际输出）', () => {
    const rows = parseShotTable(
      JSON.stringify({
        result: '分镜脚本',
        groups: [
          {
            name: '开场',
            segments: [
              {
                index: 1,
                title: '镜1 - 少年握剑',
                durationSec: 3,
                shotSize: '近景',
                description: '少年握紧剑柄',
                dialogue: '住手！',
                narration: '',
                shotPrompt: '近景，推镜',
                characterNames: ['少年'],
                sceneName: '街角',
                groupName: '开场',
              },
              {
                index: 2,
                title: '镜2 - 黑衣人后退',
                durationSec: 4.5,
                description: '黑衣人后退半步',
                characterNames: ['黑衣人', '少年'],
              },
            ],
          },
        ],
        summary: { shotCount: 2, totalDurationSec: 7.5 },
      }),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      index: 1,
      durationSec: 3,
      shotSize: '近景',
      description: '少年握紧剑柄',
      dialogue: '住手！',
      characterNames: ['少年'],
      shotPrompt: '近景，推镜',
    })
    expect(rows[1]).toMatchObject({
      index: 2,
      durationSec: 4.5,
      characterNames: ['黑衣人', '少年'],
    })
  })

  it('兼容 ```json 代码块包裹 + 平铺 segments[]', () => {
    const rows = parseShotTable(
      [
        '以下是分镜脚本：',
        '```json',
        JSON.stringify({
          segments: [
            { index: 1, durationSec: 2, description: '开场空镜', shotPrompt: '远景' },
            { index: 2, durationSec: 3, description: '主角登场', dialogue: '你好' },
          ],
        }),
        '```',
      ].join('\n'),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ index: 1, durationSec: 2, description: '开场空镜' })
    expect(rows[1]).toMatchObject({ index: 2, dialogue: '你好' })
  })
})
