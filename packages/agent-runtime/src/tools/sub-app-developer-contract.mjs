import { createHash } from 'node:crypto'

export const SUB_APP_DEVELOPER_CONTRACT_VERSION = 1
export const SUB_APP_RUNTIME_PROTOCOL_VERSION = 1
export const SUB_APP_PACKAGE_SCHEMA_VERSION = 1
export const SUB_APP_SOURCE_HARD_LIMIT = 5_000_000

export const SUB_APP_SURFACE_CONTRACTS = [
  {
    id: 'content',
    summary: '主内容区 iframe，适合完整页面和长内容。',
    lifecycle: '跟随当前内容视图；离开或卸载视图后页面脚本与监听全部终止。',
    layout: '允许应用自行使用居中窄栏或全宽布局；宿主不强制根节点铺满。',
    background: '默认保持透明并使用宿主主题 token。',
  },
  {
    id: 'panel',
    summary: '统一侧面板中的子应用页签，适合辅助工具。',
    lifecycle: '跟随侧面板实例。',
    layout: '宿主强制根节点铺满并清除顶部 padding；应用必须处理窄宽度和纵向滚动。',
    background: '默认保持透明并使用宿主主题 token。',
  },
  {
    id: 'overlay',
    summary: '透明悬浮层，适合轻量常驻控件。',
    lifecycle: '跟随悬浮层实例。',
    layout: '宿主强制根节点铺满。',
    background: '悬浮容器透明；应用根容器必须显式使用 --spark-color-bg-container 等主题背景。',
  },
  {
    id: 'global-window',
    summary: '独立子应用窗口。',
    lifecycle: '窗口关闭时页面脚本与监听终止。',
    layout: '宿主强制根节点铺满；应用自行处理窗口缩放。',
    background: '使用宿主主题 token。',
  },
  {
    id: 'desktop-pet',
    summary: '桌面宠物小窗口。',
    lifecycle: '窗口关闭时页面脚本与监听终止。',
    layout: '宿主强制根节点铺满；只适合紧凑交互。',
    background: '按视觉需求使用透明背景或宿主主题 token。',
  },
]

const COMMON_BRIDGE_ERRORS = [
  'PROTOCOL_VERSION_MISMATCH',
  'IDENTITY_MISMATCH',
  'PERMISSION_DENIED',
  'INVALID_PAYLOAD',
  'UNSUPPORTED_OPERATION',
  'CAPABILITY_NOT_IMPLEMENTED',
  'RATE_LIMITED',
  'UNKNOWN',
]

