// 行为日志工具元数据：工具名 → 分组 / 中文动作名 / 图标 的纯数据映射。
// 供 ChatActivitySegments（分组/摘要）与 ChatView（渲染）共用；
// 保持无 React 依赖，便于单测。

/** 行为日志分组类别（数组顺序即摘要文案的展示顺序） */
export type ToolLogGroupKind =
  | 'read'
  | 'image'
  | 'web'
  | 'browser'
  | 'media'
  | 'command'
  | 'write'
  | 'tool'

export const TOOL_LOG_GROUP_KINDS: readonly ToolLogGroupKind[] = [
  'read',
  'image',
  'web',
  'browser',
  'media',
  'command',
  'write',
  'tool',
]

/** 明细行图标 key，渲染层映射到具体图标组件 */
export type ToolLogIconKey =
  | 'terminal'
  | 'search'
  | 'edit'
  | 'file'
  | 'image'
  | 'globe'
  | 'browser'
  | 'wand'
  | 'wrench'

export function normalizeToolName(name: string): string {
  return name
    .replace(/^functions__/, '')
    .replace(/^mcp__[^_]+__/, '')
    .toLowerCase()
}

/** 图片扩展名（带点、小写）：rich-output-parsing 等渲染侧复用，保持单一数据源 */
export const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.avif',
]

