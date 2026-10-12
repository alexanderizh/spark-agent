/**
 * @module wiki-repo-enrich-context
 *
 * Repo Wiki AI 导读的上下文装配（方案B §6.1）—— 纯函数 + 受控 fs 只读。
 *
 * 确定性约束（缓存语义的地基）：同一 rev 的同一棵扫描树，两次装配必须产出
 * **逐字符相同**的 material —— 否则「按 rev 缓存」就名不副实。因此：
 *   - 全部列表来自按名稳定排序的扫描树（不重新遍历、不依赖时钟/随机数）；
 *   - 入口文件取前 ≤3 个的规则确定（沿用 renderModule 的入口候选正则，
 *     wiki-repo-scan-render.ts —— 该文件按 C1 约束一行不改，正则在此同步维护）；
 *   - 依赖提示是本地正则扫描（不调模型、不猜语义）。
 */

import * as fs from 'node:fs'
import { basename, join } from 'node:path'
import { formatBytes, type WikiRepoScanTree } from './wiki-repo-scan-tree.js'
import { WIKI_REPO_PAGE_SLUGS } from './wiki-repo-scan-render.js'

/** 直接文件清单上限（材料体量控制；树序截断） */
const MAX_FILE_LINES = 40
/** 入口文件读取个数上限（对齐 §6.1「取前 ≤3 个」） */
const MAX_ENTRY_FILES = 3
/** 单个入口文件截断上限（对齐 readManifest 的 4000 字符惯例） */
const ENTRY_FILE_MAX_CHARS = 4000
/** package.json 依赖名单提示上限 */
const MAX_DEP_NAMES = 60
/** 依赖名单总截断保护（名字长度） */
const DEP_NAME_MAX_CHARS = 80
/** 综述材料的根目录文件清单上限（树序截断） */
const MAX_ROOT_FILE_LINES = 40
/** 综述材料的语言分布展示条数 */
const MAX_LANGUAGE_LINES = 8
/** README 候选匹配（根目录受控摘录；树序取首个，保证确定性） */
const README_CANDIDATE_RE = /^readme(\.[^.]+)?$/i

/**
 * 入口候选正则 —— 与 wiki-repo-scan-render.ts renderModule 内联正则保持一致。
 * 修改任一处时必须同步另一处（render 受 C1 幂等约束冻结，故在此复制）。
 */
const ENTRY_CANDIDATE_RE = /^(index|main|mod|app|server|cli)\.[a-z]+$/

/** import / require 语句行（依赖提示用；只做行级匹配，不解析语法树） */
const IMPORT_LINE_RE =
  /^\s*(?:import|export)[^\n]*from\s+['"][^'"]+['"]|^\s*import\s+['"][^'"]+['"]|^\s*(?:const|let|var|async function|function)[^\n]*=\s*require\(\s*['"][^'"]+['"]\s*\)/m

export interface WikiRepoEnrichModuleContext {
  dir: string
  slug: string
  /** 装配好的提示材料（markdown；同 rev 同输入逐字符相同） */
  material: string
}

/**
 * 读取仓库根 package.json 的依赖名列表（每空间读一次；非 Node 仓库返回空）。
 *
 * 只取 dependencies（§6.1 口径）；名字按字典序排序保证确定性。
 * 文件不可读 / JSON 损坏时返回空数组（材料里如实标注「未提供」）。
 */
export function readRepoDependencyNames(tree: WikiRepoScanTree): string[] {
  const manifest = tree.manifests.find((relPath) => relPath === 'package.json')
  if (manifest == null) return []
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(join(tree.repoRoot, manifest), 'utf-8'))
    if (parsed == null || typeof parsed !== 'object') return []
    const deps = (parsed as Record<string, unknown>).dependencies
    if (deps == null || typeof deps !== 'object' || Array.isArray(deps)) return []
    return Object.keys(deps as Record<string, unknown>)
      .filter((name) => name.length > 0 && name.length <= DEP_NAME_MAX_CHARS)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_DEP_NAMES)
  } catch {
    return []
  }
}

