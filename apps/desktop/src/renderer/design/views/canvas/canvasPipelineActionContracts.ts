import { buildEntityExtractionPrompt, type ExtractEntityKind } from './canvasEntityExtract'
import {
  buildAgentPresetPrompt,
  DEFAULT_MAX_CLIP_SEC,
  type AgentPresetContext,
} from './canvasAgentPromptPresets'
import type { CanvasOperationType, CanvasPipelineRole, ShotScriptConfig } from './canvas.types'
import { buildChapterToScreenplayInstruction } from './canvasWorkspaceFilm'
import { SCENE_NO_PEOPLE_PROMPT } from './canvasScenePrompt'
import { stripCanvasFunctionalPromptInput } from './canvasPromptInitialization'

export type CanvasPipelineOperationDraft = {
  operation: CanvasOperationType
  title: string
  systemPrompt: string
  message: string
  taskPipelineRole?: CanvasPipelineRole
  outputPipelineRole?: CanvasPipelineRole
  modelParams?: Record<string, unknown>
  shotScriptConfig?: ShotScriptConfig
}

export type BuildCanvasPipelineOperationDraftInput = {
  actionId: string
  sourceText: string
  styleBible?: string
  maxClipSec?: number
}

const ENTITY_ACTIONS: Partial<Record<string, ExtractEntityKind>> = {
  'screenplay.extract_characters': 'character',
  'screenplay.extract_scenes': 'scene',
  'screenplay.extract_props': 'prop',
  'screenplay.extract_effects': 'effect',
}

const ENTITY_LABELS: Record<ExtractEntityKind, string> = {
  character: '提取角色',
  scene: '提取场景',
  prop: '提取道具',
  effect: '提取特效',
}

function buildJsonOnlyStoryboardPrompt(context: AgentPresetContext): string {
  const prompt = buildAgentPresetPrompt('storyboard', context)
  const withoutTableInstruction = prompt.replace(
    '【输出格式】先输出一个完整的 JSON 对象（务必完整闭合 ```json 代码块），再输出 Markdown 表格。',
    '【输出格式】只输出一个完整 JSON 对象，不要输出 Markdown 表格、解释文字或额外代码块。',
  )
  const tableStart = withoutTableInstruction.indexOf('随后输出兼容导入器的 Markdown 表格')
  const qualityStart = withoutTableInstruction.indexOf('【质量要求（务必遵守）】')
  if (tableStart < 0 || qualityStart < 0 || qualityStart <= tableStart)
    return withoutTableInstruction
  return `${withoutTableInstruction.slice(0, tableStart)}${withoutTableInstruction.slice(qualityStart)}`
}

function entityDraft(
  kind: ExtractEntityKind,
  input: BuildCanvasPipelineOperationDraftInput,
): CanvasPipelineOperationDraft {
  const title = ENTITY_LABELS[kind]
  return {
    operation: 'text_generate',
    title,
    systemPrompt: buildEntityExtractionPrompt(kind, input.sourceText, input.styleBible),
    message: `确认${title} Prompt、Agent 与模型后点击开始任务`,
    taskPipelineRole: kind,
    outputPipelineRole: kind,
    modelParams: { workflow: `extract_${kind}`, responseFormat: 'json' },
  }
}

