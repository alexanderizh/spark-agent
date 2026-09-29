/**
 * Repo Wiki 扫描树测试（S4）—— 忽略规则、遍历稳定性、截断如实回报。
 *
 * 重点验证「可重建」的三道前提：
 *   1. 忽略规则按 .gitignore 心智模型工作（裸名命中任意层级、通配符按 glob）；
 *   2. 遍历顺序稳定（同内容两次扫描逐字节一致）；
 *   3. 达到上限时 truncated=true 且 scannedFiles 如实计数（不静默少扫）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import {
  compileIgnoreRules,
  globToRegExp,
  scanRepoTree,
  formatBytes,
  WIKI_REPO_DEFAULT_IGNORE,
} from './wiki-repo-scan-tree.js'

describe('wiki-repo-scan-tree', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-repo-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function write(relPath: string, content = 'x'): void {
    const abs = join(dir, relPath)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf-8')
  }

  describe('globToRegExp', () => {
    it('* 不跨目录、** 跨目录、? 单字符', () => {
      expect(globToRegExp('*.ts').test('a.ts')).toBe(true)
      expect(globToRegExp('*.ts').test('src/a.ts')).toBe(false)
      expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true)
      expect(globToRegExp('src/**/*.ts').test('src/deep/nested/a.ts')).toBe(true)
      expect(globToRegExp('src/**').test('src/a/b')).toBe(true)
      expect(globToRegExp('a?c.ts').test('abc.ts')).toBe(true)
      expect(globToRegExp('a?c.ts').test('a/c.ts')).toBe(false)
    })

    it('正则元字符被转义（不误伤文件名里的 . + 等）', () => {
      expect(globToRegExp('a+b.ts').test('a+b.ts')).toBe(true)
      expect(globToRegExp('a.b').test('axb')).toBe(false)
    })
  })

  describe('compileIgnoreRules', () => {
    it('裸名命中任意层级（node_modules 下的深层文件同样忽略）', () => {
      const ignored = compileIgnoreRules(['node_modules'])
      expect(ignored('node_modules', true)).toBe(true)
      expect(ignored('packages/a/node_modules/x/index.js', false)).toBe(true)
      expect(ignored('src/index.ts', false)).toBe(false)
    })

    it('空行与 # 注释被跳过（不产生永不命中的规则）', () => {
      const ignored = compileIgnoreRules(['', '  ', '# comment'])
      expect(ignored('src/index.ts', false)).toBe(false)
    })

    it('尾斜杠只匹配目录', () => {
      const ignored = compileIgnoreRules(['dist/'])
      expect(ignored('dist', true)).toBe(true)
      expect(ignored('dist', false)).toBe(false)
    })

    it('通配符按 glob 匹配并覆盖后代（无斜杠 = 任意层级）', () => {
      const ignored = compileIgnoreRules(['*.log'])
      expect(ignored('debug.log', false)).toBe(true)
      expect(ignored('logs/debug.log', false)).toBe(true)
      expect(ignored('a/b/c/debug.log', false)).toBe(true)
      expect(ignored('debug.log.gz', false)).toBe(false)
    })

    it('/ 开头只匹配仓库根（/foo 不命中 a/foo）', () => {
      const ignored = compileIgnoreRules(['/foo'])
      expect(ignored('foo', false)).toBe(true)
      expect(ignored('a/foo', false)).toBe(false)
    })

    it('含斜杠的模式从仓库根匹配', () => {
      const ignored = compileIgnoreRules(['src/gen'])
      expect(ignored('src/gen', true)).toBe(true)
      expect(ignored('src/gen/a.ts', false)).toBe(true)
      expect(ignored('other/src/gen', true)).toBe(false)
    })
  })

  describe('scanRepoTree', () => {
    it('默认忽略 node_modules / dist / .git', () => {
      write('src/index.ts')
      write('node_modules/pkg/index.js')
      write('dist/bundle.js')
      write('.git/config')
      const tree = scanRepoTree(dir)
      expect(tree.files.map((f) => f.relPath)).toEqual(['src/index.ts'])
    })

    it('目录与文件统计自底向上汇总正确', () => {
      write('src/a/one.ts', 'aaaa')
      write('src/a/two.ts', 'bb')
      write('src/b/three.ts', 'cc')
      write('README.md', 'hello')
      const tree = scanRepoTree(dir)
      expect(tree.topDirs).toEqual(['src'])
      expect(tree.dirs.get('')?.totalFiles).toBe(4)
      expect(tree.dirs.get('src')?.totalFiles).toBe(3)
      expect(tree.dirs.get('src/a')?.totalFiles).toBe(2)
      expect(tree.dirs.get('src/a')?.totalBytes).toBe(6)
    })

    it('语言按扩展名识别并降序排列', () => {
      write('a.ts')
      write('b.ts')
      write('c.py')
      write('d.unknownext')
      const tree = scanRepoTree(dir)
      expect(tree.languages[0]).toEqual({ language: 'TypeScript', files: 2 })
      expect(tree.languages.map((l) => l.language)).toContain('Python')
      expect(tree.languages.map((l) => l.language)).toContain('Other')
    })

    it('仓库根的清单文件被收集（render 层据此生成技术栈页）', () => {
      write('package.json', '{}')
      write('tsconfig.json', '{}')
      write('src/package.json', '{}')
      const tree = scanRepoTree(dir)
      expect(tree.manifests.sort()).toEqual(['package.json', 'tsconfig.json'])
    })

    it('同一内容两次扫描逐字节一致（rebuild 幂等前提）', () => {
      write('src/index.ts', 'export const a = 1')
      write('src/util/helper.ts', 'export const b = 2')
      write('README.md', '# demo')
      const first = scanRepoTree(dir)
      const second = scanRepoTree(dir)
      expect(second.files).toEqual(first.files)
      expect(second.topDirs).toEqual(first.topDirs)
      expect(second.languages).toEqual(first.languages)
      expect(second.dirs.get('')?.totalBytes).toBe(first.dirs.get('')?.totalBytes)
    })

    it('达到 maxFiles 时 truncated=true 且 scannedFiles 如实计数', () => {
      for (let i = 0; i < 10; i += 1) write(`f${i}.ts`)
      const tree = scanRepoTree(dir, { maxFiles: 3 })
      expect(tree.files).toHaveLength(3)
      expect(tree.truncated).toBe(true)
      expect(tree.scannedFiles).toBe(10)
    })

    it('不可读目录被跳过而不抛断整次扫描', () => {
      write('src/index.ts')
      // 指向不存在路径的符号链接：readdirSync 抛错，应被吞掉
      try {
        symlinkSync(join(dir, 'nope'), join(dir, 'broken-link'), 'dir')
      } catch {
        return // 平台不支持时跳过本断言
      }
      expect(() => scanRepoTree(dir)).not.toThrow()
      expect(scanRepoTree(dir).files.map((f) => f.relPath)).toEqual(['src/index.ts'])
    })
  })

  describe('formatBytes', () => {
    it('按量级切换单位', () => {
      expect(formatBytes(512)).toBe('512 B')
      expect(formatBytes(2048)).toBe('2.0 KiB')
      expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB')
    })
  })

  it('默认忽略集合覆盖方案 §12 D 组的重目录', () => {
    expect(WIKI_REPO_DEFAULT_IGNORE).toEqual(
      expect.arrayContaining(['node_modules', 'dist', 'build', 'out', '.git']),
    )
  })
})
