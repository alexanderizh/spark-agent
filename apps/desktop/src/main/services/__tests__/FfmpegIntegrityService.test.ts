import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 源模块顶层 `import { app } from 'electron'` 在加载时执行；
// 本测试用 rootOverride 注入 tmp 目录，不依赖 app.getPath 的真实返回，
// 此 mock 仅让模块在 vitest 下能成功加载。
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'spark-ffmpeg-test-fallback') },
}))

import {
  cleanupOldFfmpegDirs,
  compareVersionTuples,
  parseVersionTuple,
  resolveManagedBinaryDir,
} from '../FfmpegIntegrityService'

// 测试运行平台的 ffmpeg 可执行文件名（darwin/linux: ffmpeg; win32: ffmpeg.exe）
const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-ffmpeg-test-'))
  roots.push(root)
  return root
}

/** 在 root 下建一个含 ffmpeg 可执行文件的目录，返回目录绝对路径。 */
async function makeFfmpegDir(root: string, dirName: string): Promise<string> {
  const dir = join(root, dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, exe), '') // 0 字节占位（resolveManagedBinaryDir 只查存在性）
  return dir
}

describe('parseVersionTuple', () => {
  it('解析 sanitize 后的 ffmpeg 目录名版本号', () => {
    expect(parseVersionTuple('FFmpeg-8.1.2-Windows-x64')).toEqual([8, 1, 2])
    expect(parseVersionTuple('FFmpeg-4.1-Windows-x64')).toEqual([4, 1])
    expect(parseVersionTuple('ffmpeg-7.0.2-linux-x64')).toEqual([7, 0, 2])
    expect(parseVersionTuple('FFmpeg-7.1.1-macOS-Apple-Silicon')).toEqual([7, 1, 1])
  })

  it('无法识别时返回 null', () => {
    expect(parseVersionTuple('some-random-dir')).toBeNull()
    expect(parseVersionTuple('')).toBeNull()
    expect(parseVersionTuple(null)).toBeNull()
    expect(parseVersionTuple(undefined)).toBeNull()
  })
})

describe('compareVersionTuples', () => {
  it('高版本排前（降序）', () => {
    expect(compareVersionTuples([8, 1, 2], [4, 1])).toBeLessThan(0)
    expect(compareVersionTuples([4, 1], [8, 1, 2])).toBeGreaterThan(0)
    expect(compareVersionTuples([7, 1, 1], [7, 1, 1])).toBe(0)
    // 位数不同时按高位比较，缺失位补 0
    expect(compareVersionTuples([7, 1], [7, 1, 0])).toBe(0)
    expect(compareVersionTuples([7, 1, 1], [7, 1])).toBeLessThan(0)
  })

  it('null（版本未知）永远排最后', () => {
    expect(compareVersionTuples(null, [4, 1])).toBeGreaterThan(0)
    expect(compareVersionTuples([4, 1], null)).toBeLessThan(0)
    expect(compareVersionTuples(null, null)).toBe(0)
  })
})

describe('resolveManagedBinaryDir', () => {
  it('多个 ffmpeg 目录时选版本最高的', async () => {
    const root = await newRoot()
    const oldDir = await makeFfmpegDir(root, 'FFmpeg-4.1-Windows-x64')
    const newDir = await makeFfmpegDir(root, 'FFmpeg-8.1.2-Windows-x64')
    // 故意让旧目录先创建，验证不是靠 readdir 顺序
    expect(resolveManagedBinaryDir(root)).toBe(newDir)
    expect(resolveManagedBinaryDir(root)).not.toBe(oldDir)
  })

  it('只有一个 ffmpeg 目录时返回它', async () => {
    const root = await newRoot()
    const dir = await makeFfmpegDir(root, 'FFmpeg-7.1.1-macOS-Apple-Silicon')
    expect(resolveManagedBinaryDir(root)).toBe(dir)
  })

  it('没有任何 ffmpeg 目录时返回 null', async () => {
    const root = await newRoot()
    expect(resolveManagedBinaryDir(root)).toBeNull()
  })

  it('目录名含 ffmpeg 但缺少 ffmpeg 可执行文件时跳过', async () => {
    const root = await newRoot()
    // 半残目录：名字含 ffmpeg 但里面没有 ffmpeg 可执行
    await mkdir(join(root, 'FFmpeg-4.1-Windows-x64'), { recursive: true })
    await writeFile(join(root, 'FFmpeg-4.1-Windows-x64', 'README.txt'), 'incomplete')
    const goodDir = await makeFfmpegDir(root, 'FFmpeg-8.1.2-Windows-x64')
    expect(resolveManagedBinaryDir(root)).toBe(goodDir)
  })

  it('root 不存在时返回 null', () => {
    expect(resolveManagedBinaryDir(join(tmpdir(), 'spark-ffmpeg-nonexistent-' + Date.now()))).toBeNull()
  })
})

describe('cleanupOldFfmpegDirs', () => {
  it('删除旧 ffmpeg 目录，保留 keepDir，不动非 ffmpeg 目录', async () => {
    const root = await newRoot()
    const oldDir = await makeFfmpegDir(root, 'FFmpeg-4.1-Windows-x64')
    const keepDir = await makeFfmpegDir(root, 'FFmpeg-8.1.2-Windows-x64')
    // 非 ffmpeg 产物目录（codex runtime 等）必须保留
    const codexDir = join(root, 'codex-runtime-0.144.5')
    await mkdir(codexDir, { recursive: true })
    await writeFile(join(codexDir, 'codex.exe'), '')

    await cleanupOldFfmpegDirs(keepDir, root)

    const { existsSync } = await import('node:fs')
    expect(existsSync(oldDir)).toBe(false) // 旧 ffmpeg 目录已删
    expect(existsSync(keepDir)).toBe(true) // 当前目录保留
    expect(existsSync(codexDir)).toBe(true) // 非 ffmpeg 目录不动
  })

  it('只有一个 ffmpeg 目录（即 keepDir）时不删除任何东西', async () => {
    const root = await newRoot()
    const keepDir = await makeFfmpegDir(root, 'FFmpeg-8.1.2-Windows-x64')

    await cleanupOldFfmpegDirs(keepDir, root)

    const { existsSync } = await import('node:fs')
    expect(existsSync(keepDir)).toBe(true)
  })

  it('不逃出 root 边界（keepDir 在 root 之外时不误删）', async () => {
    const root = await newRoot()
    const insideDir = await makeFfmpegDir(root, 'FFmpeg-8.1.2-Windows-x64')
    // keepDir 指向 root 之外的某个 ffmpeg 目录
    const outsideRoot = await newRoot()
    const outsideKeep = await makeFfmpegDir(outsideRoot, 'FFmpeg-9.0.0-Outside')

    await cleanupOldFfmpegDirs(outsideKeep, root)

    const { existsSync } = await import('node:fs')
    // root 内的 ffmpeg 目录因不等于 keepDir 且在 root 下，会被清理；
    // root 之外的 outsideKeep 不受影响（不在 root 扫描范围内）
    expect(existsSync(insideDir)).toBe(false)
    expect(existsSync(outsideKeep)).toBe(true)
  })
})
