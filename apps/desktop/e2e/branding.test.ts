import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadEffectiveBuilderConfig } from './effective-builder-config.js'

const ROOT = join(__dirname, '..')

interface BuilderConfig {
  appId?: string
  productName?: string
  artifactName?: string
  protocols?: Array<{ name?: string; schemes?: string[] }>
  directories?: { output?: string }
  extraMetadata?: { name?: string }
  mac?: {
    hardenedRuntime?: boolean
    entitlements?: string
    entitlementsInherit?: string
    extendInfo?: {
      CFBundleDisplayName?: string
      NSMicrophoneUsageDescription?: string
    }
  }
  nsis?: {
    include?: string
    shortcutName?: string
    uninstallDisplayName?: string
    oneClick?: boolean
    allowToChangeInstallationDirectory?: boolean
  }
  linux?: { desktop?: { entry?: { Name?: string } } }
}

describe('desktop branding boundaries', () => {
  it('keeps technical identity stable while exposing SparkWork', async () => {
    const config = (await loadEffectiveBuilderConfig('electron-builder.yml')) as BuilderConfig

    expect(config.appId).toBe('com.spark-agent.desktop')
    expect(config.productName).toBe('Spark Agent')
    expect(config.artifactName).toBe('${productName}-${version}-${os}-${arch}.${ext}')
    expect(config.protocols?.flatMap((protocol) => protocol.schemes ?? [])).toEqual(['spark-agent'])

    expect(config.protocols?.[0]?.name).toBe('SparkWork redemption')
    expect(config.mac?.extendInfo?.CFBundleDisplayName).toBe('SparkWork')
    expect(config.mac?.extendInfo?.NSMicrophoneUsageDescription).toContain('麦克风')
    expect(config.nsis?.shortcutName).toBe('SparkWork')
    expect(config.nsis?.include).toBe('build/installer.nsh')
    expect(config.nsis?.uninstallDisplayName).toBe('SparkWork ${version}')
    expect(config.nsis?.oneClick).toBe(false)
    expect(config.nsis?.allowToChangeInstallationDirectory).toBe(true)
    expect(config.linux?.desktop?.entry?.Name).toBe('SparkWork')
  })

  it('installs Windows files under the dedicated spark-worker directory', async () => {
    const config = (await loadEffectiveBuilderConfig('electron-builder.yml')) as BuilderConfig
    const installerScript = readFileSync(join(ROOT, 'build/installer.nsh'), 'utf8')

    expect(config.nsis?.include).toBe('build/installer.nsh')
    expect(installerScript).toMatch(/!define APP_FILENAME "spark-worker"/)
  })

  it('keeps the macOS microphone declarations required by Hardened Runtime', async () => {
    const config = (await loadEffectiveBuilderConfig('electron-builder.yml')) as BuilderConfig
    const entitlements = readFileSync(join(ROOT, 'resources/entitlements.mac.plist'), 'utf8')

    expect(config.mac?.hardenedRuntime).toBe(true)
    expect(config.mac?.entitlements).toBe('resources/entitlements.mac.plist')
    expect(config.mac?.entitlementsInherit).toBe('resources/entitlements.mac.plist')
    expect(entitlements).toMatch(/<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/)
  })

  it('uses SparkWork as the renderer window title', () => {
    const html = readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8')
    expect(html).toContain('<title>SparkWork</title>')
  })

  it('keeps the dev package identity separate from the production installer', async () => {
    const dev = (await loadEffectiveBuilderConfig('electron-builder.dev.yml')) as BuilderConfig

    expect(dev.appId).toBe('com.spark-agent.desktop.dev')
    expect(dev.productName).toBe('Spark Agent Dev')
    expect(dev.artifactName).toBe('${productName}-${version}-${os}-${arch}.${ext}')
    // 只注册 dev scheme：extends 对数组取并集，这里守住「不把 spark-agent 带进 dev 包」
    expect(dev.protocols?.flatMap((protocol) => protocol.schemes ?? [])).toEqual([
      'spark-agent-dev',
    ])
    expect(dev.directories?.output).toBe('dist-dev')
    expect(dev.extraMetadata?.name).toBe('@spark/desktop-dev')
    expect(dev.mac?.extendInfo?.CFBundleDisplayName).toBe('SparkWork Dev')
    // 用途说明等声明必须从 base 完整继承
    expect(dev.mac?.extendInfo?.NSMicrophoneUsageDescription).toContain('麦克风')
    expect(dev.mac?.hardenedRuntime).toBe(true)
    expect(dev.nsis?.shortcutName).toBe('SparkWork')
  })
})
