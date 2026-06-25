import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger, setLogLevel } from './index.js'

describe('shared logger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
})
