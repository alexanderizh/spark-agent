import { describe, expect, it } from 'vitest'
import {
  APP_BUNDLE_ID,
  DEV_APP_BUNDLE_ID,
  DEV_DEEP_LINK_SCHEME,
  DEV_PACKAGE_NAME,
  PRODUCTION_DEEP_LINK_SCHEME,
  isDevFlavoredPackage,
  resolveAppBundleId,
  resolveDeepLinkScheme,
} from './build-flavor.js'

describe('build flavor', () => {
  it('treats only the dev package name as dev flavored', () => {
    expect(isDevFlavoredPackage(DEV_PACKAGE_NAME)).toBe(true)
    expect(isDevFlavoredPackage('@spark/desktop')).toBe(false)
    expect(isDevFlavoredPackage('')).toBe(false)
  })

  it('keeps the production scheme for production packages', () => {
    expect(resolveDeepLinkScheme('@spark/desktop')).toBe(PRODUCTION_DEEP_LINK_SCHEME)
    expect(PRODUCTION_DEEP_LINK_SCHEME).toBe('spark-agent')
  })

  it('gives dev packages a deep link scheme of their own', () => {
    expect(resolveDeepLinkScheme(DEV_PACKAGE_NAME)).toBe(DEV_DEEP_LINK_SCHEME)
    expect(resolveDeepLinkScheme('@spark/desktop', false)).toBe(DEV_DEEP_LINK_SCHEME)
    expect(DEV_DEEP_LINK_SCHEME).not.toBe(PRODUCTION_DEEP_LINK_SCHEME)
  })

  it('selects separate bundle IDs', () => {
    expect(resolveAppBundleId('@spark/desktop')).toBe(APP_BUNDLE_ID)
    expect(resolveAppBundleId(DEV_PACKAGE_NAME)).toBe(DEV_APP_BUNDLE_ID)
    expect(DEV_APP_BUNDLE_ID).toBe('com.spark-agent.desktop.dev')
  })
})