export const SUB_APP_SDK_CONTRACTS = [
  entry(
    'sparkApp.runtime.getInfo',
    'runtime-sdk',
    'runtime',
    'sparkApp.runtime.getInfo(): Promise<SparkAppRuntimeInfo>',
    '读取 appId、surface、版本、运行模式和权限等只读运行信息。',
    {
      example: 'const info = await sparkApp.runtime.getInfo()',
    },
  ),
  entry(
    'sparkApp.theme.get',
    'theme',
    'theme',
    'sparkApp.theme.get(): Promise<SparkAppThemeState>',
    '读取当前宿主主题和语义 token。',
    {
      example: 'const theme = await sparkApp.theme.get()',
    },
  ),
  entry(
    'sparkApp.theme.current',
    'theme',
    'theme',
    'sparkApp.theme.current(): SparkAppThemeState | null',
    '同步读取 bootstrap 最近收到的主题；首次推送前可能为 null。',
  ),
  entry(
    'sparkApp.theme.onChange',
    'theme',
    'theme',
    'sparkApp.theme.onChange(listener): () => void',
    '监听宿主主题变化；返回同步取消函数。',
    {
      example: 'const off = sparkApp.theme.onChange(renderTheme)\n// 卸载时调用 off()。',
    },
  ),
  entry(
    'sparkApp.data.get',
    'data',
    'data',
    'sparkApp.data.get(namespace, key): Promise<SubAppDataRecord | null>',
    '读取应用隔离 JSON KV 和 revision。',
    {
      limits: ['单值 JSON 序列化后最多 512 KB。'],
    },
  ),
  entry(
    'sparkApp.data.list',
    'data',
    'data',
    'sparkApp.data.list(namespace, { prefix?, limit?, offset? }): Promise<{ items, total }>',
    '分页列出应用隔离数据。',
  ),
  entry(
    'sparkApp.data.upsert',
    'data',
    'data',
    'sparkApp.data.upsert(namespace, key, value, expectedRevision?): Promise<SubAppDataRecord>',
    '创建或更新 JSON KV；更新时建议传当前 revision 做乐观并发控制。',
    {
      example:
        "const current = await sparkApp.data.get('app', 'todos')\nawait sparkApp.data.upsert('app', 'todos', next, current?.revision)",
    },
  ),
  entry(
    'sparkApp.data.delete',
    'data',
    'data',
    'sparkApp.data.delete(namespace, key, expectedRevision): Promise<{ deleted: true }>',
    '按当前 revision 删除数据，revision 必填。',
  ),
  entry(
    'sparkApp.ui.toast',
    'runtime-sdk',
    'ui',
    'sparkApp.ui.toast(content, type?): Promise<null>',
    '显示宿主通知；type 为 info、success、warning 或 error。',
  ),
  entry(
    'sparkApp.navigation.openApp',
    'runtime-sdk',
    'navigation',
    'sparkApp.navigation.openApp(appId): Promise<null>',
    '打开另一个已注册子应用。',
  ),
  entry(
    'sparkApp.navigation.openView',
    'runtime-sdk',
    'navigation',
    'sparkApp.navigation.openView(view): Promise<null>',
    '打开宿主允许的视图。',
    {
      limits: ['当前允许 canvas、board、workflows、scheduled-tasks、sub-apps。'],
    },
  ),
  entry(
    'sparkApp.files.read',
    'files',
    'files',
    'sparkApp.files.read(path): Promise<{ content, byteLength, updatedAt }>',
    '读取应用隔离目录中的 UTF-8 文本文件。',
    {
      limits: ['路径必须是应用目录内正斜杠相对路径。', '单文件最多 2 MB。'],
    },
  ),
  entry(
    'sparkApp.files.write',
    'files',
    'files',
    'sparkApp.files.write(path, content): Promise<{ byteLength, updatedAt }>',
    '写入应用隔离目录中的 UTF-8 文本文件。',
    {
      limits: ['单文件最多 2 MB。'],
    },
  ),
  entry(
    'sparkApp.files.list',
    'files',
    'files',
    'sparkApp.files.list(prefix?): Promise<{ files }>',
    '列出应用隔离文件。',
    {
      limits: ['当前最多返回 500 个文件。'],
    },
  ),
  entry(
    'sparkApp.files.delete',
    'files',
    'files',
    'sparkApp.files.delete(path): Promise<{ deleted: true }>',
    '删除应用隔离文本文件。',
  ),
  entry(
    'sparkApp.agent.send',
    'agent',
    'agent',
    'sparkApp.agent.send(prompt, { newSession? }): Promise<unknown>',
    '把请求交给宿主 Agent；返回结构由宿主实现决定。',
  ),
  entry(
    'sparkApp.media.generate',
    'media',
    'media',
    'sparkApp.media.generate({ operation, prompt, negativePrompt?, modelId? }): Promise<MediaTask>',
    '创建文生图或文生视频任务。',
    {
      limits: ['operation 当前只支持 text_to_image、text_to_video。'],
    },
  ),
  entry(
    'sparkApp.media.get',
    'media',
    'media',
    'sparkApp.media.get(taskId): Promise<MediaTask>',
    '查询媒体任务。',
  ),
  entry(
    'sparkApp.canvas.listProjects',
    'canvas',
    'canvas',
    'sparkApp.canvas.listProjects(): Promise<unknown>',
    '列出可用画布项目。',
  ),
  entry(
    'sparkApp.canvas.appendText',
    'canvas',
    'canvas',
    'sparkApp.canvas.appendText(projectId, text, { boardId? }): Promise<unknown>',
    '向画布追加文本节点。',
  ),
  entry(
    'sparkApp.browser.openUrl',
    'browser',
    'browser',
    'sparkApp.browser.openUrl(url): Promise<{ opened: true }>',
    '使用系统外部浏览器打开 HTTP(S) URL。',
  ),
  entry(
    'sparkApp.browser.open',
    'browser',
    'browser',
    'sparkApp.browser.open(url, { profileId?, reuse?, show?, backend? }): Promise<BrowserWindowInfo>',
    '打开或复用 SparkWork 内置浏览器。',
  ),
  entry(
    'sparkApp.browser.inspectMedia',
    'browser',
    'browser',
    'sparkApp.browser.inspectMedia(windowId): Promise<BrowserMediaInspection>',
    '读取页面媒体节点和已记录的媒体请求。',
  ),
  entry(
    'sparkApp.browser.download',
    'browser',
    'browser',
    'sparkApp.browser.download(windowId, url, filename?): Promise<BrowserDownload>',
    '下载 inspectMedia 返回的 HTTP(S) 媒体地址并沿用浏览器会话。',
  ),
  entry(
    'sparkApp.browser.close',
    'browser',
    'browser',
    'sparkApp.browser.close(windowId): Promise<unknown>',
    '关闭由子应用打开的内置浏览器窗口。',
  ),
  entry(
    'sparkApp.browser.openDownload',
    'browser',
    'browser',
    'sparkApp.browser.openDownload(filePath): Promise<unknown>',
    '用系统默认应用打开已下载文件。',
  ),
  entry(
    'sparkApp.browser.openDownloadFolder',
    'browser',
    'browser',
    'sparkApp.browser.openDownloadFolder(): Promise<unknown>',
    '打开 SparkWork 下载目录。',
  ),
  entry(
    'sparkApp.browser.revealDownload',
    'browser',
    'browser',
    'sparkApp.browser.revealDownload(filePath): Promise<unknown>',
    '在文件管理器中定位已下载文件。',
  ),
  entry(
    'sparkApp.browser.previewDownload',
    'browser',
    'browser',
    'sparkApp.browser.previewDownload(filePath): Promise<unknown>',
    '在宿主中预览已下载文件。',
  ),
  entry(
    'sparkApp.ipc.invoke',
    'security',
    'ipc',
    'sparkApp.ipc.invoke(channel, request): Promise<unknown>',
    'V1 可信内部应用的原始 IPC 转发。参数契约不能从 channel 名推断。',
    {
      status: 'legacy',
      alternatives: ['优先使用已类型化的 sparkApp 能力；需要平台新增稳定能力时扩展 Bridge 路由。'],
    },
  ),
  entry(
    'sparkApp.ipc.on',
    'security',
    'ipc',
    'sparkApp.ipc.on(streamChannel, listener): Promise<() => Promise<unknown>>',
    'V1 可信内部应用的原始 stream 订阅。',
    {
      status: 'legacy',
      limits: ['stream channel 必须以 stream: 开头。', '卸载时必须调用异步取消函数。'],
    },
  ),
  entry(
    'sparkApp.platform.ipc',
    'security',
    'ipc',
    'sparkApp.platform.ipc: typeof sparkApp.ipc',
    'sparkApp.ipc 的 legacy 对象别名。',
    { status: 'legacy' },
  ),
  entry(
    'sparkApp.platform.invoke',
    'security',
    'ipc',
    'sparkApp.platform.invoke(channel, request): Promise<unknown>',
    'sparkApp.ipc.invoke 的 legacy 别名。',
    { status: 'legacy' },
  ),
  entry(
    'sparkApp.platform.on',
    'security',
    'ipc',
    'sparkApp.platform.on(streamChannel, listener): Promise<() => Promise<unknown>>',
    'sparkApp.ipc.on 的 legacy 别名。',
    { status: 'legacy' },
  ),
  entry(
    'sparkApp.platform.trusted',
    'security',
    'ipc',
    'sparkApp.platform.trusted: boolean',
    '当前实例是否按 V1 可信内部应用运行。只读 legacy 标记，不能由应用修改。',
    { status: 'legacy' },
  ),
  reservedEntry(
    'sparkApp.clipboard',
    'runtime-sdk',
    'clipboard',
    '能力名已保留，但当前没有 SDK 与 Bridge 路由。',
  ),
  reservedEntry(
    'sparkApp.notifications',
    'runtime-sdk',
    'notifications',
    '能力名已保留，但当前没有 SDK 与 Bridge 路由。',
  ),
  entry(
    'sparkApp.network.request',
    'network',
    'network',
    'sparkApp.network.request({ slot, method?, path, headers?, body?, timeoutMs? }): Promise<ManagedResponse>',
    '通过已绑定的 Connection 发起受管请求；密钥由宿主注入，不返回子应用。',
  ),
  entry(
    'sparkApp.provider.request',
    'provider',
    'provider',
    'sparkApp.provider.request({ slot, method?, path, headers?, body?, timeoutMs? }): Promise<ManagedResponse>',
    '使用 provider-profile 连接绑定的受管请求，共用 network 的 SSRF、origin、重定向和容量治理。',
  ),
  entry(
    'sparkApp.backend.invoke',
    'backend',
    'backend',
    'sparkApp.backend.invoke(action, input?, { timeoutMs? }): Promise<{ output, durationMs }>',
    '调用与当前 V2 release 原子发布的受管 Node 后台服务。',
  ),
  entry(
    'sparkApp.backend.status',
    'backend',
    'backend',
    'sparkApp.backend.status(): Promise<SubAppServiceStatus>',
    '查询当前应用后台服务的运行、降级、崩溃或停止状态。',
  ),
  entry(
    'sparkApp.backend.on',
    'backend',
    'backend',
    'sparkApp.backend.on(event, listener): Promise<() => Promise<{ unsubscribed }>>',
    '订阅后台 service context.emit(event, payload) 发出的当前应用事件。',
  ),
  entry(
    'sparkApp.jobs.create',
    'jobs',
    'jobs',
    'sparkApp.jobs.create(type, input?): Promise<Job>',
    '创建固定到当前 release 的持久任务。',
  ),
  entry(
    'sparkApp.jobs.get',
    'jobs',
    'jobs',
    'sparkApp.jobs.get(jobId): Promise<Job>',
    '查询状态、进度、checkpoint、结果和错误。',
  ),
  entry(
    'sparkApp.jobs.list',
    'jobs',
    'jobs',
    'sparkApp.jobs.list({ status?, limit?, offset? }): Promise<{ items, total }>',
    '分页查询当前应用的持久任务。',
  ),
  entry(
    'sparkApp.jobs.cancel',
    'jobs',
    'jobs',
    'sparkApp.jobs.cancel(jobId): Promise<Job>',
    '请求取消排队中或运行中任务；终态任务幂等返回。',
  ),
  entry(
    'sparkApp.jobs.onProgress',
    'jobs',
    'jobs',
    'sparkApp.jobs.onProgress(jobId, listener): Promise<() => Promise<{ unsubscribed }>>',
    '订阅当前应用指定 job 的状态、进度、checkpoint 与终态更新。',
  ),
]

