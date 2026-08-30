import type { RemoteMessageAction } from '@spark/protocol'

export type RemoteSessionStatus = 'idle' | 'running' | 'error'

export type RemoteSelectionRow = { id: string; label: string; meta?: string }

export type RemoteSelectionKind =
  | 'providers'
  | 'models'
  | 'agents'
  | 'sessions'
  | 'workspaces'
  | 'windows'

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

export function parseRemoteSessionFilter(args: readonly string[]): {
  status?: RemoteSessionStatus | undefined
  error?: string
} {
  const tokens = args.map((arg) => arg.trim()).filter(Boolean)
  if (tokens.length === 0) return { status: undefined }

  const first = tokens[0] ?? ''
  const isSeparateStatusFlag = first === '--status' || first === '-s'
  if (isSeparateStatusFlag && tokens[1] == null) {
    return { error: '状态筛选格式：/sessions [all|idle|running|error]' }
  }
  const rawValue = isSeparateStatusFlag
    ? tokens[1]
    : first.replace(/^--status[=:]/i, '').replace(/^status[=:]/i, '')
  const value = rawValue?.toLocaleLowerCase()
  if (value == null || value === '' || value === 'all' || value === '全部') {
    return tokens.length <= (isSeparateStatusFlag ? 2 : 1)
      ? { status: undefined }
      : { error: '状态筛选格式：/sessions [all|idle|running|error]' }
  }

  const status = SESSION_STATUS_ALIASES[value]
  if (status == null || tokens.length > (isSeparateStatusFlag ? 2 : 1)) {
    return { error: '状态筛选格式：/sessions [all|idle|running|error]' }
  }
  return { status }
}

export function buildRemoteErrorGuidance(error: string): string {
  const message = error.trim().slice(0, 1000) || '未知错误'
  const lower = message.toLocaleLowerCase()
  if (
    /\bmodel\b|\bprovider\b|模型|配额|限额|\bquota\b|rate limit|429|401|403|\btoken\b/.test(lower)
  ) {
    return `处理失败：${message}\n\n建议：/providers → /models → /use-model <序号>；也可使用 /use-provider <序号> 切换 Provider。`
  }
  if (/\bsession\b|会话/.test(lower)) {
    return `处理失败：${message}\n\n建议：发送 /sessions 查看主机会话；需要继续其他会话时使用 /use-session <序号|名称|sessionId>。`
  }
  return `处理失败：${message}\n\n建议：发送 /status 查看当前连接，发送 /help 查看可用命令；如果问题与模型有关，请依次使用 /providers、/models、/use-model。`
}

export function formatRows(rows: RemoteSelectionRow[], empty: string): string {
  if (rows.length === 0) return empty
  return rows
    .map(
      (row, index) =>
        `${index + 1}. ${row.label}\n   ${row.id}${row.meta != null ? ` · ${row.meta}` : ''}`,
    )
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

/**
 * Telegram callback_data 上限为 64 字节。超长的 command 不能静默截断（会变成无效命令），
 * 这里改为直接丢弃对应按钮——用户仍可在文本输入框手动发送该 command。
 */
export const TELEGRAM_CALLBACK_DATA_LIMIT = 64

export function filterTelegramCallbackActions(
  actions: RemoteMessageAction[],
  limit: number = TELEGRAM_CALLBACK_DATA_LIMIT,
): RemoteMessageAction[] {
  return actions.filter((action) => action.command.length <= limit)
}

/**
 * 会话切换按钮直接携带 sessionId，避免依赖连接级序号缓存——
 * 序号缓存会被下一次 /sessions 覆盖，按钮点旧消息会切到错误会话。
 */
export function buildRemoteSessionActions(rows: RemoteSelectionRow[]): RemoteMessageAction[] {
  return [
    { label: '全部', command: '/sessions' },
    { label: '运行中', command: '/sessions running' },
    { label: '空闲', command: '/sessions idle' },
    { label: '错误', command: '/sessions error' },
    ...rows.slice(0, 6).map((row) => ({
      label: `切换 ${row.label}`,
      command: `/use-session ${row.id}`,
      style: 'primary' as const,
    })),
  ]
}
