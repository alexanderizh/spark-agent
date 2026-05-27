/**
 * CommandParser — 解析斜杠命令输入
 *
 * 支持格式：/command [subcommand] [args...] [--flag value]
 */

export interface ParsedCommand {
  name: string
  args: string[]
  flags: Record<string, string>
  rawText: string
}

/**
 * 判断输入是否为斜杠命令
 */
export function isCommand(input: string): boolean {
  return input.trimStart().startsWith('/')
}

/**
 * 解析斜杠命令字符串
 *
 * 返回 null 表示不是有效命令格式
 */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  // 分词，支持引号包裹
  const tokens = tokenize(trimmed.slice(1))
  if (tokens.length === 0) return null

  const name = tokens[0]!.toLowerCase()
  const args: string[] = []
  const flags: Record<string, string> = {}

  let i = 1
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = tokens[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i += 2
      } else {
        flags[key] = 'true'
        i++
      }
    } else {
      args.push(token)
      i++
    }
  }

  return { name, args, flags, rawText: trimmed }
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true
      quoteChar = ch
    } else if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }

  if (current.length > 0) tokens.push(current)
  return tokens
}