/** Read 类工具读取图片文件判定（图片查看单独成组/展示动作名） */
export function isImageReadToolCall(
  name: string,
  toolInput: Record<string, unknown> | undefined,
): boolean {
  const normalized = normalizeToolName(name)
  if (normalized !== 'read' && normalized !== 'read_file') return false
  const raw = toolInput?.file_path ?? toolInput?.path
  if (typeof raw !== 'string' || raw.length === 0) return false
  const lower = raw.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

const WEB_TOOL_NAMES = new Set([
  'web_search',
  'websearch',
  'web_fetch',
  'webfetch',
  'fetch_url',
  'fetchurl',
])

function isWebTool(normalized: string): boolean {
  // server 名含下划线（mcp__spark_search__*）不会被 normalizeToolName 去前缀，需 endsWith 兜底
  return (
    WEB_TOOL_NAMES.has(normalized) || [...WEB_TOOL_NAMES].some((n) => normalized.endsWith(`__${n}`))
  )
}

/**
 * 联网搜索类工具（区别于抓取类 web 工具）：输出为搜索结果列表，
 * 可富展示来源链接（见 rich-output-parsing.getRichSourceLinks）。
 */
export function isWebSearchToolCall(name: string): boolean {
  const normalized = normalizeToolName(name)
  return (
    normalized === 'web_search' ||
    normalized === 'websearch' ||
    normalized.endsWith('__web_search') ||
    normalized.endsWith('__websearch')
  )
}

/** 截图类工具判定（playwright browser_screenshot、spark_browser 截图等），输出含图片数据/路径 */
export function isScreenshotToolCall(name: string): boolean {
  const normalized = normalizeToolName(name)
  return (
    normalized === 'browser_screenshot' ||
    normalized === 'screenshot' ||
    normalized.endsWith('__screenshot')
  )
}

function isBrowserTool(normalized: string): boolean {
  // playwright 系列 normalize 后为 browser_*；
  // spark_browser 系列（mcp__spark_browser__*）因 server 名含下划线不会被去前缀。
  return normalized.includes('browser')
}

function isMediaTool(normalized: string): boolean {
  const mediaActions = [
    'generate_image',
    'edit_image',
    'generate_video',
    'generate_audio',
    'transcribe_audio',
  ]
  return mediaActions.some((action) => normalized === action || normalized.endsWith(`__${action}`))
}

/**
 * 按工具名（及输入）归类行为日志分组。
 * 返回 null 表示该工具不展示在行为日志中（有独立卡片，刻意排除）。
 */
export function classifyToolLog(
  name: string,
  toolInput: Record<string, unknown> | undefined,
): ToolLogGroupKind | null {
  const normalized = normalizeToolName(name)
  if (
    normalized === 'todo_write' ||
    name === 'mcp__spark_team__agent_dispatch' ||
    name.endsWith('present_files')
  ) {
    return null
  }
  if (isImageReadToolCall(normalized, toolInput)) return 'image'
  if (
    normalized === 'bash' ||
    normalized === 'run_command' ||
    normalized.includes('shell') ||
    normalized.includes('terminal')
  ) {
    return 'command'
  }
  if (isWebTool(normalized)) return 'web'
  if (isBrowserTool(normalized)) return 'browser'
  if (isMediaTool(normalized)) return 'media'
  if (
    normalized === 'read' ||
    normalized === 'read_file' ||
    normalized === 'grep' ||
    normalized === 'grep_files' ||
    normalized === 'list' ||
    normalized === 'ls' ||
    normalized.includes('search')
  ) {
    return 'read'
  }
  if (
    normalized === 'edit' ||
    normalized === 'edit_file' ||
    normalized === 'write' ||
    normalized === 'write_file' ||
    normalized === 'apply_patch' ||
    normalized.includes('replace')
  ) {
    return 'write'
  }
  return 'tool'
}

/** 明细行动作名（精确匹配表，key 为 normalize 后的工具名） */
const TOOL_ACTION_EXACT: Record<string, string> = {
  read: '查看文件',
  read_file: '查看文件',
  grep: '搜索代码',
  grep_files: '搜索代码',
  glob: '匹配文件',
  list: '列出文件',
  ls: '列出文件',
  bash: '执行命令',
  run_command: '执行命令',
  edit: '编辑文件',
  edit_file: '编辑文件',
  write: '写入文件',
  write_file: '写入文件',
  apply_patch: '应用补丁',
  web_search: '联网搜索',
  websearch: '联网搜索',
  web_fetch: '抓取网页',
  webfetch: '抓取网页',
  fetch_url: '抓取网页',
  fetchurl: '抓取网页',
  task: '派发子任务',
  skill: '加载技能',
}

/** 浏览器工具动作名（key 为 normalize 后的工具名，playwright browser_* 系列） */
const BROWSER_ACTION_EXACT: Record<string, string> = {
  browser_navigate: '打开页面',
  browser_navigate_back: '返回上一页',
  browser_click: '点击元素',
  browser_type: '输入文本',
  browser_fill_form: '填写表单',
  browser_screenshot: '页面截图',
  browser_snapshot: '获取页面结构',
  browser_find: '查找元素',
  browser_hover: '悬停元素',
  browser_select_option: '选择选项',
  browser_press_key: '按键操作',
  browser_evaluate: '执行脚本',
  browser_run_code_unsafe: '执行脚本',
  browser_tabs: '管理标签页',
  browser_console_messages: '读取控制台',
  browser_network_requests: '查看网络请求',
  browser_wait_for: '等待页面',
  browser_drag: '拖拽元素',
  browser_drop: '放置元素',
  browser_file_upload: '上传文件',
  browser_handle_dialog: '处理对话框',
  browser_close: '关闭页面',
}

/** 浏览器工具动作名（按工具名末段匹配，覆盖 spark_browser 等自定义 server 名） */
const BROWSER_ACTION_BY_TAIL: Record<string, string> = {
  navigate: '打开页面',
  open: '打开窗口',
  click: '点击元素',
  type: '输入文本',
  screenshot: '页面截图',
  snapshot: '获取页面结构',
  eval: '执行脚本',
  console_events: '读取控制台',
  close: '关闭窗口',
}

/** 多媒体工具动作名（key 为去掉任意 MCP 前缀后的动作名） */
const MEDIA_ACTION_EXACT: Record<string, string> = {
  generate_image: '生成图片',
  edit_image: '编辑图片',
  generate_video: '生成视频',
  generate_audio: '生成音频',
  transcribe_audio: '语音转写',
}

/**
 * 明细行友好动作名：优先精确/分类匹配；兜底取 MCP 长名的末段（去掉
 * `mcp__server__` 前缀），再兜底原始工具名。
 */
export function getToolActionLabel(
  name: string,
  toolInput: Record<string, unknown> | undefined,
): string {
  const normalized = normalizeToolName(name)
  if (isImageReadToolCall(normalized, toolInput)) return '查看图片'

  const exact = TOOL_ACTION_EXACT[normalized]
  if (exact != null) return exact

  if (isBrowserTool(normalized)) {
    const browserExact = BROWSER_ACTION_EXACT[normalized]
    if (browserExact != null) return browserExact
    const tail = normalized.split('__').pop() ?? ''
    const byTail = BROWSER_ACTION_BY_TAIL[tail]
    if (byTail != null) return byTail
    return '浏览器操作'
  }

  const mediaTail = normalized.split('__').pop() ?? ''
  if (isMediaTool(normalized)) return MEDIA_ACTION_EXACT[mediaTail] ?? '多媒体调用'
  if (isWebTool(normalized)) return normalized.includes('fetch') ? '抓取网页' : '联网搜索'

  if (normalized.includes('search')) return '搜索'
  if (normalized.includes('replace')) return '编辑文件'

  // MCP 长名（mcp__server__tool）取末段展示，hover 仍可见完整名
  if (name.includes('__')) {
    const tail = name.split('__').pop() ?? ''
    if (tail.length > 0) return tail
  }
  return name
}

/** 明细行图标 key */
export function getToolIconKey(
  name: string,
  toolInput: Record<string, unknown> | undefined,
): ToolLogIconKey {
  const normalized = normalizeToolName(name)
  if (isImageReadToolCall(normalized, toolInput)) return 'image'
  const kind = classifyToolLog(name, toolInput)
  switch (kind) {
    case 'command':
      return 'terminal'
    case 'web':
      return 'globe'
    case 'browser':
      return 'browser'
    case 'media':
      return 'wand'
    case 'write':
      return 'edit'
    case 'tool':
      return 'wrench'
    case 'read':
    default:
      if (
        normalized === 'grep' ||
        normalized === 'grep_files' ||
        normalized === 'glob' ||
        normalized.includes('search')
      ) {
        return 'search'
      }
      return 'file'
  }
}
