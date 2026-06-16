/**
 * 画布模板定义（文档 §7.8 模板与工具箱）。
 *
 * 第一阶段不建复杂数据库系统，内置模板用 TS 常量，用户自定义模板先放
 * project.metadata 或 localStorage（文档明确要求）。
 * 「从模板生成节点组合」由 canvasApi.applyTemplate 落地。
 */

import type { CanvasNodeData, CanvasNodeType } from './canvas.types'

/** 模板内单个节点蓝图（相对坐标，应用到画布时加 originX/originY 偏移） */
export type NodeBlueprint = {
  /** 蓝图内唯一标识，供 edge 引用 */
  ref: string
  type: CanvasNodeType
  title?: string
  /** 相对模板原点的 x/y */
  x: number
  y: number
  width?: number
  height?: number
  data?: Partial<CanvasNodeData>
}

/** 模板内连线蓝图（用 blueprintRef 引用，避免依赖真实 id） */
export type EdgeBlueprint = {
  from: string
  to: string
  type?: 'used_as_input' | 'generated' | 'references'
}

export type CanvasTemplateType =
  | 'prompt' // Prompt 模板（单个 prompt 节点）
  | 'task_params' // 任务参数模板（task 节点 + 预填 prompt）
  | 'workflow' // 工作流模板（多节点 + 连线）
  | 'layout' // 布局模板（纯结构，无内容）

/** 画布模板 */
export type CanvasTemplate = {
  id: string
  name: string
  type: CanvasTemplateType
  description?: string
  /** 节点蓝图 */
  nodes: NodeBlueprint[]
  /** 连线蓝图（可选） */
  edges?: EdgeBlueprint[]
  /** 默认参数提示（仅供 UI 展示，应用到 task 时由调用方合并） */
  defaultParams?: {
    prompt?: string
    negativePrompt?: string
  }
}

