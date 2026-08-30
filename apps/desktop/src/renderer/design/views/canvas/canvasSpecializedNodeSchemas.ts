type JSONSchema = Record<string, unknown>

const stringField = (description: string): JSONSchema => ({ type: 'string', description })
const numberField = (description: string): JSONSchema => ({ type: 'number', description })
const stringArray = (description: string): JSONSchema => ({
  type: 'array',
  items: { type: 'string' },
  description,
})

export const STORYBOARD_SHOT_SCHEMA: JSONSchema = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    index: numberField('镜号；省略时按数组顺序从 1 编号'),
    groupName: stringField('分镜分组/场次名称'),
    title: stringField('镜头标题'),
    durationSec: numberField('镜头时长（秒）'),
    shotSize: stringField('景别，如远景/全景/中景/近景/特写'),
    angle: stringField('拍摄角度，如平视/俯拍/仰拍/过肩'),
    movement: stringField('运镜及起止变化'),
    sceneName: stringField('项目内场景资产名称'),
    sceneLayout: stringField('前景/中景/背景和空间布局'),
    composition: stringField('九宫格落点、视觉中心、画面分割与前中后景层次'),
    blocking: stringField('人物站位、朝向和走位'),
    lighting: stringField('光源方向、类型、色温和阴影'),
    focalLength: stringField('焦距/焦段，如 35mm'),
    aperture: stringField('光圈与景深，如 f/2.8 浅景深'),
    iso: stringField('感光度与颗粒，如 ISO 800'),
    colorTone: stringField('主色、强调色和冷暖关系'),
    mood: stringField('氛围与情绪基调'),
    performance: stringField('微表情和表演动作'),
    costume: stringField('服装与造型连续性'),
    description: stringField('画面和动作的客观描述'),
    dialogue: stringField('带说话人的对白'),
    narration: stringField('旁白或字幕'),
    characterNames: stringArray('项目内角色资产名称'),
    characterReferences: stringField('角色图/资产参考和本镜造型状态'),
    actionBeats: stringField('0.5s 精度的完整动作节拍'),
    soundEffects: stringField('环境声、拟音、音乐与时码'),
    transition: stringField('入镜/出镜的硬切或其他剪辑标识'),
    firstFrame: stringField('0.0s 首帧精确描述'),
    lastFrame: stringField('镜头末尾帧精确描述'),
    continuity: stringField('轴线、视线、道具、造型、光向与动作接点'),
    shotPrompt: stringField('自包含的镜头生成提示词'),
    negativePrompt: stringField('该镜专属反向提示词'),
  },
}

const sourceProperties = {
  sourceNodeIds: stringArray('来源节点 id；创建后写入 references 连线'),
  x: numberField('画布坐标 x（可选）'),
  y: numberField('画布坐标 y（可选）'),
}

export const SPECIALIZED_NODE_SCHEMAS = {
  content: {
    type: 'object',
    required: ['title', 'text'],
    additionalProperties: false,
    properties: {
      title: stringField('节点和影视资产标题'),
      text: stringField('符合对应节点现有格式的正文'),
      ...sourceProperties,
    },
  },
  filmEntity: {
    type: 'object',
    required: ['name', 'description'],
    additionalProperties: false,
    properties: {
      name: stringField('影视资产和节点名称'),
      description: stringField('完整可观察描述'),
      prompt: stringField('后续图像/视频生成提示词'),
      attributes: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: '对应角色/场景/道具/特效的结构化属性',
      },
      tags: stringArray('资产标签'),
      ...sourceProperties,
    },
  },
  storyboard: {
    type: 'object',
    required: ['title', 'shots'],
    additionalProperties: false,
    properties: {
      title: stringField('分镜脚本节点标题和默认分组名'),
      shots: { type: 'array', minItems: 1, items: STORYBOARD_SHOT_SCHEMA },
      ...sourceProperties,
    },
  },
  shot: {
    type: 'object',
    required: ['groupId', 'shot'],
    additionalProperties: false,
    properties: {
      groupId: stringField('目标分镜分组 id'),
      shot: STORYBOARD_SHOT_SCHEMA,
      ...sourceProperties,
    },
  },
  media: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nodeId: stringField('已在画布上的媒体节点 id'),
      assetId: stringField('尚未插入画布的项目媒体资产 id'),
      title: stringField('节点标题（可选）'),
      shotGroupId: stringField('关联分镜分组 id（关键帧/视频）'),
      shotSegmentId: stringField('关联分镜片段 id（关键帧/视频）'),
      ...sourceProperties,
    },
  },
  pipelineOperation: {
    type: 'object',
    required: ['actionId', 'sourceNodeId'],
    additionalProperties: false,
    properties: {
      actionId: stringField('现有画布流水线动作 id'),
      sourceNodeId: stringField('作为操作输入的画布节点 id'),
      maxClipSec: numberField('生成分镜时每镜最长秒数'),
      x: numberField('操作节点坐标 x（可选）'),
      y: numberField('操作节点坐标 y（可选）'),
    },
  },
} as const satisfies Record<string, JSONSchema>
