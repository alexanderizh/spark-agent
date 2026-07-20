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
            angle: '低机位仰拍',
            movement: '推',
            focalLength: '85mm',
            aperture: 'f/2.0',
            iso: '800',
            lighting: '冷色侧逆光',
            colorTone: '青蓝',
            mood: '紧张',
            sceneLayout: '窄巷纵深构图',
            blocking: '少年前景，追兵后景',
            microExpression: '眉头收紧',
            costume: '黑色风衣',
            groupName: '追逐段落',
            sceneName: '雨夜窄巷',
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
      angle: '低机位仰拍',
      focalLength: '85mm',
      aperture: 'f/2.0',
      iso: '800',
      lighting: '冷色侧逆光',
      colorTone: '青蓝',
      mood: '紧张',
      sceneLayout: '窄巷纵深构图',
      blocking: '少年前景，追兵后景',
      performance: '眉头收紧',
      costume: '黑色风衣',
      groupName: '追逐段落',
      sceneName: '雨夜窄巷',
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
    expect(rows[0]).toMatchObject({
      index: 7,
      durationSec: 2,
      description: '拔剑',
      dialogue: '喝！',
    })
  })

  it('精简表中的动作节拍和时间轴不会误识别为动作描述或时长', () => {
    for (const header of ['动作节拍', '时间轴']) {
      const rows = parseShotTable(`| 镜号 | ${header} |\n| - | - |\n| 1 | 0.0–0.5s：抬手 |`)
      expect(rows[0]?.actionBeats).toBe('0.0–0.5s：抬手')
      expect(rows[0]?.description).toBeUndefined()
      expect(rows[0]?.durationSec).toBeUndefined()
    }
  })

  it('严格模式不抢救被截断的 JSON 前缀', () => {
    const truncated = '{"shots":[{"index":1,"durationSec":1},{"index":2,"durationSec":1},{"index":3'
    expect(parseShotTable(truncated)).toHaveLength(2)
    expect(parseShotTable(truncated, { allowPartialJsonRecovery: false })).toEqual([])
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
      groupName: '开场',
      sceneName: '街角',
    })
    expect(rows[1]).toMatchObject({
      index: 2,
      durationSec: 4.5,
      characterNames: ['黑衣人', '少年'],
      groupName: '开场',
    })
  })

  it('Markdown 增强表解析完整制作字段', () => {
    const rows = parseShotTable(
      `| 镜号 | 时长 | 场次 | 场景名 | 焦距 | 光圈 | ISO | 光照 | 色调 | 氛围 | 调度 | 表演 | 服装 | 画面 | 生成提示词 | 反向提示词 |\n` +
        `| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |\n` +
        `| 3 | 5s | 高潮 | 天台 | 35mm | f/4 | 400 | 夕阳逆光 | 金橙 | 决绝 | 两人对峙 | 眼神坚定 | 风衣 | 主角走向边缘 | 电影感广角镜头 | 文字、水印 |`,
    )
    expect(rows[0]).toMatchObject({
      index: 3,
      durationSec: 5,
      groupName: '高潮',
      sceneName: '天台',
      focalLength: '35mm',
      aperture: 'f/4',
      iso: '400',
      lighting: '夕阳逆光',
      colorTone: '金橙',
      mood: '决绝',
      blocking: '两人对峙',
      performance: '眼神坚定',
      costume: '风衣',
      description: '主角走向边缘',
      shotPrompt: '电影感广角镜头',
      negativePrompt: '文字、水印',
    })
  })

  it('解析电影级视频控制字段', () => {
    const rows = parseShotTable(
      JSON.stringify({
        shots: [
          {
            index: 1,
            title: '推门入画',
            durationSec: 2,
            composition: '主体落在右上交点，前景 20% 雨帘',
            blocking: '林岚距镜头 220cm，右手距门把 8cm',
            characterReferences: '林岚=角色图「雨夜造型」',
            actionBeats: '0.0–0.5s：手伸向门把；0.5–1.0s：压下门把；1.0–1.5s：门开；1.5–2.0s：踏入',
            soundEffects: '0.5s：金属门把轻响；1.0s：木门摩擦声',
            transition: '入：硬切；出：动作匹配硬切',
            firstFrame: '门关闭，林岚右手悬停在门把前 8cm',
            lastFrame: '门开 45°，林岚右脚落地',
            continuity: '右手持门把，保持画面运动方向左至右',
          },
        ],
      }),
    )

    expect(rows[0]).toMatchObject({
      composition: '主体落在右上交点，前景 20% 雨帘',
      characterReferences: '林岚=角色图「雨夜造型」',
      soundEffects: '0.5s：金属门把轻响；1.0s：木门摩擦声',
      transition: '入：硬切；出：动作匹配硬切',
      firstFrame: '门关闭，林岚右手悬停在门把前 8cm',
      lastFrame: '门开 45°，林岚右脚落地',
      continuity: '右手持门把，保持画面运动方向左至右',
    })
    expect(rows[0]?.actionBeats).toContain('1.5–2.0s')
  })

  it('兼容拆分节点历史使用的「布光」表头', () => {
    const rows = parseShotTable(
      `| 镜号 | 布光 | 画面/动作 |\n` +
        `| --- | --- | --- |\n` +
        `| 1 | 冷白屏幕光从正面照亮人物 | 人物盯着屏幕 |`,
    )

    expect(rows[0]).toMatchObject({
      lighting: '冷白屏幕光从正面照亮人物',
      description: '人物盯着屏幕',
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

  it('识别裸「场景」「画面」表头列（agent 常见简写）', () => {
    const rows = parseShotTable(
      [
        '| 镜号 | 时长 | 景别 | 运镜 | 场景 | 画面 |',
        '| --- | --- | --- | --- | --- | --- |',
        '| 1 | 3 | 近景 | 推 | 窄巷尽头 | 少年握紧剑柄 |',
      ].join('\n'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      shotSize: '近景',
      movement: '推',
      sceneLayout: '窄巷尽头',
      description: '少年握紧剑柄',
    })
  })

  it('识别 JSON 里「场景」「画面」中文键', () => {
    const rows = parseShotTable(
      JSON.stringify({
        shots: [
          {
            index: 1,
            时长: 3,
            景别: '近景',
            场景: '窄巷尽头',
            画面: '少年握紧剑柄',
          },
        ],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      durationSec: 3,
      shotSize: '近景',
      sceneLayout: '窄巷尽头',
      description: '少年握紧剑柄',
    })
  })
})