/** 文档 §7.8 工作流模板示例：内置第一批 */
export const BUILTIN_TEMPLATES: CanvasTemplate[] = [
  {
    id: 'tpl.character_design',
    name: '角色立绘生成流',
    type: 'workflow',
    description: '角色设定 → 文生图，适合角色概念设计',
    defaultParams: { prompt: '高质量角色立绘，精细五官，全身构图，专业插画' },
    nodes: [
      {
        ref: 'char_prompt',
        type: 'prompt',
        title: '角色设定',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        data: {
          text: '请描述角色：外貌、服饰、性格、年龄、风格。例如：年轻女剑士，银色长发，黑色战甲，坚毅眼神，二次元风格。',
          format: 'prompt',
          origin: 'template',
        },
      },
      {
        ref: 'char_task',
        type: 'task',
        title: '文生图 · 角色立绘',
        x: 380,
        y: 20,
        width: 300,
        height: 152,
        data: {
          operation: 'text_to_image',
          prompt: '高质量角色立绘，精细五官，全身构图，专业插画',
          status: 'pending',
          progress: 0,
          message: '从模板创建，配置后运行',
          origin: 'template',
        },
      },
    ],
    edges: [{ from: 'char_prompt', to: 'char_task', type: 'used_as_input' }],
  },
  {
    id: 'tpl.poster',
    name: '电商海报生成流',
    type: 'workflow',
    description: '产品图 + 文案 → 海报合成',
    defaultParams: { prompt: '电商主图，产品居中，高质感背景，突出卖点' },
    nodes: [
      {
        ref: 'product',
        type: 'image',
        title: '产品参考图',
        x: 0,
        y: 0,
        width: 260,
        height: 240,
        data: { origin: 'template' },
      },
      {
        ref: 'copy',
        type: 'prompt',
        title: '海报文案',
        x: 0,
        y: 280,
        width: 260,
        height: 160,
        data: {
          text: '主标题、副标题、卖点关键词、目标人群',
          format: 'prompt',
          origin: 'template',
        },
      },
      {
        ref: 'poster_task',
        type: 'task',
        title: '图像编辑 · 海报合成',
        x: 360,
        y: 100,
        width: 300,
        height: 152,
        data: {
          operation: 'image_edit',
          prompt: '电商主图，产品居中，高质感背景，突出卖点',
          status: 'pending',
          progress: 0,
          message: '从模板创建，上传产品图后运行',
          origin: 'template',
        },
      },
    ],
    edges: [
      { from: 'product', to: 'poster_task', type: 'used_as_input' },
      { from: 'copy', to: 'poster_task', type: 'used_as_input' },
    ],
  },
  {
    id: 'tpl.script_to_video',
    name: '镜头脚本到视频流',
    type: 'workflow',
    description: '分镜描述 → 文生视频',
    defaultParams: { prompt: '电影感镜头，自然运动，高质量画面' },
    nodes: [
      {
        ref: 'shot_desc',
        type: 'prompt',
        title: '镜头描述',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        data: {
          text: '镜头景别、运镜、场景、主体动作、氛围。例如：中景，缓慢推镜，黄昏街道，主角行走，宁静氛围。',
          format: 'prompt',
          origin: 'template',
        },
      },
      {
        ref: 'video_task',
        type: 'task',
        title: '文生视频',
        x: 380,
        y: 20,
        width: 300,
        height: 152,
        data: {
          operation: 'text_to_video',
          prompt: '电影感镜头，自然运动，高质量画面',
          status: 'pending',
          progress: 0,
          message: '从模板创建，编辑镜头描述后运行',
          origin: 'template',
        },
      },
    ],
    edges: [{ from: 'shot_desc', to: 'video_task', type: 'used_as_input' }],
  },
  {
    id: 'tpl.multi_ref_compose',
    name: '多图参考合成流',
    type: 'workflow',
    description: '多张参考图 → 合成新图',
    defaultParams: { prompt: '融合参考图的风格与元素，生成统一构图' },
    nodes: [
      {
        ref: 'ref_a',
        type: 'image',
        title: '参考图 A',
        x: 0,
        y: 0,
        width: 220,
        height: 200,
        data: { origin: 'template' },
      },
      {
        ref: 'ref_b',
        type: 'image',
        title: '参考图 B',
        x: 0,
        y: 240,
        width: 220,
        height: 200,
        data: { origin: 'template' },
      },
      {
        ref: 'compose_task',
        type: 'task',
        title: '多图合成',
        x: 320,
        y: 120,
        width: 300,
        height: 152,
        data: {
          operation: 'image_compose',
          prompt: '融合参考图的风格与元素，生成统一构图',
          status: 'pending',
          progress: 0,
          message: '从模板创建，上传参考图后运行',
          origin: 'template',
        },
      },
    ],
    edges: [
      { from: 'ref_a', to: 'compose_task', type: 'used_as_input' },
      { from: 'ref_b', to: 'compose_task', type: 'used_as_input' },
    ],
  },
  {
    id: 'tpl.blank_prompt',
    name: '空白 Prompt',
    type: 'prompt',
    description: '一个空的 Prompt 节点，快速开始',
    nodes: [
      {
        ref: 'prompt',
        type: 'prompt',
        title: 'Prompt',
        x: 0,
        y: 0,
        width: 300,
        height: 180,
        data: { text: '', format: 'prompt', origin: 'template' },
      },
    ],
  },
  {
    id: 'tpl.two_column',
    name: '双列对照布局',
    type: 'layout',
    description: '左右两个文本节点，适合对照编辑',
    nodes: [
      {
        ref: 'left',
        type: 'text',
        title: '原文',
        x: 0,
        y: 0,
        width: 280,
        height: 200,
        data: { text: '左侧内容', format: 'plain', origin: 'template' },
      },
      {
        ref: 'right',
        type: 'text',
        title: '对照',
        x: 340,
        y: 0,
        width: 280,
        height: 200,
        data: { text: '右侧内容', format: 'plain', origin: 'template' },
      },
    ],
  },
]
