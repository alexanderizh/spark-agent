import type { UIBlock } from '../services/event-mapper'

export type ChatPanelToolBlock = Extract<UIBlock, { kind: 'tool_call' }>

const CANVAS_TOOL_LABELS: Record<string, string> = {
  canvas_get_project_summary: '读取画布摘要',
  canvas_get_available_actions: '读取可用动作',
  canvas_get_production_plan: '读取制作计划',
  canvas_list_nodes: '读取节点列表',
  canvas_get_node: '读取节点详情',
  canvas_find_nodes: '查找节点',
  canvas_query_nodes: '查询节点',
  canvas_list_group_members: '读取分组成员',
  canvas_create_text_node: '创建文本节点',
  canvas_create_prompt_node: '创建 Prompt 节点',
  canvas_update_node: '更新节点',
  canvas_update_node_data: '更新节点内容',
  canvas_patch_nodes: '更新节点属性',
  canvas_delete_nodes: '删除节点',
  canvas_duplicate_nodes: '复制节点',
  canvas_connect_nodes: '连接节点',
  canvas_create_group: '创建分组',
  canvas_dissolve_group: '解散分组',
  canvas_add_to_group: '加入分组',
  canvas_remove_from_group: '移出分组',
  canvas_list_assets: '读取资产列表',
  canvas_get_asset: '读取资产详情',
  canvas_search_assets: '搜索资产',
  canvas_insert_asset: '插入资产',
  canvas_create_film_asset: '创建影视资产',
  canvas_update_film_asset: '更新影视资产',
  canvas_delete_film_asset: '删除影视资产',
  canvas_create_operation_node: '创建操作节点',
  canvas_run_operation: '运行画布操作',
  canvas_retry_operation: '重试画布操作',
  canvas_cancel_task: '取消画布任务',
  canvas_list_tasks: '读取任务列表',
  canvas_list_media_models: '读取媒体模型',
  canvas_list_shot_groups: '读取镜头组',
  canvas_create_shot_group: '创建镜头组',
  canvas_update_shot_group: '更新镜头组',
  canvas_delete_shot_group: '删除镜头组',
  canvas_create_shot_segment: '创建镜头片段',
  canvas_update_shot_segment: '更新镜头片段',
  canvas_delete_shot_segment: '删除镜头片段',
  canvas_insert_generated_image: '插入生成图片',
  canvas_insert_generated_text: '插入生成文本',
  canvas_batch_create_nodes: '批量创建节点',
  canvas_align_nodes: '对齐节点',
  canvas_distribute_nodes: '分布节点',
  canvas_bring_to_front: '置于顶层',
  canvas_send_to_back: '置于底层',
  canvas_update_model_param: '更新模型参数',
  canvas_update_project_settings: '更新项目设置',
}

const READONLY_CANVAS_TOOLS = new Set([
  'canvas_get_project_summary',
  'canvas_get_available_actions',
  'canvas_get_production_plan',
  'canvas_get_node',
  'canvas_get_operation_config',
  'canvas_get_asset',
  'canvas_list_nodes',
  'canvas_list_group_members',
  'canvas_list_assets',
  'canvas_list_capabilities',
  'canvas_list_media_models',
  'canvas_list_shot_groups',
  'canvas_list_tasks',
  'canvas_find_nodes',
  'canvas_search_assets',
  'canvas_query_nodes',
])

export function getChatPanelToolBlocks(
  blocks: UIBlock[],
  toolNamePrefix?: string,
): ChatPanelToolBlock[] {
  return blocks.filter(
    (block): block is ChatPanelToolBlock =>
      block.kind === 'tool_call' &&
      (toolNamePrefix == null || block.toolName.startsWith(toolNamePrefix)),
  )
}

export function getChatPanelToolLabel(toolName: string): string {
  const shortName = toolName.replace(/^mcp__spark_canvas__/, '')
  return (
    CANVAS_TOOL_LABELS[shortName] ??
    shortName
      .replace(/^canvas_/, '')
      .split('_')
      .filter(Boolean)
      .join(' ')
  )
}

export function isCanvasMutationTool(toolName: string): boolean {
  const shortName = toolName.replace(/^mcp__spark_canvas__/, '')
  return shortName.startsWith('canvas_') && !READONLY_CANVAS_TOOLS.has(shortName)
}

export function extractCanvasNodeIds(block: ChatPanelToolBlock): string[] {
  const ids = new Set<string>()
  collectNodeIds(block.toolInput, ids)
  if (block.output && block.output.length <= 100_000) {
    try {
      collectNodeIds(JSON.parse(block.output), ids)
    } catch {
      // 非 JSON 工具结果无需提取定位信息。
    }
  }
  return [...ids].slice(0, 8)
}

function collectNodeIds(value: unknown, ids: Set<string>, key = '', depth = 0): void {
  if (depth > 5 || ids.size >= 8 || value == null) return
  if (typeof value === 'string') {
    if (/nodeids?$/i.test(key) && value.trim().length > 0) ids.add(value.trim())
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNodeIds(item, ids, key, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    collectNodeIds(childValue, ids, childKey, depth + 1)
  }
}
