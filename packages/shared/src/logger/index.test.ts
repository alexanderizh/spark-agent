import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createLogger,
  initFileLogger,
  readLogTail,
  clearLogFile,
  getLogInfo,
  setLogLevel,
  setDebugNamespaces,
  getDebugNamespaces,
  getLogLevel,
} from './index.js'

describe('shared logger file logging', () => {
  let dir: string

  beforeEach(() => {
    // 每个用例独立临时目录，避免互相干扰
    dir = mkdtempSync(join(tmpdir(), 'spark-log-'))
    setLogLevel('debug')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    // 文件 logger 指向的是上面的临时目录，目录已删；下一轮用例会重新 init
    // D-14：重置 namespace 白名单，避免影响其它用例
    setDebugNamespaces(null)
    setLogLevel('debug')
  })

  it('filters messages below the configured log level', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createLogger('test')

    setLogLevel('warn')

    log.debug('debug message')
    log.info('info message')
    log.warn('warn message')
    log.error('error message')

    expect(debug).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('writes log lines to main.log and reads them back', () => {
    initFileLogger(dir)
    const log = createLogger('ns')
    // 屏蔽 console，避免测试输出噪音
    vi.spyOn(console, 'info').mockImplementation(() => {})

    log.info('hello world')

    const lines = readLogTail(100)
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('[INFO]')
    expect(lines[0]).toContain('[ns]')
    expect(lines[0]).toContain('hello world')
  })

  it('redacts secrets embedded in the primary log message', () => {
    initFileLogger(dir)
    const log = createLogger('security')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    log.warn(
      'request failed Authorization: Bearer abcdefghijklmnopqrstuvwxyz token=plain-secret sk-abcdefghijklmnopqrstuvwxyz',
    )

    const output = readLogTail(10).join('\n')
    expect(output).toContain('Authorization: [redacted]')
    expect(output).toContain('token=[redacted]')
    expect(output).toContain('sk-[redacted]')
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(output).not.toContain('plain-secret')
  })

  it('respects log level: debug messages filtered when level is warn', () => {
    initFileLogger(dir)
    const log = createLogger('ns')
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    setLogLevel('warn')
    log.debug('should not be written')
    log.warn('should be written')

    const lines = readLogTail(100)
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('should be written')
  })

  it('readLogTail supports level filter', () => {
    initFileLogger(dir)
    const log = createLogger('ns')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    log.info('an info line')
    log.error('an error line')

    expect(readLogTail(100, ['error']).length).toBe(1)
    expect(readLogTail(100, ['error'])[0]).toContain('an error line')
  })

  it('readLogTail supports namespace prefix filter', () => {
    initFileLogger(dir)
    const canvasTaskLog = createLogger('canvas:task')
    const canvasRuntimeLog = createLogger('canvas:media-task-runtime')
    const unrelatedLog = createLogger('session')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    canvasTaskLog.info('event=submitted clientTaskId=canvas_task_1')
    canvasRuntimeLog.info('media task started')
    unrelatedLog.info('chat turn started')

    const lines = readLogTail(100, undefined, { namespacePrefixes: ['canvas:'] })
    expect(lines).toHaveLength(2)
    expect(lines.every((line) => line.includes('[canvas:'))).toBe(true)
  })

  it('clearLogFile empties the current log file', () => {
    initFileLogger(dir)
    const log = createLogger('ns')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    log.info('something')

    expect(readLogTail(100).length).toBe(1)
    expect(clearLogFile()).toBe(true)
    expect(readLogTail(100).length).toBe(0)
  })

  it('getLogInfo returns path and size', () => {
    initFileLogger(dir)
    const log = createLogger('ns')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    log.info('x')

    const info = getLogInfo()
    expect(info).not.toBeNull()
    expect(info!.filePath).toBe(join(dir, 'main.log'))
    expect(info!.sizeBytes).toBeGreaterThan(0)
    expect(existsSync(info!.filePath)).toBe(true)
  })

  it('rotates when the file exceeds maxSizeBytes', () => {
    // 用极小阈值快速触发轮转
    initFileLogger(dir, { maxSizeBytes: 120, maxFiles: 3 })
    const log = createLogger('rot')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    // 写入足够多行，确保超过 120 字节并触发 main.log -> main.1.log
    for (let i = 0; i < 40; i++) {
      log.info(`rotation-test-line-${i}`)
    }

    // main.1.log 应当存在（轮转产物）
    expect(existsSync(join(dir, 'main.1.log'))).toBe(true)
    // 轮转后下一条日志应重建 main.log
    log.info('after-rotation')
    expect(existsSync(join(dir, 'main.log'))).toBe(true)
    const current = readFileSync(join(dir, 'main.log'), 'utf8')
    expect(current).toContain('after-rotation')
  })

  describe('D-14: namespace-aware debug filtering', () => {
    it('setDebugNamespaces / getDebugNamespaces round-trip', () => {
      expect(getDebugNamespaces()).toBeNull()
      setDebugNamespaces(['session.service', 'memory'])
      expect(getDebugNamespaces()).toEqual(['session.service', 'memory'])
      setDebugNamespaces(null)
      expect(getDebugNamespaces()).toBeNull()
    })

    it('suppresses debug for namespaces not in the whitelist', () => {
      setLogLevel('debug')
      setDebugNamespaces(['session.service'])
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      createLogger('memory:reader').debug('should be filtered')
      createLogger('session.service:turn').debug('should pass')

      const calls = debugSpy.mock.calls.map((c) => String(c[0]))
      expect(calls.some((l) => l.includes('should be filtered'))).toBe(false)
      expect(calls.some((l) => l.includes('should pass'))).toBe(true)

      debugSpy.mockRestore()
    })

    it('does NOT filter info/warn/error (only debug is namespaced)', () => {
      setLogLevel('debug')
      setDebugNamespaces(['session.service'])
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createLogger('memory:reader').info('info should pass')

      const calls = infoSpy.mock.calls.map((c) => String(c[0]))
      expect(calls.some((l) => l.includes('info should pass'))).toBe(true)

      infoSpy.mockRestore()
    })

    it('empty array is treated as no filter', () => {
      setDebugNamespaces([])
      expect(getDebugNamespaces()).toBeNull()
    })

    it('getLogLevel reflects setLogLevel', () => {
      setLogLevel('warn')
      expect(getLogLevel()).toBe('warn')
      setLogLevel('error')
      expect(getLogLevel()).toBe('error')
    })
  })
})
