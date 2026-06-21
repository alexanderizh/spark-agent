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
  })

  describe('parseExtractedScenes', () => {
    it('解析场景并归一化字段', () => {
      const rows = parseExtractedScenes('名称：候车室\n内外景：内景\n位置：废弃车站\n光影：昏暗')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.fields.settingType).toBe('内景')
      expect(rows[0]!.fields.location).toBe('废弃车站')
      expect(rows[0]!.fields.lighting).toBe('昏暗')
    })
  })
})
