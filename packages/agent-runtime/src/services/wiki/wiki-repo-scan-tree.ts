/**
 * @module wiki-repo-scan-tree
 *
 * Repo Wiki 扫描树（S4）—— 仓库文件系统的受控遍历与忽略规则匹配。
 *
 * 为什么单独一层：扫描是**可重建**操作（rebuild），遍历结果必须只依赖
 * 仓库内容与忽略规则，不依赖时钟/随机数/网络 —— 否则同一 rev 两次重建
 * 会产出不同页面，破坏"可重建"语义。本模块因此保持为纯函数式（fs 只读）。
 *
 * 成本控制（方案 §12 D 组 / §14 风险）：
 *   - maxFiles 硬上限：超出即截断并如实回报 truncated，绝不静默少扫；
 *   - 忽略规则缺省覆盖 node_modules/dist/build/out/.git 等重目录；
 *   - 只读文件名与大小，不读文件内容（内容读取在 render 层按需进行）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** 默认忽略项（方案 §12 D 组 `wiki/repo/ignoreGlobs` 缺省值） */
export const WIKI_REPO_DEFAULT_IGNORE = ['node_modules', 'dist', 'build', 'out', '.git']

/** 单次扫描文件数缺省上限 */
export const WIKI_REPO_DEFAULT_MAX_FILES = 20_000

/** 语言识别表（扩展名 → 展示名）；未命中归入 "Other" */
const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.m': 'Objective-C',
  '.c': 'C',
  '.h': 'C/C++ Header',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++ Header',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.ps1': 'PowerShell',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.less': 'Less',
  '.scss': 'Sass',
  '.sass': 'Sass',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.txt': 'Text',
  '.csv': 'CSV',
  '.graphql': 'GraphQL',
  '.proto': 'Protocol Buffers',
  '.dart': 'Dart',
  '.lua': 'Lua',
  '.r': 'R',
  '.scala': 'Scala',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.clj': 'Clojure',
  '.hs': 'Haskell',
  '.zig': 'Zig',
}

/** 关键清单/说明文件（render 层会读取内容生成"技术栈"页） */
export const WIKI_REPO_MANIFEST_NAMES = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'Cargo.toml',
  'go.mod',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CMakeLists.txt',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'webpack.config.js',
  'rollup.config.js',
  'esbuild.config.js',
  'turbo.json',
  'nx.json',
  'lerna.json',
]

export interface WikiRepoFileEntry {
  /** 相对仓库根的 POSIX 路径 */
  relPath: string
  /** 字节数 */
  size: number
  ext: string
  language: string
}

export interface WikiRepoDirEntry {
  /** 相对仓库根的 POSIX 路径（根目录为 ''） */
  relPath: string
  /** 直接子文件 */
  files: WikiRepoFileEntry[]
  /** 直接子目录（相对路径） */
  childDirs: string[]
  /** 递归文件总数 */
  totalFiles: number
  /** 递归字节总数 */
  totalBytes: number
}

export interface WikiRepoScanTree {
  repoRoot: string
  /** 顶层目录名（按名称排序） */
  topDirs: string[]
  /** 目录相对路径 → 条目（含根 ''） */
  dirs: Map<string, WikiRepoDirEntry>
  /** 全部文件（受 maxFiles 约束） */
  files: WikiRepoFileEntry[]
  /** 语言 → 文件数（降序） */
  languages: Array<{ language: string; files: number }>
  /** 仓库根下的清单文件（相对路径，render 层按需读取） */
  manifests: string[]
  /** 是否因上限截断 */
  truncated: boolean
  /** 扫描到的文件总数（截断前） */
  scannedFiles: number
}

export interface WikiRepoScanOptions {
  ignoreGlobs?: readonly string[]
  maxFiles?: number
}

/**
 * 把忽略规则编译为匹配器。
 *
 * 规则语义（对齐 .gitignore 心智模型，但更简单）：
 *   - 空行 / `#` 注释忽略；
 *   - 以 `/` 开头 → 只匹配仓库根起的路径（`/foo` 不命中 `a/foo`）；
 *   - 以 `/` 结尾 → 只匹配目录；
 *   - **不含 `/` 的模式**（裸名或 `*.log` 这类通配符）→ 匹配**任意层级**的
 *     同名条目（basename 匹配），与 gitignore「无斜杠即任意层级」一致；
 *   - 含 `/` 的模式 → 从仓库根匹配整条相对路径。
 *   命中目录时，其所有后代同样忽略（`node_modules` 下的深层文件不必逐条判断）。
 */
