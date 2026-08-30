/**
 * 轻量 .gitignore 匹配器（WorkspaceSearch 专用，不新增外部依赖）。
 *
 * 支持的规则子集（覆盖日常仓库绝大多数写法）：
 *   - `#` 注释行 / 空行跳过
 *   - `!pattern` 否定（后规则覆盖先规则，git 语义）
 *   - 尾部 `/` 仅目录（dirOnly）
 *   - 含 `/`（非尾部）→ 锚定：相对该 .gitignore 所在目录匹配完整相对路径
 *     不含 `/` → 浮动：匹配任意层级的 basename
 *   - 通配：`**` 跨目录、`*` 单段内、`?` 单字符
 *
 * 不支持（按字面处理，宁可少忽略不可多忽略）：字符类 `[]`、转义序列。
 */

export interface GitignoreRule {
  negated: boolean
  /** 仅匹配目录 */
  dirOnly: boolean
  /** 锚定到完整相对路径（规则含非尾部 `/`） */
  anchored: boolean
  regex: RegExp
  /** 原始行（调试用） */
  source: string
}

/** 解析单个 .gitignore 文件内容为规则列表（顺序保持，匹配时从后往前）。 */
export function parseGitignore(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    let pattern = line
    let negated = false
    if (pattern.startsWith('!')) {
      negated = true
      pattern = pattern.slice(1)
    }
    if (pattern === '') continue

    let dirOnly = false
    if (pattern.endsWith('/')) {
      dirOnly = true
      pattern = pattern.slice(0, -1)
    }
    if (pattern === '') continue

    // 锚定：首个 `/` 不在开头时也视为锚定（`/foo` 与 `a/b` 都相对本目录）
    const anchored = pattern.includes('/')
    const body = pattern.startsWith('/') ? pattern.slice(1) : pattern

    rules.push({
      negated,
      dirOnly,
      anchored,
      regex: globToRegex(body),
      source: line,
    })
  }
  return rules
}

/** glob → RegExp。`**` 跨目录、`*` 不跨目录、`?` 单字符（不跨目录）。 */
function globToRegex(pattern: string): RegExp {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch == null) break
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**`（可能后跟 `/`）：跨任意层级目录
        if ((pattern[i + 2] ?? '') === '/') {
          out += '(?:.*/)?'
          i += 3
        } else {
          out += '.*'
          i += 2
        }
      } else {
        out += '[^/]*'
        i += 1
      }
    } else if (ch === '?') {
      out += '[^/]'
      i += 1
    } else {
      out += escapeRegex(ch)
      i += 1
    }
  }
  return new RegExp(`^${out}$`)
}

function escapeRegex(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch
}

/** 一个 .gitignore 文件对应的匹配器。 */
export interface GitignoreMatcher {
  /**
   * 相对该 matcher 所在目录的 posix 路径。
   * 返回三态：'ignore'（忽略）/ 'keep'（命中否定规则，明确保留）/ null（无规则命中）。
   * 三态是跨层组合需要的：更深 gitignore 的 `!pattern` 必须能覆盖上层忽略，
   * 而「无命中」则继续问上层，两者不能混为同一个布尔值。
   */
  decide(relPath: string, isDirectory: boolean): 'ignore' | 'keep' | null
  readonly rules: readonly GitignoreRule[]
}

export function createGitignoreMatcher(content: string): GitignoreMatcher {
  const rules = parseGitignore(content)
  return {
    rules,
    decide(relPath: string, isDirectory: boolean): 'ignore' | 'keep' | null {
      // git 语义：同一文件内后面的规则覆盖前面的 → 从后往前找第一个命中的规则做决定
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        const rule = rules[i]
        if (rule == null) continue
        if (rule.dirOnly && !isDirectory) continue
        const hit = rule.anchored
          ? rule.regex.test(relPath)
          : rule.regex.test(relPath) || rule.regex.test(basenameOf(relPath))
        if (hit) return rule.negated ? 'keep' : 'ignore'
      }
      return null
    },
  }
}

function basenameOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx >= 0 ? relPath.slice(idx + 1) : relPath
}

/** gitignore 栈中的一层：matcher + 它所在目录的段深度（根 = 0）。 */
export interface GitignoreStackEntry {
  matcher: GitignoreMatcher
  /** 该 .gitignore 所在目录相对根的段深度（根 .gitignore = 0） */
  depth: number
}

/**
 * 判断某条目是否被栈内任一 matcher 忽略。
 *
 * 每个 matcher 用「相对它所在目录」的路径来判断（anchored 语义要求如此）：
 * relToRoot 按段切开后，depth 为 d 的 matcher 匹配 segments.slice(d).join('/')。
 * 更深（更靠后）的 gitignore 优先级更高，从栈顶（最深）往下问。
 */
export function isIgnoredByStack(
  stack: readonly GitignoreStackEntry[],
  /** 相对 workspace 根的 posix 路径 */
  relToRoot: string,
  isDirectory: boolean,
): boolean {
  if (stack.length === 0) return false
  const segments = relToRoot.split('/')
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i]
    if (entry == null) continue
    const { matcher, depth } = entry
    const relToMatcherDir = segments.slice(depth).join('/')
    if (relToMatcherDir === '') continue
    const decision = matcher.decide(relToMatcherDir, isDirectory)
    // 更深处的决定（含否定）优先；null 才继续问上层
    if (decision === 'ignore') return true
    if (decision === 'keep') return false
  }
  return false
}
