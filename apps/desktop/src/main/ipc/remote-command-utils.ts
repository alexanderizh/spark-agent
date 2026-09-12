import type {
  ProviderProfile,
  RemoteMessageAction,
  SessionAgentAdapter,
  SessionPermissionMode,
  SessionReasoningEffort,
} from '@spark/protocol'

export type RemoteSessionStatus = 'idle' | 'running' | 'error'

export type RemoteSelectionRow = { id: string; label: string; meta?: string }

export type RemoteSelectionKind =
  | 'providers'
  | 'models'
  | 'agents'
  | 'sessions'
  | 'workspaces'
  | 'permissions'
  | 'reasoning'
  | 'windows'

export const REMOTE_SELECTION_PAGE_SIZE = 6

export type RemoteSelectionPage = {
  page: number
  totalPages: number
  total: number
  rows: RemoteSelectionRow[]
}

export function buildRemoteProviderModelRows(
  provider: Pick<ProviderProfile, 'modelIds' | 'defaultModel'>,
): RemoteSelectionRow[] {
  const modelIds = [...new Set(provider.modelIds.map((modelId) => modelId.trim()).filter(Boolean))]
  return modelIds.map((modelId) => ({
    id: modelId,
    label: modelId,
    ...(modelId === provider.defaultModel ? { meta: '渠道默认' } : {}),
  }))
}

export const REMOTE_REASONING_ROWS: Array<RemoteSelectionRow & { id: SessionReasoningEffort }> = [
  { id: 'minimal', label: '最低' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '很高' },
  { id: 'max', label: '最高' },
]

export function getRemotePermissionRows(
  adapter: SessionAgentAdapter,
): Array<RemoteSelectionRow & { id: SessionPermissionMode }> {
  if (adapter === 'codex') {
    return [
      { id: 'codex-default', label: '手动审批' },
      { id: 'codex-auto-review', label: '自动审批', meta: '推荐' },
      { id: 'codex-full-access', label: '完全访问', meta: '高风险' },
    ]
  }
  if (adapter === 'spark') {
    return [
      { id: 'spark-default', label: '手动审批' },
      { id: 'spark-auto', label: '自动审批', meta: '推荐' },
      { id: 'spark-bypass', label: '完全访问', meta: '高风险' },
    ]
  }
  return [
    { id: 'claude-ask', label: '手动审批' },
    { id: 'claude-auto-edits', label: '自动编辑' },
    { id: 'claude-plan', label: '规划模式' },
    { id: 'claude-auto', label: '自动审批', meta: '推荐' },
    { id: 'claude-bypass', label: '完全访问', meta: '高风险' },
  ]
}

export function defaultRemotePermissionMode(adapter: SessionAgentAdapter): SessionPermissionMode {
  if (adapter === 'codex') return 'codex-auto-review'
  if (adapter === 'spark') return 'spark-auto'
  return 'claude-auto'
}

export function normalizeRemotePermissionInput(
  input: string,
  adapter: SessionAgentAdapter,
): string {
  const value = input.trim().toLocaleLowerCase()
  const aliases: Record<string, string> = {
    manual:
      adapter === 'codex' ? 'codex-default' : adapter === 'spark' ? 'spark-default' : 'claude-ask',
    手动:
      adapter === 'codex' ? 'codex-default' : adapter === 'spark' ? 'spark-default' : 'claude-ask',
    auto: defaultRemotePermissionMode(adapter),
    自动: defaultRemotePermissionMode(adapter),
    plan: adapter === 'spark' ? 'spark-plan' : 'claude-plan',
    规划: adapter === 'spark' ? 'spark-plan' : 'claude-plan',
    full:
      adapter === 'codex'
        ? 'codex-full-access'
        : adapter === 'spark'
          ? 'spark-bypass'
          : 'claude-bypass',
    bypass:
      adapter === 'codex'
        ? 'codex-full-access'
        : adapter === 'spark'
          ? 'spark-bypass'
          : 'claude-bypass',
    完全:
      adapter === 'codex'
        ? 'codex-full-access'
        : adapter === 'spark'
          ? 'spark-bypass'
          : 'claude-bypass',
  }
  return aliases[value] ?? input.trim()
}

const SESSION_STATUS_ALIASES: Record<string, RemoteSessionStatus> = {
  idle: 'idle',
  空闲: 'idle',
  等待: 'idle',
  running: 'running',
  active: 'running',
  运行: 'running',
  运行中: 'running',
  error: 'error',
  failed: 'error',
  错误: 'error',
  失败: 'error',
}

