import { describe, expect, it } from 'vitest'
import { buildCanvasPipelineOperationDraft } from './canvasPipelineActionContracts'

describe('canvas pipeline action contracts', () => {
  it('builds a screenplay operation with the existing scene screenplay format', () => {
    const draft = buildCanvasPipelineOperationDraft({
      actionId: 'chapter.to_screenplay',
      sourceText: '第一章：林岚走进雨夜茶馆。',
    })

    expect(draft).toMatchObject({
      operation: 'text_rewrite',
      title: '转剧本',
      taskPipelineRole: 'screenplay',
      outputPipelineRole: 'screenplay',
    })
    expect(draft.systemPrompt).toContain('【场号 内/外景 地点 时间】')
    expect(draft.systemPrompt).toContain('第一章：林岚走进雨夜茶馆。')
  })

  it('builds a JSON-only storyboard operation with the shot role and duration contract', () => {
    const draft = buildCanvasPipelineOperationDraft({
      actionId: 'screenplay.to_shot_script',
      sourceText: '场1 内景 茶馆 日',
      maxClipSec: 6,
    })

    expect(draft).toMatchObject({
      operation: 'text_generate',
      title: '生成分镜脚本',
      taskPipelineRole: 'shot',
      outputPipelineRole: 'shot',
      modelParams: { workflow: 'shot_script', responseFormat: 'json' },
      shotScriptConfig: { maxClipSec: 6 },
    })
    expect(draft.systemPrompt).toContain('JSON 顶层结构必须为')
    expect(draft.systemPrompt).toContain('单镜时长不得超过 6 秒')
    expect(draft.systemPrompt).toContain('只输出一个完整 JSON 对象')
    expect(draft.systemPrompt).not.toContain('再输出 Markdown 表格')
    expect(draft.systemPrompt).not.toContain('场1 内景 茶馆 日')
  })

  it.each([
    ['screenplay.extract_characters', 'character'],
    ['screenplay.extract_scenes', 'scene'],
    ['screenplay.extract_props', 'prop'],
    ['screenplay.extract_effects', 'effect'],
  ] as const)('builds structured entity extraction for %s', (actionId, role) => {
    const draft = buildCanvasPipelineOperationDraft({
      actionId,
      sourceText: '林岚在旧车站举起铜钥匙，蓝白电弧从墙面扩散。',
    })

    expect(draft).toMatchObject({
      operation: 'text_generate',
      taskPipelineRole: role,
      outputPipelineRole: role,
      modelParams: { workflow: `extract_${role}`, responseFormat: 'json' },
    })
    expect(draft.systemPrompt).toContain('JSON')
  })

  it('builds a storyboard keyframe-grid operation without asking the agent to infer roles', () => {
    const draft = buildCanvasPipelineOperationDraft({
      actionId: 'shot.to_keyframes',
      sourceText: '| 镜号 | 时长 | 画面 |\n| --- | --- | --- |\n| 1 | 4 | 推门 |',
    })

    expect(draft).toMatchObject({
      operation: 'storyboard_grid',
      title: '生成分镜关键帧图',
      taskPipelineRole: 'shot',
      outputPipelineRole: 'keyframe',
    })
    expect(draft.systemPrompt).toContain('分镜关键帧宫格图')
  })

  it('builds a character identity-board image task directly from ordinary text', () => {
    const draft = buildCanvasPipelineOperationDraft({
      actionId: 'character.three_view',
      sourceText: '王鱼：黑发青年，灰色长风衣，左眼下方有一道短疤。',
      styleBible: '低饱和电影质感，冷暖对比光。',
    })

    expect(draft).toMatchObject({
      operation: 'text_to_image',
      title: '生成角色身份板',
      taskPipelineRole: 'design_card',
      outputPipelineRole: 'design_card',
      modelParams: { aspect_ratio: '16:9' },
    })
    expect(draft.systemPrompt).toContain('王鱼')
    expect(draft.systemPrompt).toContain('低饱和电影质感')
  })

  it('keeps generated scene images free of people', () => {
    const draft = buildCanvasPipelineOperationDraft({
      actionId: 'scene.scene_image',
      sourceText: '雨夜茶馆，木质柜台与暖色吊灯。',
    })

    expect(draft.systemPrompt).toContain('【不要存在人物】')
    expect(draft.systemPrompt).toContain('只呈现纯粹的场景')
    expect(draft.systemPrompt).toContain('雨夜茶馆，木质柜台与暖色吊灯。')
  })

  it('builds the recommended screenplay split operation from its action id', () => {
    const draft = buildCanvasPipelineOperationDraft({
      actionId: 'screenplay.split_episodes',
      sourceText: '# 场1 内景 茶馆 日\n\n林岚：还有空房吗？',
    })

    expect(draft).toMatchObject({
      operation: 'text_generate',
      taskPipelineRole: 'screenplay',
      outputPipelineRole: 'screenplay',
    })
    expect(draft.systemPrompt).toContain('分集')
    expect(draft.systemPrompt).toContain('场次剧本格式')
  })

  it('builds the recommended 360 panorama operation from its action id', () => {
    const draft = buildCanvasPipelineOperationDraft({
      actionId: 'scene.panorama_360',
      sourceText: '雨夜茶馆，木质柜台与暖色吊灯。',
    })

    expect(draft).toMatchObject({
      operation: 'panorama_360',
      taskPipelineRole: 'scene',
      outputPipelineRole: 'design_card',
      modelParams: { aspect_ratio: '2:1' },
    })
    expect(draft.systemPrompt).toContain('equirectangular')
  })

  it('rejects unknown action ids instead of falling back to a generic operation', () => {
    expect(() =>
      buildCanvasPipelineOperationDraft({ actionId: 'unknown.action', sourceText: 'x' }),
    ).toThrow('不支持的画布流水线动作')
  })
})
