/**
 * FileWatcherService 单测。
 *
 * 1. 引用计数生命周期：多个消费方（文件树 / Git 状态轮询 / 项目页）共享同一 watcher，
 *    任一方 stop 不得关闭底层监听，全部退出才真正关闭（只做状态断言，不依赖事件时序）。
 * 2. 删除事件映射：macOS/Linux 上创建与删除都报 fs.rename，服务必须按路径存在性
 *    产出 changeType='delete'（渲染端本地级联删除依赖它）。
 *    用注入的 watcher 回调和临时文件系统构造事件，避免依赖平台递归 watcher 资源。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionId } from '@spark/protocol'

// 拦截推送出口，捕获 stream:workspace:file-change 载荷（单测环境无 Electron 窗口）
const pushedPayloads: Array<{ channel: string; payload: Record<string, unknown> }> = []
vi.mock('../ipc/typed-ipc.js', () => ({
  pushStreamEvent: (channel: string, payload: Record<string, unknown>): void => {
    pushedPayloads.push({ channel, payload })
  },
}))

import {
  FileWatcherService,
  type FileWatcherEventListener,
  type FileWatcherFactory,
} from './FileWatcherService.js'

function createWatchHarness() {
  const watches: Array<{
    rootPath: string
    listener: FileWatcherEventListener
    close: ReturnType<typeof vi.fn>
  }> = []
  const watchFactory: FileWatcherFactory = (rootPath, listener) => {
    const close = vi.fn()
    watches.push({ rootPath, listener, close })
    return { close, on: vi.fn() } as never
  }
  return {
    watches,
    watchFactory,
    emit(rootPath: string, filename: string, eventType: 'rename' | 'change' = 'rename') {
      const watcher = watches.find((item) => item.rootPath === rootPath)
      if (watcher == null) throw new Error(`watcher not found for ${rootPath}`)
      watcher.listener(eventType, filename)
    },
  }
}

describe('FileWatcherService 引用计数', () => {
  let root: string
  const watchHarness = createWatchHarness()
  const service = new FileWatcherService(watchHarness.watchFactory)

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'spark-fwatch-'))
  })

  afterAll(() => {
    service.stopAll()
    rmSync(root, { recursive: true, force: true })
  })

  it('两次 start 共享同一 watcher，一次 stop 不关闭', () => {
    service.start('ws-a', root)
    expect(service.isWatching('ws-a')).toBe(true)

    service.start('ws-a', root)
    expect(service.isWatching('ws-a')).toBe(true)

    // 第一个消费方卸载：watcher 必须仍然存活（其他消费方还在用）
    const closed = service.stop('ws-a')
    expect(closed).toBe(false)
    expect(service.isWatching('ws-a')).toBe(true)

    // 最后一个消费方退出：真正关闭
    const closedFinal = service.stop('ws-a')
    expect(closedFinal).toBe(true)
    expect(service.isWatching('ws-a')).toBe(false)
  })

  it('无消费方时 stop 是幂等空操作', () => {
    expect(service.stop('ws-never')).toBe(false)
  })

  it('重启后计数重新从 1 开始', () => {
    service.start('ws-b', root)
    service.stop('ws-b')
    expect(service.isWatching('ws-b')).toBe(false)

    // 重新 start：新的一轮计数
    service.start('ws-b', root)
    expect(service.isWatching('ws-b')).toBe(true)
    service.stop('ws-b')
    expect(service.isWatching('ws-b')).toBe(false)
  })

  it('stopAll 无视引用计数，强制关闭所有底层 watcher', () => {
    service.start('ws-stop-all', root)
    service.start('ws-stop-all', root)
    expect(service.isWatching('ws-stop-all')).toBe(true)

    service.stopAll()

    expect(service.isWatching('ws-stop-all')).toBe(false)
    expect(watchHarness.watches.at(-1)?.close).toHaveBeenCalledTimes(1)
    expect(service.stop('ws-stop-all')).toBe(false)
  })

  it('同一 workspace 的不同 session 监听各自根目录并只收到对应事件', async () => {
    const rootA = mkdtempSync(join(tmpdir(), 'spark-fwatch-a-'))
    const rootB = mkdtempSync(join(tmpdir(), 'spark-fwatch-b-'))
    const watchHarness = createWatchHarness()
    const scopedService = new FileWatcherService(watchHarness.watchFactory)
    pushedPayloads.length = 0

    try {
      scopedService.start('ws-scoped', rootA, undefined, 'session-a' as SessionId)
      scopedService.start('ws-scoped', rootB, undefined, 'session-b' as SessionId)
      writeFileSync(join(rootA, 'only-a.txt'), 'a')
      watchHarness.emit(rootA, 'only-a.txt')

      await vi.waitFor(
        () => {
          const event = pushedPayloads.find(
            (item) => item.payload.path === 'only-a.txt' && item.payload.sessionId === 'session-a',
          )
          if (event == null) throw new Error('session-a event not seen yet')
        },
        { timeout: 5_000, interval: 50 },
      )

      expect(
        pushedPayloads.some(
          (item) => item.payload.path === 'only-a.txt' && item.payload.sessionId === 'session-b',
        ),
      ).toBe(false)
      expect(scopedService.stop('ws-scoped', 'session-a' as SessionId)).toBe(true)
      expect(scopedService.isWatching('ws-scoped')).toBe(true)
      expect(scopedService.stop('ws-scoped', 'session-b' as SessionId)).toBe(true)
    } finally {
      scopedService.stopAll()
      rmSync(rootA, { recursive: true, force: true })
      rmSync(rootB, { recursive: true, force: true })
    }
  })

  it('共享同一物理根目录时向每个仍订阅的 session 分发事件', async () => {
    const sharedRoot = mkdtempSync(join(tmpdir(), 'spark-fwatch-shared-'))
    const watchHarness = createWatchHarness()
    const scopedService = new FileWatcherService(watchHarness.watchFactory)
    pushedPayloads.length = 0

    try {
      scopedService.start('ws-shared', sharedRoot, undefined, 'session-a' as SessionId)
      scopedService.start('ws-shared', sharedRoot, undefined, 'session-b' as SessionId)
      writeFileSync(join(sharedRoot, 'shared.txt'), 'shared')
      expect(watchHarness.watches).toHaveLength(1)
      watchHarness.emit(sharedRoot, 'shared.txt')

      await vi.waitFor(
        () => {
          const sessionIds = new Set(
            pushedPayloads
              .filter((item) => item.payload.path === 'shared.txt')
              .map((item) => item.payload.sessionId),
          )
          if (!sessionIds.has('session-a') || !sessionIds.has('session-b')) {
            throw new Error('both session events not seen yet')
          }
        },
        { timeout: 5_000, interval: 50 },
      )

      expect(scopedService.stop('ws-shared', 'session-a' as SessionId)).toBe(false)
      expect(scopedService.stop('ws-shared', 'session-b' as SessionId)).toBe(true)
    } finally {
      scopedService.stopAll()
      rmSync(sharedRoot, { recursive: true, force: true })
    }
  })
})

describe('FileWatcherService 删除事件映射', () => {
  it('目录移出监视树推送 delete，新建推送 create', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-fwatch-ev-'))
    const watchHarness = createWatchHarness()
    const service = new FileWatcherService(watchHarness.watchFactory)
    pushedPayloads.length = 0

    try {
      service.start('ws-ev', root)

      // ① 新建目录 → create
      const dir = join(root, 'victim-dir')
      mkdirSync(dir)
      watchHarness.emit(root, 'victim-dir')

      // ② 目录移出监视树（模拟 shell.trashItem 语义）→ delete
      const outside = join(tmpdir(), `spark-fwatch-out-${Date.now()}`)
      let deleted: unknown
      try {
        await vi.waitFor(
          () => {
            const hit = pushedPayloads.find(
              (p) =>
                p.channel === 'stream:workspace:file-change' && p.payload.path === 'victim-dir',
            )
            if (hit == null) throw new Error('create event not seen yet')
            deleted = hit.payload.changeType
          },
          { timeout: 5_000, interval: 50 },
        )
      } finally {
        renameSync(dir, outside)
        watchHarness.emit(root, 'victim-dir')
      }
      expect(deleted).toBe('create')

      await vi.waitFor(
        () => {
          const hit = pushedPayloads.find(
            (p) =>
              p.channel === 'stream:workspace:file-change' &&
              p.payload.path === 'victim-dir' &&
              p.payload.changeType === 'delete',
          )
          if (hit == null) throw new Error('delete event not seen yet')
        },
        { timeout: 5_000, interval: 50 },
      )

      rmSync(outside, { recursive: true, force: true })
    } finally {
      service.stopAll()
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)
})