export function compileIgnoreRules(
  rules: readonly string[] = WIKI_REPO_DEFAULT_IGNORE,
): (relPath: string, isDir: boolean) => boolean {
  const matchers: Array<(relPath: string, isDir: boolean) => boolean> = []
  for (const raw of rules) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    let pattern = line
    let rootOnly = false
    let dirOnly = false
    if (pattern.startsWith('/')) {
      rootOnly = true
      pattern = pattern.slice(1)
    }
    if (pattern.endsWith('/')) {
      dirOnly = true
      pattern = pattern.slice(0, -1)
    }
    if (pattern.length === 0) continue

    const hasSlash = pattern.includes('/')
    const regex = globToRegExp(pattern)
    matchers.push((relPath, isDir) => {
      if (dirOnly && !isDir) return false
      const segments = relPath.split('/')
      const base = segments[segments.length - 1] ?? relPath
      if (!hasSlash) {
        // 任意层级：basename 命中，或任一祖先目录命中（后代连带忽略）
        if (rootOnly) return segments.length === 1 && regex.test(base)
        if (regex.test(base)) return true
        return segments.slice(0, -1).some((segment) => regex.test(segment))
      }
      // 从根匹配整条路径；祖先目录命中同样连带忽略
      if (regex.test(relPath)) return true
      return segments
        .slice(0, -1)
        .some((_, index) => regex.test(segments.slice(0, index + 1).join('/')))
    })
  }
  return (relPath, isDir) => matchers.some((matcher) => matcher(relPath, isDir))
}

/** glob → RegExp（`**` 跨目录、`*` 不跨目录、`?` 单字符） */
export function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]
    if (ch == null) continue
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**`（含 `**/`）→ 跨任意层级
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`
    } else {
      out += ch
    }
  }
  return new RegExp(`^${out}$`)
}

/**
 * 遍历仓库，产出扫描树。
 *
 * 遍历顺序稳定（目录与文件各自按名称排序），保证同一 rev 的扫描结果
 * 逐字节可复现 —— 这是 rebuild 幂等的前提。
 */
export function scanRepoTree(
  repoRoot: string,
  options: WikiRepoScanOptions = {},
): WikiRepoScanTree {
  const maxFiles = Math.max(1, options.maxFiles ?? WIKI_REPO_DEFAULT_MAX_FILES)
  const ignored = compileIgnoreRules(options.ignoreGlobs ?? WIKI_REPO_DEFAULT_IGNORE)

  const dirs = new Map<string, WikiRepoDirEntry>()
  const files: WikiRepoFileEntry[] = []
  const manifests: string[] = []
  let truncated = false
  let scannedFiles = 0

  const ensureDir = (relPath: string): WikiRepoDirEntry => {
    const existing = dirs.get(relPath)
    if (existing != null) return existing
    const entry: WikiRepoDirEntry = {
      relPath,
      files: [],
      childDirs: [],
      totalFiles: 0,
      totalBytes: 0,
    }
    dirs.set(relPath, entry)
    return entry
  }

  ensureDir('')

  const walk = (absDir: string, relDir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      return // 无权限 / 符号链接断裂：跳过该目录（如实少扫，不抛断整次扫描）
    }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of sorted) {
      const relPath = relDir.length === 0 ? entry.name : `${relDir}/${entry.name}`
      if (ignored(relPath, entry.isDirectory())) continue
      if (entry.isDirectory()) {
        ensureDir(relDir).childDirs.push(relPath)
        ensureDir(relPath)
        walk(path.join(absDir, entry.name), relPath)
        continue
      }
      if (!entry.isFile()) continue
      scannedFiles += 1
      if (files.length >= maxFiles) {
        truncated = true
        continue
      }
      let size: number
      try {
        size = fs.statSync(path.join(absDir, entry.name)).size
      } catch {
        size = 0
      }
      const ext = path.extname(entry.name).toLowerCase()
      const fileEntry: WikiRepoFileEntry = {
        relPath,
        size,
        ext,
        language: LANGUAGE_BY_EXT[ext] ?? 'Other',
      }
      files.push(fileEntry)
      ensureDir(relDir).files.push(fileEntry)
      if (relDir.length === 0 && WIKI_REPO_MANIFEST_NAMES.includes(entry.name)) {
        manifests.push(relPath)
      }
    }
  }

  walk(repoRoot, '')

  // 自底向上汇总目录统计（目录名长度排序保证父在子前处理的反序）
  const ordered = [...dirs.keys()].sort((a, b) => b.length - a.length)
  for (const relPath of ordered) {
    const entry = dirs.get(relPath)!
    let totalFiles = entry.files.length
    let totalBytes = entry.files.reduce((sum, f) => sum + f.size, 0)
    for (const child of entry.childDirs) {
      const childEntry = dirs.get(child)
      if (childEntry == null) continue
      totalFiles += childEntry.totalFiles
      totalBytes += childEntry.totalBytes
    }
    entry.totalFiles = totalFiles
    entry.totalBytes = totalBytes
  }

  const byLanguage = new Map<string, number>()
  for (const file of files) {
    byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1)
  }
  const languages = [...byLanguage.entries()]
    .map(([language, count]) => ({ language, files: count }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language))

  const root = dirs.get('')!
  return {
    repoRoot,
    topDirs: root.childDirs.map((p) => p.split('/').pop() ?? p),
    dirs,
    files,
    languages,
    manifests,
    truncated,
    scannedFiles,
  }
}

/** 人类可读体积（ KiB / MiB ），用于页面统计行。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
