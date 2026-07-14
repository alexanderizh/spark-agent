import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isDev: false,
  userDataPath: 'C:\\Users\\tester\\AppData\\Roaming\\@spark\\desktop',
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mocks.userDataPath),
  },
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return mocks.isDev
    },
  },
}))

import { getDatabasePath } from './db.js'

describe('database path', () => {
  beforeEach(() => {
    mocks.isDev = false
  })

  it('uses spark.db in production', () => {
    expect(getDatabasePath()).toBe(`${mocks.userDataPath}\\spark.db`)
  })

  it('uses the production spark.db in development', () => {
    mocks.isDev = true

    expect(getDatabasePath()).toBe(`${mocks.userDataPath}\\spark.db`)
  })
})