/** 装配单个模块页的导读材料。 */
export function buildModuleEnrichContext(params: {
  dir: string
  tree: WikiRepoScanTree
  /** readRepoDependencyNames 的结果（调用方每空间读一次后传入） */
  dependencyNames: readonly string[]
}): WikiRepoEnrichModuleContext {
  const { dir, tree } = params
  const entry = tree.dirs.get(dir)
  const lines: string[] = [`# 模块：\`${dir}/\``]

  if (entry == null) {
    lines.push('', '（扫描时该目录不可读，无结构数据。）')
    return { dir, slug: WIKI_REPO_PAGE_SLUGS.module(dir), material: lines.join('\n') }
  }

  // ── 1. 结构数据（零额外 IO，全部来自稳定排序的树） ────────────────────
  lines.push(
    '',
    '## 结构数据',
    '',
    `- 递归文件总数：${entry.totalFiles}（体积 ${formatBytes(entry.totalBytes)}）`,
    `- 直接子目录：${entry.childDirs.map((c) => c.split('/').pop() ?? c).join('、') || '（无）'}`,
  )
  const byLanguage = new Map<string, number>()
  for (const file of entry.files) {
    byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1)
  }
  const languages = [...byLanguage.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([language, count]) => `${language} ${count}`)
    .join('、')
  lines.push(`- 本目录语言分布：${languages || '（无）'}`)

  // ── 2. 直接文件清单（≤40 条，树序截断） ───────────────────────────────
  lines.push(
    '',
    `## 直接文件清单${entry.files.length > MAX_FILE_LINES ? `（前 ${MAX_FILE_LINES} 条，共 ${entry.files.length} 条）` : ''}`,
    '',
  )
  for (const file of entry.files.slice(0, MAX_FILE_LINES)) {
    lines.push(`- \`${file.relPath}\`（${file.language}）`)
  }

  // ── 3. 入口文件受控读取（前 ≤3 个，各截断 ≤4000 字符） ────────────────
  const entryFiles = entry.files
    .filter((f) => ENTRY_CANDIDATE_RE.test(f.relPath.split('/').pop() ?? ''))
    .slice(0, MAX_ENTRY_FILES)
  lines.push(
    '',
    entryFiles.length > 0
      ? `## 入口文件内容（受控读取，各截断 ≤${ENTRY_FILE_MAX_CHARS} 字符）`
      : '## 入口文件内容',
    '',
  )
  const entryContents: Array<{ relPath: string; content: string }> = []
  for (const file of entryFiles) {
    const content = readEntryFile(tree.repoRoot, file.relPath)
    lines.push(`### \`${file.relPath}\``, '')
    if (content == null) {
      lines.push('（文件不可读）', '')
      continue
    }
    entryContents.push({ relPath: file.relPath, content })
    lines.push('```', content, '```', '')
  }

  // ── 4. 依赖提示（本地正则，不调模型） ─────────────────────────────────
  const siblings = tree.topDirs.filter((top) => top !== dir)
  const importedSiblings = siblings.filter((top) =>
    entryContents.some(({ content }) => mentionsDirInImports(content, top)),
  )
  lines.push('## 依赖提示', '')
  lines.push(
    importedSiblings.length > 0
      ? `- 入口文件 import 语句中出现的兄弟顶层目录：${importedSiblings.map((d) => `\`${d}/\``).join('、')}`
      : '- 入口文件 import 语句中未发现对兄弟顶层目录的引用。',
  )
  lines.push(
    params.dependencyNames.length > 0
      ? `- 仓库 package.json dependencies（${params.dependencyNames.length} 个）：${params.dependencyNames.join('、')}`
      : '- 仓库未提供可解析的 package.json dependencies。',
  )
  lines.push('')
  return { dir, slug: WIKI_REPO_PAGE_SLUGS.module(dir), material: lines.join('\n') }
}

export interface WikiRepoEnrichOverviewContext {
  slug: string
  /** 装配好的综述材料（markdown；同 rev 同输入逐字符相同） */
  material: string
}

/**
 * 装配综述页（repo-overview，S3）的导读材料。
 *
 * 口径与模块材料一致：全部列表来自稳定排序的扫描树，README 走受控读取
 * （截断 ≤ENTRY_FILE_MAX_CHARS），同 rev 两次装配逐字符相同。
 * 材料四层：骨架统计（与 renderOverview 同源）→ 顶层目录清单（含每目录
 * 直接文件主要语言）→ 根目录文件 → README 摘录 + 依赖提示。
 */
export function buildOverviewEnrichContext(params: {
  tree: WikiRepoScanTree
  /** readRepoDependencyNames 的结果（调用方每空间读一次后传入） */
  dependencyNames: readonly string[]
}): WikiRepoEnrichOverviewContext {
  const { tree } = params
  const root = tree.dirs.get('')
  const lines: string[] = [`# 仓库总览材料：\`${basename(tree.repoRoot)}/\``]

  if (root == null) {
    lines.push('', '（扫描时仓库根目录不可读，无结构数据。）')
    return { slug: WIKI_REPO_PAGE_SLUGS.overview, material: lines.join('\n') }
  }

  // ── 1. 结构数据（与 renderOverview 骨架同源：树聚合，零额外 IO） ─────
  const byLanguage = new Map<string, number>()
  for (const file of tree.files) {
    byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1)
  }
  const languages = [...byLanguage.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LANGUAGE_LINES)
    .map(([language, count]) => `${language} ${count}`)
    .join('、')
  lines.push(
    '',
    '## 结构数据',
    '',
    `- 顶层目录：${tree.topDirs.length} 个`,
    `- 文件总数：${tree.files.length}${tree.truncated ? `（受上限约束，实际扫描到 ${tree.scannedFiles} 个）` : ''}`,
    `- 代码体积：${formatBytes(root.totalBytes)}`,
    `- 语言分布：${languages || '（无）'}`,
  )

  // ── 2. 顶层目录清单（每目录：文件数 / 体积 / 直接文件主要语言） ───────
  lines.push(
    '',
    '## 顶层目录清单',
    '',
    '| 目录 | 文件数 | 体积 | 直接文件主要语言 |',
    '| --- | --- | --- | --- |',
  )
  for (const dir of tree.topDirs) {
    const entry = tree.dirs.get(dir)
    if (entry == null) {
      lines.push(`| \`${dir}/\` | 0 | 0 B | （无） |`)
      continue
    }
    const dirLanguages = new Map<string, number>()
    for (const file of entry.files) {
      dirLanguages.set(file.language, (dirLanguages.get(file.language) ?? 0) + 1)
    }
    const topLanguages = [...dirLanguages.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([language]) => language)
      .join('、')
    lines.push(
      `| \`${dir}/\` | ${entry.totalFiles} | ${formatBytes(entry.totalBytes)} | ${topLanguages || '（无直接文件）'} |`,
    )
  }

  // ── 3. 根目录文件清单（≤40 条，树序截断） ────────────────────────────
  lines.push(
    '',
    `## 根目录文件清单${
      root.files.length > MAX_ROOT_FILE_LINES
        ? `（前 ${MAX_ROOT_FILE_LINES} 条，共 ${root.files.length} 条）`
        : ''
    }`,
    '',
  )
  for (const file of root.files.slice(0, MAX_ROOT_FILE_LINES)) {
    lines.push(`- \`${file.relPath}\`（${file.language}）`)
  }

  // ── 4. README 受控摘录（树序首个候选，截断上限与入口文件同款） ────────
  const readme = root.files.find((file) =>
    README_CANDIDATE_RE.test(file.relPath.split('/').pop() ?? ''),
  )
  lines.push('', `## README 摘录（受控读取，截断 ≤${ENTRY_FILE_MAX_CHARS} 字符）`, '')
  if (readme == null) {
    lines.push('（仓库根目录未发现 README 文件。）')
  } else {
    const content = readEntryFile(tree.repoRoot, readme.relPath)
    lines.push(`### \`${readme.relPath}\``, '')
    if (content == null) {
      lines.push('（文件不可读）')
    } else {
      lines.push('```', content, '```')
    }
  }

  // ── 5. 依赖提示（与模块材料同源） ────────────────────────────────────
  lines.push('', '## 依赖提示', '')
  lines.push(
    params.dependencyNames.length > 0
      ? `- 仓库 package.json dependencies（${params.dependencyNames.length} 个）：${params.dependencyNames.join('、')}`
      : '- 仓库未提供可解析的 package.json dependencies。',
  )
  lines.push('')
  return { slug: WIKI_REPO_PAGE_SLUGS.overview, material: lines.join('\n') }
}

/** 受控读取入口文件（截断到上限；失败返回 null，材料如实标注不可读）。 */
function readEntryFile(repoRoot: string, relPath: string): string | null {
  try {
    const raw = fs.readFileSync(join(repoRoot, relPath), 'utf-8')
    return raw.length > ENTRY_FILE_MAX_CHARS
      ? `${raw.slice(0, ENTRY_FILE_MAX_CHARS)}\n…（已截断）`
      : raw
  } catch {
    return null
  }
}

/** 入口内容中是否有 import 语句引用了给定目录名（行级宽松匹配，宁缺勿滥）。 */
function mentionsDirInImports(content: string, dirName: string): boolean {
  const token = `/${dirName}`
  for (const line of content.split('\n')) {
    if (!IMPORT_LINE_RE.test(line)) continue
    if (line.includes(token) || line.includes(`'${dirName}`) || line.includes(`"${dirName}`)) {
      return true
    }
  }
  return false
}