export const SUB_APP_GUIDE_TOPICS = {
  overview: {
    summary:
      '先确认应用属于纯前端、受管请求、后台服务还是持久任务；新应用优先使用 V2 受管项目，V1 继续兼容。',
    keywords: ['页面关闭后继续', '后台运行', '如何选择能力'],
    guidance: [
      '复杂应用先查询相关 topic/symbol，再写源码并调用 spark_app_validate。',
      'iframe 卸载后页面逻辑终止；需要页面外常驻或长任务时使用 V2 backend/jobs，不要用未记录 IPC 猜接口。',
      '保存草稿、静态校验、真实运行诊断、发布是不同完成状态。',
    ],
  },
  surfaces: { summary: '各展示面的布局、背景与页面生命周期。' },
  'runtime-sdk': { summary: '运行信息、UI、导航及能力可用状态。' },
  theme: { summary: '宿主主题状态和 --spark-* CSS 变量。' },
  data: { summary: '应用隔离 JSON KV、容量和 revision 并发控制。' },
  files: { summary: '应用隔离 UTF-8 文本文件空间。' },
  network: { summary: '直接 fetch 的现状和设计中的受管连接请求。' },
  provider: { summary: 'Provider 调用与密钥隔离；明文密钥 IPC 仅属 legacy。' },
  backend: { summary: 'V2 受管 Node.js 后台服务、生命周期、健康与日志。' },
  jobs: { summary: 'V2 持久后台任务、进度、取消与 release pinning。' },
  agent: { summary: '从子应用调用宿主 Agent。' },
  media: { summary: '创建和查询文本生成媒体任务。' },
  canvas: { summary: '列出画布项目并追加文本。' },
  browser: { summary: '内置浏览器、媒体发现与下载。' },
  security: { summary: 'iframe CSP、legacy raw IPC、凭据和源码边界。' },
  lifecycle: {
    summary: 'iframe、发布版本以及设计中 service/job 的生命周期。',
    keywords: ['页面关闭后继续', '关闭页面', '常驻后台', '重启恢复'],
    guidance: [
      '当前 V1 页面关闭后 iframe、脚本和监听都会终止。',
      'V2 backend/jobs 可在页面关闭后继续执行；V1 单 HTML 应用仍然与 iframe 同生命周期。',
    ],
  },
  publishing: { summary: '草稿 CAS、发布快照、回滚和 V1 兼容。' },
  troubleshooting: { summary: '白屏、CSP、Bridge 超时、权限和资源加载排查。' },
  recipes: { summary: '按常见目标选择稳定能力的最小配方。' },
}

