import { readAssetKind, type FilmAssetKind } from './canvasFilmAssets'
import {
  CANVAS_BASE_CREATE_OPERATION_GROUPS,
  CANVAS_FUNCTIONAL_CREATE_OPERATIONS,
} from './canvasNodeGenerationMenu'
import { getNodePipelineActions } from './canvasPipeline'
import { getOp } from './canvasPipelineOps'
import type {
  CanvasAsset,
  CanvasNode,
  CanvasOperationType,
  CanvasPipelineRole,
} from './canvas.types'

export type CanvasAgentActionExecution =
  | 'tool'
  | 'create_operation_node'
  | 'requires_user_interaction'

export type CanvasAgentActionSource =
  | 'pipeline'
  | 'node_menu'
  | 'recommended_flow'
  | 'canvas_tool'

export type CanvasAgentAvailableAction = {
  id: string
  label: string
  category: 'pipeline' | 'generate' | 'edit' | 'organize' | 'inspect'
  source: CanvasAgentActionSource
  execution: CanvasAgentActionExecution
  description: string
  operation?: CanvasOperationType
  outputPipelineRole?: CanvasPipelineRole
  toolName?: string
  toolRecipe?: {
    toolName: string
    arguments: Record<string, unknown>
  }
  destructive?: boolean
  guidance?: string
}

export type CanvasAgentAvailableActionOptions = {
  assetKinds?: readonly FilmAssetKind[]
}

function operationDescription(operation: CanvasOperationType): string {
  switch (operation) {
    case 'storyboard_grid':
      return '创建故事板宫格生成节点，先在画布中检查 Prompt 与模型。'
    case 'panorama_360':
      return '创建 2:1 等距柱状投影的 360 全景图生成节点。'
    default:
      return `创建 ${operation} 操作节点并连接当前节点作为输入。`
  }
}

function pipelineActions(
  node: CanvasNode,
  assetKinds: readonly FilmAssetKind[],
): CanvasAgentAvailableAction[] {
  return getNodePipelineActions(node, {
    assetKinds: assetKinds.filter(
      (kind): kind is 'character' | 'scene' | 'prop' | 'effect' =>
        kind === 'character' || kind === 'scene' || kind === 'prop' || kind === 'effect',
    ),
  }).map((action) => {
    const definition = getOp(action.id)
    const operation = action.operation ?? (definition?.kind === 'extract' ? 'text_generate' : undefined)
    return {
      id: action.id,
      label: action.label,
      category: 'pipeline' as const,
      source: 'pipeline' as const,
      execution: 'create_operation_node' as const,
      description: `沿用节点“影视创作”能力，产出 ${action.produces} 节点。`,
      ...(operation ? { operation } : {}),
      outputPipelineRole: action.produces,
      guidance: '默认只创建待确认操作节点；用户明确要求立即生成时再运行。',
    }
  })
}

function recommendedFlowActions(node: CanvasNode): CanvasAgentAvailableAction[] {
  const role = node.data.pipelineRole
  if (role === 'screenplay') {
    return [
      {
        id: 'screenplay.extract_props',
        label: '提取关键道具',
        category: 'pipeline',
        source: 'recommended_flow',
        execution: 'create_operation_node',
        description: '从剧本提取会影响镜头生成和叙事连续性的关键道具。',
        operation: 'text_generate',
        outputPipelineRole: 'prop',
        guidance: '要求结构化 JSON 输出；落库前按同名道具去重。',
      },
      {
        id: 'screenplay.extract_effects',
        label: '提取关键特效',
        category: 'pipeline',
        source: 'recommended_flow',
        execution: 'create_operation_node',
        description: '从剧本提取需要独立视觉设计的粒子、能量、天气和环境特效。',
        operation: 'text_generate',
        outputPipelineRole: 'effect',
        guidance: '只提取影响画面生成的特效，避免把普通动作误当作特效资产。',
      },
      {
        id: 'screenplay.split_episodes',
        label: '按剧情分集',
        category: 'pipeline',
        source: 'recommended_flow',
        execution: 'create_operation_node',
        description: '把长剧本按冲突、悬念和目标时长拆成多集剧本，仍保留在当前单画布。',
        operation: 'text_generate',
        outputPipelineRole: 'screenplay',
        guidance: '每集应有集号、标题、开场钩子、主要冲突、结尾悬念和完整剧本正文。',
      },
    ]
  }
  if (role === 'scene') {
    return [
      {
        id: 'scene.panorama_360',
        label: '生成重点场景 360 全景图',
        category: 'pipeline',
        source: 'recommended_flow',
        execution: 'create_operation_node',
        description: '为高频、剧情关键或需要复杂空间调度的场景建立可环视环境基准。',
        operation: 'panorama_360',
        outputPipelineRole: 'design_card',
        guidance: '普通一次性场景不必生成；重点场景使用 2:1 equirectangular 输出。',
      },
    ]
  }
  return []
}

