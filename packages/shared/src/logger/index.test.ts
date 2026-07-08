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
})
