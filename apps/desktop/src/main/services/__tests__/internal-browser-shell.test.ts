import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { buildInternalBrowserShellUrl } from '../internal-browser-shell.js'

describe('internal browser shell', () => {
  it('contains browser navigation controls and keeps the profile partition on the webview', () => {
    const shellUrl = buildInternalBrowserShellUrl('persist:spark-browser:profile-a')
    const html = decodeURIComponent(shellUrl.replace(/^data:text\/html;charset=utf-8,/, ''))

    expect(html).toContain('id="back"')
    expect(html).toContain('id="forward"')
    expect(html).toContain('id="reload"')
    expect(html).toContain('id="address"')
    expect(html).toContain('id="address-form"')
    expect(html).toContain('partition="persist:spark-browser:profile-a"')
    expect(html).toContain("'did-navigate-in-page'")

    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
    expect(script).toBeDefined()
    if (script != null) expect(() => new Script(script)).not.toThrow()
  })

  it('escapes the profile partition before embedding it in the shell', () => {
    const shellUrl = buildInternalBrowserShellUrl('persist:spark-browser:&<profile>')
    const html = decodeURIComponent(shellUrl.replace(/^data:text\/html;charset=utf-8,/, ''))

    expect(html).toContain('partition="persist:spark-browser:&amp;&lt;profile&gt;"')
    expect(html).not.toContain('partition="persist:spark-browser:&<profile>"')
  })
})