function generationActions(node: CanvasNode): CanvasAgentAvailableAction[] {
  const supportsGeneration = ['text', 'prompt', 'image', 'audio', 'video', 'group'].includes(node.type)
  if (!supportsGeneration) return []
  const items = [
    ...CANVAS_FUNCTIONAL_CREATE_OPERATIONS,
    ...CANVAS_BASE_CREATE_OPERATION_GROUPS.flatMap((group) => group.items),
  ]
  return items.map((item) => ({
    id: `operation.${item.operation}`,
    label: item.label,
    category: 'generate' as const,
    source: 'node_menu' as const,
    execution: 'create_operation_node' as const,
    description: operationDescription(item.operation),
    operation: item.operation,
    guidance: '先读取可用模型和参数约束，再创建并连接操作节点。',
  }))
}

function contextualUiActions(node: CanvasNode): CanvasAgentAvailableAction[] {
  const actions: CanvasAgentAvailableAction[] = []
  if (node.type === 'image' && node.data.url) {
    actions.push(
      {
        id: 'image.annotate',
        label: '图片标注',
        category: 'edit',
        source: 'node_menu',
        execution: 'requires_user_interaction',
        description:
          '打开可继续编辑的图片标注工作台，支持形状、箭头、画笔、文字、编号、马赛克、裁剪和四边白色留白。',
        guidance: '引导用户右键图片节点选择“图片标注”。',
      },
      {
        id: 'image.split_grid',
        label: '宫格切分',
        category: 'edit',
        source: 'node_menu',
        execution: 'requires_user_interaction',
        description: '把故事板或设定板按宫格拆成独立图片节点。',
        guidance: '引导用户右键图片节点选择“宫格切分”，再选择需要保留的格子。',
      },
    )
  }
  if (node.type === 'image' && node.data.panorama360) {
    actions.push({
      id: 'image.preview_panorama',
      label: '全景预览',
      category: 'inspect',
      source: 'node_menu',
      execution: 'requires_user_interaction',
      description: '在沉浸式 3D 视图中检查 360 全景图并可截图回插画布。',
      guidance: '引导用户右键全景图片节点选择“全景预览”。',
    })
  }
  if (node.type === 'video' || node.data.subtype === 'video_workbench') {
    actions.push({
      id: 'video.edit',
      label: '视频编辑',
      category: 'edit',
      source: 'node_menu',
      execution: 'requires_user_interaction',
      description: '打开视频工作台继续剪辑、扩展或处理视频。',
      guidance: '引导用户右键视频节点选择“视频编辑”。',
    })
  }
  return actions
}

function groupActions(node: CanvasNode): CanvasAgentAvailableAction[] {
  const actions: CanvasAgentAvailableAction[] = []
  if (node.type === 'group') {
    actions.push(
      {
        id: 'group.merge_to_image',
        label: '多图合并',
        category: 'edit',
        source: 'node_menu',
        execution: 'requires_user_interaction',
        description: '把组内多张图片按当前布局合并为新的图片节点。',
        guidance: '引导用户右键组节点选择“多图合并”，检查构图后再生成。',
      },
      {
        id: 'group.dissolve',
        label: '解散组',
        category: 'organize',
        source: 'node_menu',
        execution: 'tool',
        description: '解散当前组并恢复成员节点的独立位置。执行前必须获得用户确认。',
        toolName: 'canvas_dissolve_group',
        toolRecipe: {
          toolName: 'canvas_dissolve_group',
          arguments: { groupId: node.id },
        },
        destructive: true,
      },
    )
  }
  if (node.parentNodeId) {
    actions.push({
      id: 'group.remove_node',
      label: '移出组',
      category: 'organize',
      source: 'node_menu',
      execution: 'tool',
      description: '把当前节点移出所属分组，保留节点内容。',
      toolName: 'canvas_remove_from_group',
      toolRecipe: {
        toolName: 'canvas_remove_from_group',
        arguments: { nodeIds: [node.id] },
      },
    })
  }
  return actions
}

