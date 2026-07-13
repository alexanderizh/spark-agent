import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

interface BuilderConfig {
  appId?: string
  productName?: string
  artifactName?: string
  protocols?: Array<{ name?: string; schemes?: string[] }>
  mac?: { extendInfo?: { CFBundleDisplayName?: string } }
  nsis?: { shortcutName?: string; uninstallDisplayName?: string }
  linux?: { desktop?: { Name?: string } }
}

describe('desktop branding boundaries', () => {
  it('keeps technical identity stable while exposing SparkWork', () => {
    const config = load(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')) as BuilderConfig

    expect(config.appId).toBe('com.spark-agent.desktop')
    expect(config.productName).toBe('Spark Agent')
    expect(config.artifactName).toBe('${productName}-${version}-${os}-${arch}.${ext}')
    expect(config.protocols?.[0]?.schemes).toEqual(['spark-agent'])

    expect(config.protocols?.[0]?.name).toBe('SparkWork redemption')
    expect(config.mac?.extendInfo?.CFBundleDisplayName).toBe('SparkWork')
    expect(config.nsis?.shortcutName).toBe('SparkWork')
    expect(config.nsis?.uninstallDisplayName).toBe('SparkWork ${version}')
    expect(config.linux?.desktop?.Name).toBe('SparkWork')
  })

  it('uses SparkWork as the renderer window title', () => {
    const html = readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8')
    expect(html).toContain('<title>SparkWork</title>')
  })
})
