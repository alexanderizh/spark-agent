import { describe, expect, it } from 'vitest'
import { resolveTelemetryLogLevel } from './telemetry-settings.js'

describe('resolveTelemetryLogLevel', () => {
  it('defaults to warn so fresh installs do not persist request content', () => {
    expect(resolveTelemetryLogLevel(null)).toBe('warn')
    expect(resolveTelemetryLogLevel({})).toBe('warn')
  })

  it('preserves an explicitly configured level', () => {
    expect(resolveTelemetryLogLevel({ logLevel: 'debug' })).toBe('debug')
    expect(resolveTelemetryLogLevel({ logLevel: 'error' })).toBe('error')
  })
})
