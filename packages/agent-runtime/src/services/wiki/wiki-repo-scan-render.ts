/**
 * @module wiki-repo-scan-render
 *
 * Repo Wiki 渲染层（S4）—— 把扫描树渲染成结构化 Markdown 页面。
 *
 * 纯函数约束：输出只依赖扫描树与 manifest 内容，**不依赖时钟 / 随机数 /
 * 遍历顺序之外的一切**。这是 rebuild 幂等的第二道保证（第一道是扫描树的
 * 稳定排序）——同一 rev 两次 rebuild 必须产出逐字节相同的正文，
 * 否则 CAS 会误判"内容已变"而无限推进版本号。
 *
 * 页面规划（方案 §11.1 Repo Wiki Tab）：
 *   总览 / 目录结构 / 技术栈 / 每个顶层目录一页（模块页）。
 */

import { join } from 'node:path'
import * as fs from 'node:fs'
import { formatBytes, type WikiRepoScanTree } from './wiki-repo-scan-tree.js'

/** Repo Wiki 页面固定 slug（同一空间内唯一，rebuild 时按 slug 定位更新） */
export const WIKI_REPO_PAGE_SLUGS = {
  overview: 'repo-overview',
  structure: 'repo-structure',
  stack: 'repo-stack',
  module: (dir: string): string => `repo-module-${slugifySegment(dir)}`,
} as const

export interface WikiRepoPageDraft {
  slug: string
  title: string
  kind: 'reference'
  summary: string
  body: string
}

function slugifySegment(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'module'
  )
}

/** 读清单文件内容（截断到上限；读取失败返回 null，页面如实标注"不可读"）。 */
function readManifest(repoRoot: string, relPath: string, maxChars = 4000): string | null {
  try {
    const raw = fs.readFileSync(join(repoRoot, relPath), 'utf-8')
    return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n…（已截断）` : raw
  } catch {
    return null
  }
}

/** 渲染全部 Repo Wiki 页面草稿（顺序稳定，调用方按序写入）。 */
export function renderRepoPages(
  repoName: string,
  repoRev: string | null,
  tree: WikiRepoScanTree,
): WikiRepoPageDraft[] {
  const pages: WikiRepoPageDraft[] = [
    renderOverview(repoName, repoRev, tree),
    renderStructure(repoName, tree),
    renderStack(repoName, tree),
  ]
  for (const dir of tree.topDirs) {
    pages.push(renderModule(repoName, dir, tree))
  }
  return pages
}

function renderOverview(
  repoName: string,
  repoRev: string | null,
  tree: WikiRepoScanTree,
): WikiRepoPageDraft {
  const root = tree.dirs.get('')!
  const lines: string[] = [
    `# ${repoName} 总览`,
    '',
    `本页由 Repo Wiki 扫描生成，可随代码变更重建。生成时代码版本：\`${repoRev ?? '未知'}\`。`,
    '',
    '## 规模',
    '',
    `- 顶层目录：${tree.topDirs.length} 个`,
    `- 文件总数：${tree.files.length}${tree.truncated ? `（受上限约束，实际扫描到 ${tree.scannedFiles} 个）` : ''}`,
    `- 代码体积：${formatBytes(root.totalBytes)}`,
    `- 识别语言：${tree.languages.length} 种`,
    '',
    '## 顶层结构',
    '',
    '| 目录 | 文件数 | 体积 |',
    '| --- | --- | --- |',
  ]
  for (const dir of tree.topDirs) {
    const entry = tree.dirs.get(dir)
    lines.push(
      `| \`${dir}/\` | ${entry?.totalFiles ?? 0} | ${formatBytes(entry?.totalBytes ?? 0)} |`,
    )
  }
  const rootFiles = root.files.map((f) => f.relPath)
  if (rootFiles.length > 0) {
    lines.push('', '## 根目录文件', '', ...rootFiles.map((p) => `- \`${p}\``))
  }
  lines.push('')
  return {
    slug: WIKI_REPO_PAGE_SLUGS.overview,
    title: `${repoName} 总览`,
    kind: 'reference',
    summary: `仓库规模与顶层结构（${tree.files.length} 个文件 / ${tree.topDirs.length} 个顶层目录）`,
    body: lines.join('\n'),
  }
}

