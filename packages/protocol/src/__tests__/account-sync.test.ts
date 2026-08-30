import { AccountSyncIpcSchemaRegistry } from '../account-sync'
import { describe, expect, it } from 'vitest'

describe('account sync IPC contracts', () => {
  it('keeps all sync categories opt-in and validates partial preference updates', () => {
    expect(
      AccountSyncIpcSchemaRegistry['account-sync:update-preferences'].parse({
        enabled: true,
        categories: { memory: true, appearance: false },
      }),
    ).toEqual({
      enabled: true,
      categories: { memory: true, appearance: false },
    })
  })

  it('rejects renderer-supplied user identity and unknown categories', () => {
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:update-preferences'].parse({
        enabled: true,
        userId: 'another-user',
      }),
    ).toThrow()
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:update-preferences'].parse({
        categories: { providers: true },
      }),
    ).toThrow()
  })

  it('rejects empty preference mutations and over-sized history pages', () => {
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:update-preferences'].parse({}),
    ).toThrow()
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:list-history'].parse({ pageSize: 101 }),
    ).toThrow()
  })
})
