/**
 * CommandParser — 解析斜杠命令输入
 *
 * 支持格式：/command [subcommand] [args...] [--flag value] [@target] [free text]
 *
 * 三层命令架构:
 *   Layer 1: SDK 原生命令（Claude Agent SDK / Codex SDK）
 *   Layer 2: 程序内置命令（Session/Model/Context/Permission/...）
 *   Layer 3: Agent 技能命令（Skill manifest 注册）
 */

export interface ParsedCommand {
  name: string
  subcommand?: string
  args: string[]
  flags: Record<string, string>
  targets: string[]
  freeText?: string
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
 * 支持的语法:
 *   /command                              → 简单命令
 *   /command subcommand                   → 子命令
 *   /command arg1 arg2                    → 位置参数
 *   /command --flag value                 → 标志参数
 *   /command @target                      → mention 目标
 *   /command arg1 --flag val @target remaining text  → 混合
 *   /command arg1 剩余的自由文本            → free text
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
  const targets: string[] = []
  const freeTextParts: string[] = []
  const hitFreeText = false

  let i = 1
  while (i < tokens.length) {
    const token = tokens[i]!

    // Once we hit free text, everything else is free text
    if (hitFreeText) {
      freeTextParts.push(token)
      i++
      continue
    }

    // --flag value
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = tokens[i + 1]
      if (next !== undefined && !next.startsWith('--') && !next.startsWith('@')) {
        flags[key] = next
        i += 2
      } else {
        flags[key] = 'true'
        i++
      }
      continue
    }

    // @target mention
    if (token.startsWith('@')) {
      targets.push(token)
      i++
      continue
    }

    // Positional args or subcommand
    args.push(token)
    i++
  }

  // Determine subcommand: first arg might be a subcommand for compound commands
  // This is determined at the registry level, but we provide a hint
  const subcommand = args.length > 0 ? undefined : undefined

  const freeText = freeTextParts.length > 0 ? freeTextParts.join(' ') : undefined

  return {
    name,
    ...(subcommand != null ? { subcommand } : {}),
    args,
    flags,
    targets,
    ...(freeText != null ? { freeText } : {}),
    rawText: trimmed,
  }
}

/**
 * Parse with explicit subcommand extraction
 * Used when the registry knows which commands support subcommands
 */
export function parseCommandWithSubcommand(
  input: string,
  subcommandCommands?: Set<string>,
): ParsedCommand | null {
  const parsed = parseCommand(input)
  if (parsed == null) return null

  // If the command supports subcommands and has at least one arg,
  // treat the first arg as subcommand
  if (subcommandCommands?.has(parsed.name) && parsed.args.length > 0) {
    parsed.subcommand = parsed.args[0]!.toLowerCase()
    parsed.args = parsed.args.slice(1)
  }

  return parsed
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