function commonToolActions(node: CanvasNode): CanvasAgentAvailableAction[] {
  return [
    {
      id: 'node.inspect',
      label: '读取节点详情',
      category: 'inspect',
      source: 'canvas_tool',
      execution: 'tool',
      description: '读取节点完整数据、流水线角色和生产状态。',
      toolName: 'canvas_get_node',
    },
    {
      id: 'node.duplicate',
      label: '复制节点',
      category: 'organize',
      source: 'node_menu',
      execution: 'tool',
      description: '复制节点并保留可复用的数据结构。',
      toolName: 'canvas_duplicate_nodes',
      toolRecipe: {
        toolName: 'canvas_duplicate_nodes',
        arguments: { nodeIds: [node.id] },
      },
    },
    {
      id: 'node.edit',
      label: '编辑节点',
      category: 'edit',
      source: 'node_menu',
      execution: 'requires_user_interaction',
      description: '打开内容编辑器或操作节点配置面板。',
      guidance: '引导用户双击节点或右键选择“编辑节点”。',
    },
    {
      id: 'node.update',
      label: '更新节点',
      category: 'edit',
      source: 'canvas_tool',
      execution: 'tool',
      description: '更新节点内容、流水线角色、生产状态或生成配置。',
      toolName: 'canvas_update_node',
    },
    {
      id: 'node.save_to_library',
      label: '保存到资源库',
      category: 'organize',
      source: 'node_menu',
      execution: 'requires_user_interaction',
      description: '把当前节点内容保存为可复用的项目资源。',
      guidance: '引导用户右键节点选择“保存到资源库”，再确认资源类型和名称。',
    },
    {
      id: 'node.add_to_agent',
      label: '添加到 Agent 对话',
      category: 'inspect',
      source: 'node_menu',
      execution: 'requires_user_interaction',
      description: '把节点加入画布 Agent 的显式引用列表，后续消息会携带节点 id 和摘要。',
      guidance: '引导用户右键节点选择“添加到 Agent 对话”。',
    },
    {
      id: 'node.lock',
      label: node.locked ? '解锁节点' : '锁定节点',
      category: 'organize',
      source: 'node_menu',
      execution: 'tool',
      description: node.locked ? '解除节点位置锁定。' : '锁定节点，避免整理画布时误移动。',
      toolName: 'canvas_patch_nodes',
      toolRecipe: {
        toolName: 'canvas_patch_nodes',
        arguments: { nodeIds: [node.id], patch: { locked: !node.locked } },
      },
    },
    {
      id: 'node.bring_to_front',
      label: '置于顶层',
      category: 'organize',
      source: 'node_menu',
      execution: 'tool',
      description: '把节点提高到当前画布最上层。',
      toolName: 'canvas_bring_to_front',
      toolRecipe: {
        toolName: 'canvas_bring_to_front',
        arguments: { nodeIds: [node.id] },
      },
    },
    {
      id: 'node.send_to_back',
      label: '置于底层',
      category: 'organize',
      source: 'canvas_tool',
      execution: 'tool',
      description: '把节点降低到当前画布最底层。',
      toolName: 'canvas_send_to_back',
      toolRecipe: {
        toolName: 'canvas_send_to_back',
        arguments: { nodeIds: [node.id] },
      },
    },
    {
      id: 'node.delete',
      label: '删除节点',
      category: 'organize',
      source: 'node_menu',
      execution: 'tool',
      description: '软删除当前节点。执行前必须获得用户确认。',
      toolName: 'canvas_delete_nodes',
      destructive: true,
    },
  ]
}

export function getCanvasAgentAvailableActions(
  node: CanvasNode,
  options: CanvasAgentAvailableActionOptions = {},
): CanvasAgentAvailableAction[] {
  const assetKinds = options.assetKinds ?? []
  const actions = [
    ...pipelineActions(node, assetKinds),
    ...recommendedFlowActions(node),
    ...generationActions(node),
    ...contextualUiActions(node),
    ...groupActions(node),
    ...commonToolActions(node),
  ].map((action): CanvasAgentAvailableAction => {
    if (action.execution !== 'create_operation_node' || !action.operation) return action
    return {
      ...action,
      toolRecipe: {
        toolName: 'canvas_create_operation_node',
        arguments: {
          operation: action.operation,
          inputNodeIds: [node.id],
          title: action.label,
          ...(action.outputPipelineRole
            ? { outputPipelineRole: action.outputPipelineRole }
            : {}),
        },
      },
    }
  })
  const seen = new Set<string>()
  return actions.filter((action) => {
    if (seen.has(action.id)) return false
    seen.add(action.id)
    return true
  })
}

export function resolveNodeAssetKinds(node: CanvasNode, assets: readonly CanvasAsset[]): FilmAssetKind[] {
  const asset = node.assetId ? assets.find((item) => item.id === node.assetId) : undefined
  const kind = asset ? readAssetKind(asset) : null
  return kind ? [kind] : []
}
