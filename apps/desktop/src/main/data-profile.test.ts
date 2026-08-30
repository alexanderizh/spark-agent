import { describe, expect, it } from 'vitest'

import { applyDevUserData, devUserDataPath, shouldUseDevUserData } from './data-profile.js'

function createPathApp(current: string): {
  appLike: {
    getPath: (name: 'userData') => string
    setPath: (name: 'userData', path: string) => void
  }
  paths: { userData: string }
} {
  const paths: { userData: string } = { userData: current }
  return {
    paths,
    appLike: {
      getPath: (name) => paths[name],
      setPath: (name, value) => {
        paths[name] = value
      },
    },
  }
}

describe('data profile isolation', () => {
  it('keeps production runs on the default userData', () => {
    const { appLike, paths } = createPathApp('/root/@spark/desktop')

    expect(applyDevUserData(appLike, false, {})).toBeNull()
    expect(paths.userData).toBe('/root/@spark/desktop')
  })

  it('isolates dev runs into a sibling -dev directory', () => {
    const { appLike, paths } = createPathApp('/root/@spark/desktop')

    const next = applyDevUserData(appLike, true, {})

    expect(next).toBe('/root/@spark/desktop-dev')
    expect(paths.userData).toBe('/root/@spark/desktop-dev')
  })

  it('allows packaged builds to opt into the isolated directory', () => {
    expect(shouldUseDevUserData(false, { SPARK_DATA_PROFILE: 'dev' })).toBe(true)
  })

  it('allows dev runs to explicitly opt back into the production directory', () => {
    const { appLike, paths } = createPathApp('/root/@spark/desktop')

    expect(applyDevUserData(appLike, true, { SPARK_DATA_PROFILE: 'production' })).toBeNull()
    expect(paths.userData).toBe('/root/@spark/desktop')
  })

  it('normalizes whitespace and casing of the profile override', () => {
    expect(shouldUseDevUserData(true, { SPARK_DATA_PROFILE: '  Production ' })).toBe(false)
    expect(shouldUseDevUserData(false, { SPARK_DATA_PROFILE: ' DEV ' })).toBe(true)
    expect(shouldUseDevUserData(true, { SPARK_DATA_PROFILE: '  ' })).toBe(true)
  })

  it('derives the isolated path from the current userData only', () => {
    expect(devUserDataPath('/root/@spark/desktop')).toBe('/root/@spark/desktop-dev')
  })
})