export function parseRemoteSessionFilter(
  args: readonly string[],
  commandPrefix = '/',
): {
  status?: RemoteSessionStatus | undefined
  page?: number | undefined
  error?: string
} {
  const prefix = commandPrefix.trim() || '/'
  const usage = `格式：${prefix}sessions [all|idle|running|error] [页码]`
  const tokens = args.map((arg) => arg.trim()).filter(Boolean)
  let status: RemoteSessionStatus | undefined
  let page: number | undefined
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    if (token === '--status' || token === '-s') {
      const next = tokens[index + 1]
      if (next == null) return { error: usage }
      const parsed = SESSION_STATUS_ALIASES[next.toLocaleLowerCase()]
      if (parsed == null || status != null) return { error: usage }
      status = parsed
      index += 1
      continue
    }
    if (token === '--page' || token === '-p') {
      const next = tokens[index + 1]
      if (next == null || !/^\d+$/.test(next) || Number(next) < 1 || page != null) {
        return { error: usage }
      }
      page = Number(next)
      index += 1
      continue
    }
    const statusValue = token.replace(/^--status[=:]/i, '').replace(/^status[=:]/i, '')
    const normalizedStatus = statusValue.toLocaleLowerCase()
    if (normalizedStatus === 'all' || normalizedStatus === '全部') {
      if (status != null) return { error: usage }
      continue
    }
    const parsedStatus = SESSION_STATUS_ALIASES[normalizedStatus]
    if (parsedStatus != null) {
      if (status != null) return { error: usage }
      status = parsedStatus
      continue
    }
    const pageValue = token.replace(/^--page[=:]/i, '').replace(/^page[=:]/i, '')
    if (/^\d+$/.test(pageValue) && Number(pageValue) >= 1 && page == null) {
      page = Number(pageValue)
      continue
    }
    return { error: usage }
  }
  return { status, page }
}

export function parseRemotePage(
  args: readonly string[],
  usage: string,
):
  | { page: number }
  | {
      error: string
    } {
  if (args.length === 0) return { page: 1 }
  const tokens = args.filter((arg) => arg.trim().length > 0)
  const raw =
    tokens[0] === '--page' || tokens[0] === '-p'
      ? tokens.length === 2
        ? tokens[1]
        : undefined
      : tokens.length === 1
        ? tokens[0]?.replace(/^--page[=:]/i, '').replace(/^page[=:]/i, '')
        : undefined
  if (raw == null || !/^\d+$/.test(raw) || Number(raw) < 1) return { error: usage }
  return { page: Number(raw) }
}

export function paginateRemoteSelection(
  rows: RemoteSelectionRow[],
  requestedPage = 1,
  pageSize = REMOTE_SELECTION_PAGE_SIZE,
): RemoteSelectionPage {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, requestedPage), totalPages)
  const start = (page - 1) * pageSize
  return { page, totalPages, total: rows.length, rows: rows.slice(start, start + pageSize) }
}

export function buildRemoteErrorGuidance(error: string, commandPrefix = '/'): string {
  const message = error.trim().slice(0, 1000) || '未知错误'
  const lower = message.toLocaleLowerCase()
  const prefix = commandPrefix.trim() || '/'
  const command = (name: string, argument?: string): string =>
    `${prefix}${name}${argument == null ? '' : ` ${argument}`}`
  if (
    /\bmodel\b|\bprovider\b|模型|配额|限额|\bquota\b|rate limit|429|401|403|\btoken\b/.test(lower)
  ) {
    return `处理失败：${message}\n\n建议：${command('providers')} → ${command('models')} → ${command('use-model', '<序号>')}；也可使用 ${command('use-provider', '<序号>')} 切换 Provider。`
  }
  if (/\bsession\b|会话/.test(lower)) {
    return `处理失败：${message}\n\n建议：发送 ${command('sessions')} 查看主机会话；需要继续其他会话时使用 ${command('use-session', '<序号|名称|sessionId>')}。`
  }
  return `处理失败：${message}\n\n建议：发送 ${command('status')} 查看当前连接，发送 ${command('help')} 查看可用命令；如果问题与模型有关，请依次使用 ${command('providers')}、${command('models')}、${command('use-model')}。`
}

export function formatRows(rows: RemoteSelectionRow[], empty: string): string {
  if (rows.length === 0) return empty
  return rows
    .map((row, index) => `${index + 1}. ${row.label}${row.meta != null ? ` · ${row.meta}` : ''}`)
    .join('\n')
}

function quoteRemoteRows(rows: RemoteSelectionRow[]): string {
  return rows.map((row, index) => `${index + 1}. ${row.label} (${row.id})`).join('\n')
}

