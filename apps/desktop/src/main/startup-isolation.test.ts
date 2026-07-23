import { describe, expect, it } from 'vitest'

import {
  resolveAuthKeytarService,
  shouldEnableSingleInstanceLock,
  shouldRegisterDefaultProtocolClient,
} from './startup-isolation.js'

describe('startup isolation configuration', () => {
  it('keeps production startup protections enabled by default', () => {
    expect(shouldEnableSingleInstanceLock(false, {})).toBe(true)
    expect(shouldRegisterDefaultProtocolClient({})).toBe(true)
    expect(resolveAuthKeytarService({})).toBe('SparkAgent.CloudAuth')
  })

  it('allows an isolated local instance without changing production defaults', () => {
    const env = {
      SPARK_ALLOW_MULTIPLE_INSTANCES: '1',
      SPARK_SKIP_PROTOCOL_REGISTRATION: '1',
      SPARK_AUTH_KEYTAR_SERVICE: ' SparkAgent.CloudAuth.E2E.123 ',
    }

    expect(shouldEnableSingleInstanceLock(false, env)).toBe(false)
    expect(shouldRegisterDefaultProtocolClient(env)).toBe(false)
    expect(resolveAuthKeytarService(env)).toBe('SparkAgent.CloudAuth.E2E.123')
  })

  it('continues to disable the lock for development', () => {
    expect(shouldEnableSingleInstanceLock(true, {})).toBe(false)
  })

  it('ignores blank keytar service overrides', () => {
    expect(resolveAuthKeytarService({ SPARK_AUTH_KEYTAR_SERVICE: '   ' })).toBe(
      'SparkAgent.CloudAuth',
    )
  })
})