export function buildCanvasPipelineOperationDraft(
  input: BuildCanvasPipelineOperationDraftInput,
): CanvasPipelineOperationDraft {
  const entityKind = ENTITY_ACTIONS[input.actionId]
  if (entityKind) return entityDraft(entityKind, input)

  switch (input.actionId) {
    case 'chapter.to_screenplay':
      return {
        operation: 'text_rewrite',
        title: '转剧本',
        systemPrompt: buildChapterToScreenplayInstruction(input.sourceText),
        message: '确认 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: 'screenplay',
        outputPipelineRole: 'screenplay',
      }
    case 'screenplay.to_shot_script': {
      const maxClipSec = input.maxClipSec ?? DEFAULT_MAX_CLIP_SEC
      return {
        operation: 'text_generate',
        title: '生成分镜脚本',
        systemPrompt: stripCanvasFunctionalPromptInput(
          buildJsonOnlyStoryboardPrompt({
            upstreamText: input.sourceText,
            maxClipSec,
            ...(input.styleBible ? { styleBible: input.styleBible } : {}),
          }),
          'screenplay.to_shot_script',
        ),
        message: '确认分镜脚本 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: 'shot',
        outputPipelineRole: 'shot',
        modelParams: { workflow: 'shot_script', responseFormat: 'json' },
        shotScriptConfig: { maxClipSec },
      }
    }
    case 'screenplay.split_episodes':
      return {
        operation: 'text_generate',
        title: '按剧情分集',
        systemPrompt: `请把下面的长剧本按剧情冲突、悬念节奏和合理时长完成分集。每集必须包含集号、标题、开场钩子、主要冲突、结尾悬念，并使用现有场次剧本格式输出完整正文；不要只给剧情摘要。\n\n${input.sourceText}`,
        message: '确认分集 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: 'screenplay',
        outputPipelineRole: 'screenplay',
        modelParams: { workflow: 'split_episodes' },
      }
    case 'shot.to_keyframes':
    case 'screenplay.storyboard_grid':
      return {
        operation: 'storyboard_grid',
        title: '生成分镜关键帧图',
        systemPrompt:
          '请根据输入的分镜脚本文本，生成一张分镜关键帧宫格图，保持镜头顺序、人物一致性与场景连续性。',
        message: '确认故事板 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: 'shot',
        outputPipelineRole: 'keyframe',
      }
    case 'character.three_view':
      return {
        operation: 'text_to_image',
        title: '生成角色身份板',
        systemPrompt: [
          '请根据以下角色设定生成专业角色身份板，包含头部和全身多视角，保持身份、服装和五官一致。',
          input.sourceText,
          input.styleBible ? `视觉总设定：\n${input.styleBible}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        message: '确认 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: 'design_card',
        outputPipelineRole: 'design_card',
        modelParams: { aspect_ratio: '16:9' },
      }
    case 'scene.scene_image':
    case 'prop.prop_image':
    case 'effect.effect_image':
      return {
        operation: 'text_to_image',
        title:
          input.actionId === 'scene.scene_image'
            ? '生成场景图'
            : input.actionId === 'prop.prop_image'
              ? '生成道具图'
              : '生成特效图',
        systemPrompt:
          input.actionId === 'scene.scene_image'
            ? `${SCENE_NO_PEOPLE_PROMPT}\n\n${input.sourceText}`
            : input.sourceText,
        message: '确认 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: 'design_card',
        outputPipelineRole: 'design_card',
      }
    case 'scene.panorama_360':
      return {
        operation: 'panorama_360',
        title: '生成重点场景 360 全景图',
        systemPrompt: `请根据以下场景设定生成 2:1 equirectangular 等距柱状投影全景图。保持水平线稳定、左右边缘无缝衔接，并完整表现前后左右空间关系。\n\n${input.sourceText}`,
        message: '确认全景图 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: 'scene',
        outputPipelineRole: 'design_card',
        modelParams: { aspect_ratio: '2:1' },
      }
    case 'shot.to_video':
    case 'keyframe.to_video':
      return {
        operation: input.actionId === 'keyframe.to_video' ? 'image_to_video' : 'text_to_video',
        title: '生成视频',
        systemPrompt: input.sourceText,
        message: '确认视频 Prompt、Agent 与模型后点击开始任务',
        taskPipelineRole: input.actionId === 'keyframe.to_video' ? 'keyframe' : 'shot',
        outputPipelineRole: 'clip',
      }
    default:
      throw new Error(`不支持的画布流水线动作：${input.actionId}`)
  }
}