export function resolveRemoteSelection(
  input: string,
  rows: RemoteSelectionRow[],
  options: { kindLabel: string; listCommand: string; cachedRows?: RemoteSelectionRow[] | null },
): { ok: true; row: RemoteSelectionRow } | { ok: false; title: string; text: string } {
  const value = input.trim()
  if (value.length === 0) {
    return { ok: false, title: `缺少${options.kindLabel}`, text: '请输入序号、名称或 ID。' }
  }

  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1
    const source = options.cachedRows ?? rows
    if (options.cachedRows == null) {
      return {
        ok: false,
        title: '序号已过期',
        text: `请先发送 ${options.listCommand} 重新查看列表，再使用序号。`,
      }
    }
    const row = source[index]
    if (row == null) {
      return { ok: false, title: '序号不存在', text: `可用范围：1-${source.length}` }
    }
    return { ok: true, row }
  }

  const idMatch = rows.find((row) => row.id === value)
  if (idMatch != null) return { ok: true, row: idMatch }

  const normalized = value.toLocaleLowerCase()
  const nameMatches = rows.filter((row) => row.label.trim().toLocaleLowerCase() === normalized)
  const onlyNameMatch = nameMatches[0]
  if (nameMatches.length === 1 && onlyNameMatch != null) return { ok: true, row: onlyNameMatch }
  if (nameMatches.length > 1) {
    return {
      ok: false,
      title: `${options.kindLabel} 名称不唯一`,
      text: `请改用序号或 ID：\n${quoteRemoteRows(nameMatches)}`,
    }
  }

  const partialMatches = rows.filter((row) => row.label.toLocaleLowerCase().includes(normalized))
  const onlyPartialMatch = partialMatches[0]
  if (partialMatches.length === 1 && onlyPartialMatch != null)
    return { ok: true, row: onlyPartialMatch }
  if (partialMatches.length > 1) {
    return {
      ok: false,
      title: `${options.kindLabel} 匹配不唯一`,
      text: `请改用更完整名称、序号或 ID：\n${quoteRemoteRows(partialMatches.slice(0, 10))}`,
    }
  }

  return {
    ok: false,
    title: `未找到${options.kindLabel}`,
    text: `未找到：${value}。请发送 ${options.listCommand} 查看可用项。`,
  }
}

/** Telegram callback_data 的 UTF-8 字节上限；供校验与兼容调用使用。 */
export const TELEGRAM_CALLBACK_DATA_LIMIT = 64

export function filterTelegramCallbackActions(
  actions: RemoteMessageAction[],
  limit: number = TELEGRAM_CALLBACK_DATA_LIMIT,
): RemoteMessageAction[] {
  return actions.filter((action) => Buffer.byteLength(action.command, 'utf8') <= limit)
}

export function buildRemoteSelectionActions(
  rows: RemoteSelectionRow[],
  options: {
    selectCommand: string
    listCommand: string
    page?: number
    totalPages?: number
    selectedId?: string | null | undefined
  },
): RemoteMessageAction[] {
  const page = options.page ?? 1
  const totalPages = options.totalPages ?? 1
  const actions: RemoteMessageAction[] = rows.map((row) => ({
    label: `${row.id === options.selectedId ? '✓ ' : ''}${row.label}`,
    command: `${options.selectCommand} ${row.id}`,
    style: row.id === options.selectedId ? ('primary' as const) : ('default' as const),
  }))
  if (page > 1) actions.push({ label: '‹ 上一页', command: `${options.listCommand} ${page - 1}` })
  if (totalPages > 1) {
    actions.push({ label: `${page}/${totalPages}`, command: `${options.listCommand} ${page}` })
  }
  if (page < totalPages)
    actions.push({ label: '下一页 ›', command: `${options.listCommand} ${page + 1}` })
  return actions
}

/**
 * 会话切换按钮直接携带 sessionId，避免依赖连接级序号缓存——
 * 序号缓存会被下一次 /sessions 覆盖，按钮点旧消息会切到错误会话。
 */
export function buildRemoteSessionActions(
  rows: RemoteSelectionRow[],
  commandPrefix = '/',
  options: {
    page?: number
    totalPages?: number
    status?: RemoteSessionStatus
    selectedId?: string | null | undefined
  } = {},
): RemoteMessageAction[] {
  const prefix = commandPrefix.trim() || '/'
  const filter = options.status == null ? '' : ` ${options.status}`
  const page = options.page ?? 1
  const totalPages = options.totalPages ?? 1
  return [
    { label: '全部', command: `${prefix}sessions` },
    { label: '运行中', command: `${prefix}sessions running` },
    { label: '空闲', command: `${prefix}sessions idle` },
    { label: '错误', command: `${prefix}sessions error` },
    ...rows.slice(0, REMOTE_SELECTION_PAGE_SIZE).map((row) => ({
      label: `${row.id === options.selectedId ? '✓ ' : ''}${row.label}`,
      command: `${prefix}use-session ${row.id}`,
      style: row.id === options.selectedId ? ('primary' as const) : ('default' as const),
    })),
    ...(page > 1 ? [{ label: '‹ 上一页', command: `${prefix}sessions${filter} ${page - 1}` }] : []),
    ...(totalPages > 1
      ? [{ label: `${page}/${totalPages}`, command: `${prefix}sessions${filter} ${page}` }]
      : []),
    ...(page < totalPages
      ? [{ label: '下一页 ›', command: `${prefix}sessions${filter} ${page + 1}` }]
      : []),
  ]
}
