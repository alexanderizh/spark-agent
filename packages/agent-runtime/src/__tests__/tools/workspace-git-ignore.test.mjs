import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { ensureWorkspaceManagedDirIgnored } from '../../tools/workspace-git-ignore.mjs'

function makeTempDir() {
  return mkdtempSync(path.join(tmpdir(), 'spark-git-ignore-'))
}

function readExclude(repoRoot) {
  return readFileSync(path.join(repoRoot, '.git', 'info', 'exclude'), 'utf8')
}

describe('ensureWorkspaceManagedDirIgnored', () => {
  it('标准仓库：工作区即仓库根，追加目录条目到 .git/info/exclude', () => {
    const repo = makeTempDir()
    mkdirSync(path.join(repo, '.git', 'info'), { recursive: true })

    ensureWorkspaceManagedDirIgnored(repo, ['.spark-agent', 'tool-results'])

    const content = readExclude(repo)
    expect(content).toContain('.spark-agent/tool-results/')
    expect(content).toContain('# Spark Work')
    // 幂等：同一路径二次调用不重复追加（进程内缓存）。
    ensureWorkspaceManagedDirIgnored(repo, ['.spark-agent', 'tool-results'])
    expect(readExclude(repo)).toBe(content)
  })

  it('工作区是仓库子目录：条目带相对前缀，不影响仓库其他路径', () => {
    const repo = makeTempDir()
    mkdirSync(path.join(repo, '.git', 'info'), { recursive: true })
    const nested = path.join(repo, 'packages', 'demo')
    mkdirSync(nested, { recursive: true })

    ensureWorkspaceManagedDirIgnored(nested, ['.spark-artifacts'])

    const content = readExclude(repo)
    expect(content).toContain('packages/demo/.spark-artifacts/')
    expect(content).not.toContain('\n.spark-artifacts/')
  })

  it('.git 文件 + commondir（linked worktree 形态）：写入共享 common dir 的 exclude', () => {
    const mainRepo = makeTempDir()
    const commonGit = path.join(mainRepo, '.git')
    mkdirSync(path.join(commonGit, 'info'), { recursive: true })
    // worktree 放在独立 tmp 目录，避免被主仓库目录包含。
    const sibling = makeTempDir()
    const worktree = path.join(sibling, 'wt')
    mkdirSync(worktree, { recursive: true })
    const worktreeGitDir = path.join(commonGit, 'worktrees', 'wt')
    mkdirSync(worktreeGitDir, { recursive: true })
    writeFileSync(path.join(worktree, '.git'), `gitdir: ${worktreeGitDir}\n`, 'utf8')
    // 真实 git 中 commondir 相对 gitdir 解析：worktrees/wt 回到主 .git 需两级。
    writeFileSync(path.join(worktreeGitDir, 'commondir'), '../..', 'utf8')

    ensureWorkspaceManagedDirIgnored(worktree, ['.spark-agent', 'sub-app-sources'])

    // commondir 相对 gitdir 解析回主仓库 .git，exclude 写在共享侧且条目以 worktree 根为基准。
    const content = readExclude(mainRepo)
    expect(content).toContain('.spark-agent/sub-app-sources/')
    // worktree 自身 gitdir 不落 exclude。
    expect(existsSync(path.join(worktreeGitDir, 'info', 'exclude'))).toBe(false)
  })

  it('.git 文件无 commondir（submodule 形态）：写入模块 gitdir 的 exclude', () => {
    const outer = makeTempDir()
    const submodule = path.join(outer, 'vendor', 'lib')
    mkdirSync(submodule, { recursive: true })
    const moduleGitDir = path.join(outer, '.git', 'modules', 'vendor-lib')
    mkdirSync(moduleGitDir, { recursive: true })
    writeFileSync(path.join(submodule, '.git'), `gitdir: ${moduleGitDir}\n`, 'utf8')

    ensureWorkspaceManagedDirIgnored(submodule, ['.spark-artifacts'])

    const content = readFileSync(path.join(moduleGitDir, 'info', 'exclude'), 'utf8')
    // submodule 工作树（.git 文件所在目录）自身就是条目基准根，无相对前缀。
    expect(content).toContain('\n.spark-artifacts/')
  })

  it('已忽略去重：exclude 精确行 / 根 .gitignore 祖先条目均不再写入', () => {
    // 场景 A：exclude 已有精确条目（模拟另一进程写过）。
    const repoA = makeTempDir()
    mkdirSync(path.join(repoA, '.git', 'info'), { recursive: true })
    writeFileSync(
      path.join(repoA, '.git', 'info', 'exclude'),
      '.spark-agent/tool-results/\n',
      'utf8',
    )
    ensureWorkspaceManagedDirIgnored(repoA, ['.spark-agent', 'tool-results'])
    expect(readExclude(repoA)).toBe('.spark-agent/tool-results/\n')

    // 场景 B：用户在根 .gitignore 已写祖先目录条目（.spark-agent/）。
    const repoB = makeTempDir()
    mkdirSync(path.join(repoB, '.git', 'info'), { recursive: true })
    writeFileSync(path.join(repoB, '.gitignore'), '.spark-agent/\n', 'utf8')
    ensureWorkspaceManagedDirIgnored(repoB, ['.spark-agent', 'tool-results'])
    expect(existsSync(path.join(repoB, '.git', 'info', 'exclude'))).toBe(false)
  })

  it('非 git 目录与非法参数：静默跳过，不抛错、无副作用', () => {
    const plain = makeTempDir()
    expect(() => ensureWorkspaceManagedDirIgnored(plain, ['.spark-artifacts'])).not.toThrow()
    expect(existsSync(path.join(plain, '.spark-artifacts'))).toBe(false)

    expect(() => ensureWorkspaceManagedDirIgnored(plain, [])).not.toThrow()
    expect(() => ensureWorkspaceManagedDirIgnored('', ['.spark-artifacts'])).not.toThrow()
    expect(() => ensureWorkspaceManagedDirIgnored(plain, ['..'])).not.toThrow()
    // 工作区路径不存在。
    expect(() =>
      ensureWorkspaceManagedDirIgnored(path.join(plain, 'nope'), ['.spark-artifacts']),
    ).not.toThrow()
  })
})
