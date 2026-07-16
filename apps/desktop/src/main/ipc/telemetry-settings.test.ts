import { describe, expect, it } from 'vitest'
import { resolveTelemetryLogLevel } from './telemetry-settings.js'

describe('resolveTelemetryLogLevel', () => {
  it('defaults to info so canvas task lifecycle logs are persisted on a fresh install', () => {
    expect(resolveTelemetryLogLevel(null)).toBe('info')
    expect(resolveTelemetryLogLevel({})).toBe('info')
  })

  it('preserves an explicitly configured level', () => {
    expect(resolveTelemetryLogLevel({ logLevel: 'debug' })).toBe('debug')
    expect(resolveTelemetryLogLevel({ logLevel: 'error' })).toBe('error')
  })
})
