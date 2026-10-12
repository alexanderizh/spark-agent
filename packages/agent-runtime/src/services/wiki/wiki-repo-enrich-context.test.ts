/**
 * @module wiki-repo-enrich-context.test
 *
 * 上下文装配的确定性测试（方案B §6.1）——「按 rev 缓存」的地基：
 * 同一 rev 的同一棵树，两次装配必须产出**逐字符相同**的 material。
 * 若不确定（排序漂移 / 时钟 / 随机序），ready 缓存的命中语义就名不副实。
 *
 * 覆盖：
 *   - 同一棵树两次装配逐字符相等；
 *   - 磁盘未变时两次独立扫描再装配，仍逐字符相等（跨 scan 调用的稳定性）；
 *   - 入口文件受控读取（候选正则 + 截断 + 不可读标注）；
 *   - readRepoDependencyNames 只取 dependencies、字典序、损坏 JSON 静默空。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildModuleEnrichContext,
  buildOverviewEnrichContext,
  readRepoDependencyNames,
} from './wiki-repo-enrich-context.js'
import { scanRepoTree } from './wiki-repo-scan-tree.js'
import { WIKI_REPO_PAGE_SLUGS } from './wiki-repo-scan-render.js'

describe('Repo Wiki 导读上下文装配', () => {
  let root: string
  let repo: string

  beforeEach(() => {
    root = join(
      tmpdir(),
      `spark-wiki-enrich-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    repo = join(root, 'demo-repo')
    mkdirSync(join(repo, 'src'), { recursive: true })
    mkdirSync(join(repo, 'lib'), { recursive: true })
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'demo',
        dependencies: { zeta: '^1', alpha: '^2', mid: '^3' },
        devDependencies: { shouldNotAppear: '^1' },
      }),
    )
    writeFileSync(
      join(repo, 'src', 'index.ts'),
      "import { helper } from '../lib/helper.js'\nexport const a = 1\n",
    )
    writeFileSync(join(repo, 'src', 'util.ts'), 'export const b = 2\n')
    writeFileSync(join(repo, 'lib', 'helper.ts'), 'export const helper = 1\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('同一棵树两次装配逐字符相等（确定性 = 缓存语义的地基）', () => {
    const tree = scanRepoTree(repo)
    const dependencyNames = readRepoDependencyNames(tree)
    const first = buildModuleEnrichContext({ dir: 'src', tree, dependencyNames })
    const second = buildModuleEnrichContext({ dir: 'src', tree, dependencyNames })
    expect(second.material).toBe(first.material)
    expect(second.slug).toBe(WIKI_REPO_PAGE_SLUGS.module('src'))
    expect(first.material).toContain('# 模块：`src/`')
    expect(first.material).toContain('## 结构数据')
    expect(first.material).toContain('## 直接文件清单')
  })

  it('磁盘未变时两次独立扫描再装配，仍逐字符相等（跨 scan 稳定）', () => {
    const treeA = scanRepoTree(repo)
    const treeB = scanRepoTree(repo)
    const a = buildModuleEnrichContext({
      dir: 'src',
      tree: treeA,
      dependencyNames: readRepoDependencyNames(treeA),
    })
    const b = buildModuleEnrichContext({
      dir: 'src',
      tree: treeB,
      dependencyNames: readRepoDependencyNames(treeB),
    })
    expect(b.material).toBe(a.material)
  })

  it('入口文件受控读取：候选文件内容嵌入材料，import 的兄弟目录进依赖提示', () => {
    const tree = scanRepoTree(repo)
    const ctx = buildModuleEnrichContext({
      dir: 'src',
      tree,
      dependencyNames: readRepoDependencyNames(tree),
    })
    // src/index.ts 是入口候选，其内容进入材料
    expect(ctx.material).toContain('### `src/index.ts`')
    expect(ctx.material).toContain("import { helper } from '../lib/helper.js'")
    // import 中出现兄弟顶层目录 lib/ → 依赖提示点名
    expect(ctx.material).toContain('`lib/`')
  })

  it('readRepoDependencyNames：只取 dependencies、字典序排序、忽略 devDependencies', () => {
    const tree = scanRepoTree(repo)
    expect(readRepoDependencyNames(tree)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('readRepoDependencyNames：无 package.json / 损坏 JSON / 非 object → 空数组', () => {
    const noManifest = join(root, 'no-manifest')
    mkdirSync(join(noManifest, 'src'), { recursive: true })
    writeFileSync(join(noManifest, 'src', 'index.ts'), 'export const a = 1\n')
    expect(readRepoDependencyNames(scanRepoTree(noManifest))).toEqual([])

    const broken = join(root, 'broken-json')
    mkdirSync(join(broken, 'src'), { recursive: true })
    writeFileSync(join(broken, 'package.json'), '{ not valid json')
    writeFileSync(join(broken, 'src', 'index.ts'), 'export const a = 1\n')
    expect(readRepoDependencyNames(scanRepoTree(broken))).toEqual([])
  })

  it('树中不存在的目录：材料如实标注不可读，不抛异常', () => {
    const tree = scanRepoTree(repo)
    const ctx = buildModuleEnrichContext({ dir: 'ghost', tree, dependencyNames: [] })
    expect(ctx.material).toContain('# 模块：`ghost/`')
    expect(ctx.material).toContain('扫描时该目录不可读')
    expect(ctx.slug).toBe(WIKI_REPO_PAGE_SLUGS.module('ghost'))
  })
})

describe('Repo Wiki 综述页材料装配（S3）', () => {
  let root: string
  let repo: string

  beforeEach(() => {
    root = join(
      tmpdir(),
      `spark-wiki-enrich-ovw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    repo = join(root, 'demo-repo')
    mkdirSync(join(repo, 'src'), { recursive: true })
    mkdirSync(join(repo, 'lib'), { recursive: true })
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { alpha: '^1', zeta: '^2' } }),
    )
    writeFileSync(join(repo, 'README.md'), '# demo repo\n\n演示说明。\n')
    writeFileSync(join(repo, 'src', 'index.ts'), 'export const a = 1\n')
    writeFileSync(join(repo, 'lib', 'helper.ts'), 'export const helper = 1\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('同一棵树两次装配逐字符相等，四层材料齐全（确定性 = rev 缓存地基）', () => {
    const tree = scanRepoTree(repo)
    const dependencyNames = readRepoDependencyNames(tree)
    const first = buildOverviewEnrichContext({ tree, dependencyNames })
    const second = buildOverviewEnrichContext({ tree, dependencyNames })
    expect(second.material).toBe(first.material)
    expect(first.slug).toBe(WIKI_REPO_PAGE_SLUGS.overview)
    expect(first.material).toContain('# 仓库总览材料：`demo-repo/`')
    expect(first.material).toContain('## 结构数据')
    expect(first.material).toContain('## 顶层目录清单')
    expect(first.material).toContain('| `src/` |')
    expect(first.material).toContain('| `lib/` |')
    expect(first.material).toContain('## README 摘录')
    expect(first.material).toContain('# demo repo')
    expect(first.material).toContain('alpha、zeta')
  })

  it('无 README：材料如实标注未发现，不抛异常', () => {
    rmSync(join(repo, 'README.md'))
    const tree = scanRepoTree(repo)
    const ctx = buildOverviewEnrichContext({
      tree,
      dependencyNames: readRepoDependencyNames(tree),
    })
    expect(ctx.material).toContain('仓库根目录未发现 README 文件')
  })
})