const CONTRACT_BODY = {
  contractVersion: SUB_APP_DEVELOPER_CONTRACT_VERSION,
  runtimeProtocolVersion: SUB_APP_RUNTIME_PROTOCOL_VERSION,
  packageSchemaVersion: SUB_APP_PACKAGE_SCHEMA_VERSION,
  topics: SUB_APP_GUIDE_TOPICS,
  surfaces: SUB_APP_SURFACE_CONTRACTS,
  sdk: SUB_APP_SDK_CONTRACTS,
}

export const SUB_APP_DEVELOPER_CONTRACT_DIGEST = createHash('sha256')
  .update(JSON.stringify(CONTRACT_BODY), 'utf8')
  .digest('hex')

export const IMPLEMENTED_SPARK_APP_SYMBOLS = new Set(
  SUB_APP_SDK_CONTRACTS.filter(
    (item) => item.status === 'implemented' || item.status === 'legacy',
  ).map((item) => item.symbol),
)

export const RESERVED_SPARK_APP_SYMBOLS = new Set(
  SUB_APP_SDK_CONTRACTS.filter((item) => item.status === 'reserved').map((item) => item.symbol),
)

export function querySubAppDeveloperGuide(request = {}) {
  const includeExamples = request.includeExamples !== false
  const topic = typeof request.topic === 'string' ? request.topic.trim() : ''
  const symbol = typeof request.symbol === 'string' ? request.symbol.trim() : ''
  const surface = typeof request.surface === 'string' ? request.surface.trim() : ''
  const query = typeof request.query === 'string' ? request.query.trim().toLocaleLowerCase() : ''
  const navigation = Object.entries(SUB_APP_GUIDE_TOPICS).map(([id, value]) => ({
    id,
    summary: value.summary,
  }))

  if (!topic && !symbol && !surface && !query) {
    return {
      versions: versions(),
      navigation,
      workflow: ['guide', 'edit/scaffold', 'validate', 'diagnose', 'publish'],
      note: '请传 topic、symbol、surface 或 query 按需查询；无参数只返回目录，避免把整本手册注入上下文。',
    }
  }

  const normalizedSymbol = symbol.toLocaleLowerCase()
  const words = query.split(/\s+/u).filter(Boolean)
  const matchedTopics = Object.entries(SUB_APP_GUIDE_TOPICS)
    .filter(([id, value]) => {
      if (topic && id !== topic) return false
      if (words.length === 0) return topic.length > 0
      const haystack = JSON.stringify({ id, ...value }).toLocaleLowerCase()
      return words.every((word) => haystack.includes(word))
    })
    .map(([id, value]) => ({ id, ...value }))
  let entries = SUB_APP_SDK_CONTRACTS.filter((item) => {
    if (topic && item.topic !== topic) return false
    if (normalizedSymbol && item.symbol.toLocaleLowerCase() !== normalizedSymbol) return false
    if (words.length > 0) {
      const haystack = JSON.stringify(item).toLocaleLowerCase()
      if (!words.every((word) => haystack.includes(word))) return false
    }
    return true
  })
  if (!includeExamples) {
    entries = entries.map((item) => {
      const withoutExample = { ...item }
      delete withoutExample.example
      return withoutExample
    })
  }

  const surfaces = SUB_APP_SURFACE_CONTRACTS.filter((item) => {
    if (surface && item.id !== surface) return false
    if (topic && topic !== 'surfaces') return false
    if (words.length > 0) {
      const haystack = JSON.stringify(item).toLocaleLowerCase()
      if (!words.every((word) => haystack.includes(word))) return false
    }
    return true
  })

  const totalMatches = matchedTopics.length + entries.length + surfaces.length
  const returnedEntries = entries.slice(0, 20)
  return {
    versions: versions(),
    topics: matchedTopics,
    matches: returnedEntries,
    surfaces,
    totalMatches,
    returnedMatches: matchedTopics.length + returnedEntries.length + surfaces.length,
    ...(entries.length > returnedEntries.length
      ? { truncated: true, note: 'SDK 契约命中超过 20 条，请增加 topic 或精确 symbol 缩小范围。' }
      : {}),
    ...(totalMatches === 0
      ? {
          suggestion:
            '未找到匹配契约。先调用无参数 guide 查看 topic，再按精确 symbol 查询；不要猜测 API。',
        }
      : {}),
  }
}

function versions() {
  return {
    contract: SUB_APP_DEVELOPER_CONTRACT_VERSION,
    runtimeProtocol: SUB_APP_RUNTIME_PROTOCOL_VERSION,
    packageSchema: SUB_APP_PACKAGE_SCHEMA_VERSION,
    digest: SUB_APP_DEVELOPER_CONTRACT_DIGEST,
  }
}

function entry(symbol, topic, capability, signature, summary, options = {}) {
  return {
    symbol,
    topic,
    capability,
    status: options.status ?? 'implemented',
    signature,
    summary,
    limits: options.limits ?? [],
    errors: options.errors ?? COMMON_BRIDGE_ERRORS,
    ...(options.example ? { example: options.example } : {}),
    ...(options.alternatives ? { alternatives: options.alternatives } : {}),
  }
}

function reservedEntry(symbol, topic, capability, summary) {
  return entry(symbol, topic, capability, '尚不可调用', summary, {
    status: 'reserved',
    errors: ['CAPABILITY_NOT_IMPLEMENTED'],
    alternatives: ['查询相邻已实现能力；若没有等价能力，应扩展宿主契约，不能猜测私有 IPC。'],
  })
}
