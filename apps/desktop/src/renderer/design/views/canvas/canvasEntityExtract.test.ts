import { describe, expect, it } from 'vitest'
import {
  buildEntityDescription,
  buildEntityExtractionPrompt,
  parseExtractedCharacters,
  parseExtractedScenes,
} from './canvasEntityExtract'

describe('canvasEntityExtract', () => {
  describe('buildEntityExtractionPrompt', () => {
    it('角色抽取提示词含格式要求与剧本', () => {
      const prompt = buildEntityExtractionPrompt('character', '林岚推门进入。', '水墨写意')
      expect(prompt).toContain('抽取其中出现的全部角色')
      expect(prompt).toContain('"entities"')
      expect(prompt).toContain('只输出一个 JSON 对象')
      expect(prompt).toContain('林岚推门进入。')
      expect(prompt).toContain('水墨写意')
    })
    it('场景抽取提示词用场景字段', () => {
      const prompt = buildEntityExtractionPrompt('scene', '车站候车室')
      expect(prompt).toContain('抽取其中出现的全部场景')
      expect(prompt).toContain('location')
    })
    it('角色抽取提示词含加厚后的精细字段', () => {
      const prompt = buildEntityExtractionPrompt('character', '林岚')
      expect(prompt).toContain('height')
      expect(prompt).toContain('skin')
      expect(prompt).toContain('accessories')
      expect(prompt).toContain('marks')
      // 精细化指令逼出多维度描述
      expect(prompt).toContain('精细化要求')
    })
    it('场景抽取提示词含空间层次/视角/材质等新维度', () => {
      const prompt = buildEntityExtractionPrompt('scene', '候车室')
      expect(prompt).toContain('spatialLayout')
      expect(prompt).toContain('perspective')
      expect(prompt).toContain('materials')
    })
  })

  describe('buildEntityDescription', () => {
    it('拼接字段为可读描述', () => {
      const desc = buildEntityDescription('林岚', { gender: '男', appearance: '清瘦' })
      expect(desc).toBe('林岚（性别：男；外貌：清瘦）')
    })
    it('无字段只返回名称', () => {
      expect(buildEntityDescription('林岚', {})).toBe('林岚')
    })
  })

  describe('parseExtractedCharacters', () => {
    const OUTPUT = `
名称：林岚
性别：男
外貌：清瘦，左脸有疤
服饰：靛蓝短打
标志道具：铜钥匙
性格：沉默、坚韧

名称：陈默
性别：男
身份：神秘访客
外貌：高大，戴墨镜
`

    it('一对多解析出多个角色', () => {
      const rows = parseExtractedCharacters(OUTPUT)
      expect(rows).toHaveLength(2)
      expect(rows[0]!.name).toBe('林岚')
      expect(rows[1]!.name).toBe('陈默')
    })

    it('字段归一化进 fields', () => {
      const rows = parseExtractedCharacters(OUTPUT)
      expect(rows[0]!.fields.appearance).toBe('清瘦，左脸有疤')
      expect(rows[0]!.fields.signatureProp).toBe('铜钥匙')
      expect(rows[1]!.fields.occupation).toBe('神秘访客')
    })

    it('字段别名（长相→外貌、穿着→服饰）归一', () => {
      const rows = parseExtractedCharacters('名称：甲\n长相：圆脸\n穿着：白袍')
      expect(rows[0]!.fields.appearance).toBe('圆脸')
      expect(rows[0]!.fields.costume).toBe('白袍')
    })

    it('新增精细字段别名归一（身高/肤色/五官/配饰/标志特征/气质）', () => {
      const rows = parseExtractedCharacters(
        [
          '名称：甲',
          '身高：178cm 修长',
          '肤色：小麦色',
          '五官：剑眉深目',
          '配饰：皮护腕',
          '标志特征：左脸旧疤',
          '气质：沉静内敛',
        ].join('\n'),
      )
      expect(rows[0]!.fields.height).toBe('178cm 修长')
      expect(rows[0]!.fields.skin).toBe('小麦色')
      expect(rows[0]!.fields.face).toBe('剑眉深目')
      expect(rows[0]!.fields.accessories).toBe('皮护腕')
      expect(rows[0]!.fields.marks).toBe('左脸旧疤')
      expect(rows[0]!.fields.temperament).toBe('沉静内敛')
    })

    it('同名角色合并，不覆盖已有非空值', () => {
      const rows = parseExtractedCharacters('名称：甲\n外貌：高\n\n名称：甲\n外貌：矮\n性格：急躁')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.fields.appearance).toBe('高')
      expect(rows[0]!.fields.personality).toBe('急躁')
    })

    it('description 含名称与字段', () => {
      const rows = parseExtractedCharacters('名称：甲\n外貌：高')
      expect(rows[0]!.description).toContain('甲')
      expect(rows[0]!.description).toContain('外貌：高')
    })

    it('无名称行返回空', () => {
      expect(parseExtractedCharacters('这是一段没有实体的说明文字。')).toEqual([])
    })

    it('名称前缺失时忽略孤立字段行', () => {
      const rows = parseExtractedCharacters('外貌：高\n名称：乙\n服饰：黑衣')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.name).toBe('乙')
      expect(rows[0]!.fields.costume).toBe('黑衣')
      expect(rows[0]!.fields.appearance).toBeUndefined()
    })

    it('兜底：编号列表「1. 名字」也能解析', () => {
      const rows = parseExtractedCharacters('1. 林岚\n外貌：清瘦\n2. 陈默\n身份：访客')
      expect(rows.map((r) => r.name)).toEqual(['林岚', '陈默'])
      expect(rows[0]!.fields.appearance).toBe('清瘦')
      expect(rows[1]!.fields.occupation).toBe('访客')
    })

    it('兜底：「1、名字：描述」名字与描述分离', () => {
      const rows = parseExtractedCharacters('1、林岚：清瘦少年，铜钥匙')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.name).toBe('林岚')
      expect(rows[0]!.description).toContain('清瘦少年')
    })

    it('兜底不误伤普通字段行（外貌：高 不被当作实体）', () => {
      const rows = parseExtractedCharacters('名称：甲\n外貌：高\n性格：稳')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.fields.appearance).toBe('高')
    })

    it('优先解析 JSON 格式并保留 prompt', () => {
      const rows = parseExtractedCharacters(
        JSON.stringify({
          entities: [
            {
              name: '林岚',
              description: '清瘦青年',
              prompt: 'slim young man',
              attributes: { appearance: '清瘦', costume: '靛蓝短打' },
            },
          ],
        }),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.fields.appearance).toBe('清瘦')
      expect(rows[0]!.prompt).toBe('slim young man')
    })

    it('兼容模型直接输出 JSON 实体数组', () => {
      const rows = parseExtractedCharacters(
        JSON.stringify([
          {
            name: '林岚',
            description: '清瘦青年，左脸有旧疤。',
            prompt: 'slim young man with scar',
            attributes: { appearance: '清瘦', marks: '左脸旧疤' },
          },
        ]),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.name).toBe('林岚')
      expect(rows[0]!.fields.marks).toBe('左脸旧疤')
    })
  })

  describe('parseExtractedScenes', () => {
    it('解析场景并归一化字段', () => {
      const rows = parseExtractedScenes('名称：候车室\n内外景：内景\n位置：废弃车站\n光影：昏暗')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.fields.settingType).toBe('内景')
      expect(rows[0]!.fields.location).toBe('废弃车站')
      expect(rows[0]!.fields.lighting).toBe('昏暗')
    })
    it('解析场景新增维度（年代/空间层次/视角/材质/体量）', () => {
      const rows = parseExtractedScenes(
        [
          '名称：候车室',
          '年代：80年代',
          '空间层次：前景长椅，背景拱窗',
          '视角：低机位广角',
          '材质：水磨石立柱',
          '体量：层高6米',
        ].join('\n'),
      )
      expect(rows[0]!.fields.era).toBe('80年代')
      expect(rows[0]!.fields.spatialLayout).toBe('前景长椅，背景拱窗')
      expect(rows[0]!.fields.perspective).toBe('低机位广角')
      expect(rows[0]!.fields.materials).toBe('水磨石立柱')
      expect(rows[0]!.fields.scale).toBe('层高6米')
    })
  })
})