function renderStructure(repoName: string, tree: WikiRepoScanTree): WikiRepoPageDraft {
  const lines: string[] = [
    `# ${repoName} 目录结构`,
    '',
    '本页由 Repo Wiki 扫描生成，可随代码变更重建。',
    '',
    '```',
    `${repoName}/`,
  ]
  // 渲染目录树：目录带聚合统计，文件只列名称（控制体量）
  const renderDir = (relDir: string, depth: number): void => {
    if (depth > 6) return
    const entry = tree.dirs.get(relDir)
    if (entry == null) return
    const indent = '  '.repeat(depth + 1)
    for (const child of entry.childDirs) {
      const childEntry = tree.dirs.get(child)
      lines.push(`${indent}${child.split('/').pop()}/  (${childEntry?.totalFiles ?? 0} files)`)
      renderDir(child, depth + 1)
    }
    // 只在浅层列文件，避免深层目录把页面撑爆
    if (depth <= 1) {
      for (const file of entry.files) {
        lines.push(`${indent}${file.relPath.split('/').pop()}`)
      }
    }
  }
  renderDir('', 0)
  lines.push('```', '')
  return {
    slug: WIKI_REPO_PAGE_SLUGS.structure,
    title: `${repoName} 目录结构`,
    kind: 'reference',
    summary: `仓库目录树（${tree.dirs.size} 个目录）`,
    body: lines.join('\n'),
  }
}

function renderStack(repoName: string, tree: WikiRepoScanTree): WikiRepoPageDraft {
  const lines: string[] = [
    `# ${repoName} 技术栈`,
    '',
    '本页由 Repo Wiki 扫描生成，可随代码变更重建。语言分布按文件数统计；' +
      '清单文件内容原样引用（截断到 4000 字符）。',
    '',
    '## 语言分布',
    '',
    '| 语言 | 文件数 |',
    '| --- | --- |',
  ]
  for (const item of tree.languages) {
    lines.push(`| ${item.language} | ${item.files} |`)
  }
  if (tree.manifests.length > 0) {
    lines.push('', '## 清单与配置', '')
    for (const relPath of tree.manifests) {
      const content = readManifest(tree.repoRoot, relPath)
      lines.push(`### \`${relPath}\``, '')
      if (content == null) {
        lines.push('（文件不可读）', '')
        continue
      }
      const ext = relPath.endsWith('.json')
        ? 'json'
        : relPath.endsWith('.yaml') || relPath.endsWith('.yml')
          ? 'yaml'
          : relPath.endsWith('.toml')
            ? 'toml'
            : 'text'
      lines.push('```' + ext, content.trimEnd(), '```', '')
    }
  }
  return {
    slug: WIKI_REPO_PAGE_SLUGS.stack,
    title: `${repoName} 技术栈`,
    kind: 'reference',
    summary: `语言分布与构建配置（${tree.languages.length} 种语言 / ${tree.manifests.length} 个清单）`,
    body: lines.join('\n'),
  }
}

function renderModule(repoName: string, dir: string, tree: WikiRepoScanTree): WikiRepoPageDraft {
  const entry = tree.dirs.get(dir)
  const lines: string[] = [
    `# ${repoName} / ${dir}`,
    '',
    '本页由 Repo Wiki 扫描生成，可随代码变更重建。',
    '',
  ]
  if (entry == null) {
    lines.push('（扫描时该目录不可读）', '')
  } else {
    lines.push(
      '## 概览',
      '',
      `- 文件总数：${entry.totalFiles}`,
      `- 代码体积：${formatBytes(entry.totalBytes)}`,
      `- 直接子目录：${entry.childDirs.length} 个`,
      `- 直接文件：${entry.files.length} 个`,
      '',
    )
    if (entry.childDirs.length > 0) {
      lines.push('## 子目录', '', '| 目录 | 文件数 | 体积 |', '| --- | --- | --- |')
      for (const child of entry.childDirs) {
        const childEntry = tree.dirs.get(child)
        lines.push(
          `| \`${child.split('/').pop()}/\` | ${childEntry?.totalFiles ?? 0} | ${formatBytes(childEntry?.totalBytes ?? 0)} |`,
        )
      }
      lines.push('')
    }
    // 本目录语言分布（只统计本目录直接文件）
    const byLanguage = new Map<string, number>()
    for (const file of entry.files) {
      byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1)
    }
    if (byLanguage.size > 0) {
      lines.push('## 本目录语言', '')
      for (const [language, count] of [...byLanguage.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )) {
        lines.push(`- ${language}：${count}`)
      }
      lines.push('')
    }
    // 入口候选：根级常见入口名
    const entryCandidates = entry.files
      .filter((f) =>
        /^(index|main|mod|app|server|cli)\.[a-z]+$/.test(f.relPath.split('/').pop() ?? ''),
      )
      .map((f) => f.relPath)
    if (entryCandidates.length > 0) {
      lines.push('## 可能的入口', '', ...entryCandidates.map((p) => `- \`${p}\``), '')
    }
  }
  return {
    slug: WIKI_REPO_PAGE_SLUGS.module(dir),
    title: `${repoName} / ${dir}`,
    kind: 'reference',
    summary: entry == null ? '模块扫描结果不可用' : `模块结构（${entry.totalFiles} 个文件）`,
    body: lines.join('\n'),
  }
}
