import { describe, expect, it, vi } from 'vitest'

import {
  MACOS_SCRIPT,
  POWERSHELL_SCRIPT,
  detectClipboardPlatform,
  readClipboardImage,
  type CommandResult,
  type CommandRunner,
} from '../../src/images/clipboard.js'
import { pngBytes } from '../fixtures/image-bytes.js'

const PNG = pngBytes(1920, 1080)

function ok(stdout: Buffer | string): CommandResult {
  return {
    code: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout, 'utf8') : stdout,
    stderr: '',
    overflow: false,
    timedOut: false,
  }
}

function failure(stderr = '', code = 1): CommandResult {
  return { code, stdout: Buffer.alloc(0), stderr, overflow: false, timedOut: false }
}

/** Records every argv the module spawns and answers from a script. */
function runner(script: Record<string, CommandResult>): CommandRunner & {
  readonly calls: string[][]
} {
  const calls: string[][] = []
  return {
    calls,
    run: async (command, args) => {
      calls.push([command, ...args])
      const result = script[command]
      if (result === undefined) {
        return {
          code: -1,
          stdout: Buffer.alloc(0),
          stderr: '',
          overflow: false,
          timedOut: false,
          spawnError: `spawn ${command} ENOENT`,
        }
      }
      return result
    },
  }
}

const macImage = (): CommandResult =>
  ok(
    JSON.stringify({
      kind: 'image',
      mediaType: 'image/png',
      data: Buffer.from(PNG).toString('base64'),
    }),
  )

describe('clipboard platform detection', () => {
  it('maps the OS and session type onto a strategy', () => {
    expect(detectClipboardPlatform('darwin', {})).toBe('darwin')
    expect(detectClipboardPlatform('win32', {})).toBe('windows')
    expect(detectClipboardPlatform('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe('linux-wayland')
    expect(detectClipboardPlatform('linux', {})).toBe('linux-x11')
    expect(detectClipboardPlatform('linux', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe('wsl')
    expect(detectClipboardPlatform('freebsd', {})).toBeUndefined()
  })
})

describe('clipboard image reading', () => {
  it('rejects unsupported platforms with an actionable hint', async () => {
    const result = await readClipboardImage({ platform: 'freebsd', environment: {} })
    expect(result).toMatchObject({ ok: false, code: 'unsupported-platform' })
  })

  it('reads macOS pasteboard pixels through the JXA/AppKit script', async () => {
    const run = runner({ osascript: macImage() })
    const result = await readClipboardImage({ platform: 'darwin', environment: {}, run })
    expect(run.calls[0]?.slice(0, 3)).toEqual(['osascript', '-l', 'JavaScript'])
    expect(result).toEqual({
      ok: true,
      image: {
        bytes: PNG,
        mediaType: 'image/png',
        width: 1920,
        height: 1080,
      },
    })
  })

  it('reads a copied image file instead of a re-encoded pasteboard copy', async () => {
    const run = runner({
      osascript: ok(JSON.stringify({ kind: 'file', path: '/Users/me/shot.png' })),
    })
    const readFile = vi.fn(async () => ({
      ok: true as const,
      image: { bytes: PNG, mediaType: 'image/png' as const, name: 'shot.png' },
    }))
    const result = await readClipboardImage({ platform: 'darwin', environment: {}, run, readFile })
    expect(readFile).toHaveBeenCalledWith('/Users/me/shot.png')
    expect(result).toMatchObject({ ok: true, image: { name: 'shot.png' } })
  })

  it('reports an empty macOS pasteboard as no-image', async () => {
    const run = runner({ osascript: ok(JSON.stringify({ kind: 'none' })) })
    const result = await readClipboardImage({ platform: 'darwin', environment: {}, run })
    expect(result).toMatchObject({ ok: false, code: 'no-image' })
  })

  it('reports a missing osascript as clipboard-unavailable', async () => {
    const run = runner({})
    const result = await readClipboardImage({ platform: 'darwin', environment: {}, run })
    expect(result).toMatchObject({ ok: false, code: 'clipboard-unavailable' })
  })

  it('rejects a pasteboard payload whose bytes are not an image', async () => {
    const run = runner({
      osascript: ok(
        JSON.stringify({
          kind: 'image',
          mediaType: 'image/png',
          data: Buffer.from('definitely not a png').toString('base64'),
        }),
      ),
    })
    const result = await readClipboardImage({ platform: 'darwin', environment: {}, run })
    expect(result).toMatchObject({ ok: false, code: 'decode-failed' })
  })

  it('reads Linux X11 through xclip and Wayland through wl-paste first', async () => {
    const raster = Buffer.from(PNG)
    const x11 = runner({ xclip: ok(raster) })
    expect(
      await readClipboardImage({ platform: 'linux', environment: {}, run: x11 }),
    ).toMatchObject({ ok: true })
    expect(x11.calls[0]?.[0]).toBe('xclip')

    const wayland = runner({ 'wl-paste': ok(raster), xclip: ok(raster) })
    expect(
      await readClipboardImage({
        platform: 'linux',
        environment: { WAYLAND_DISPLAY: 'wayland-0' },
        run: wayland,
      }),
    ).toMatchObject({ ok: true })
    expect(wayland.calls[0]?.[0]).toBe('wl-paste')
  })

  it('falls back to the other Linux tool and names the missing package', async () => {
    const fallback = runner({
      xclip: failure('Error: target image/png not available'),
      'wl-paste': ok(Buffer.from(PNG)),
    })
    expect(
      await readClipboardImage({
        platform: 'linux',
        environment: { WAYLAND_DISPLAY: 'wayland-0' },
        run: fallback,
      }),
    ).toMatchObject({ ok: true })

    const missing = runner({})
    await expect(
      readClipboardImage({ platform: 'linux', environment: {}, run: missing }),
    ).resolves.toMatchObject({ ok: false, code: 'clipboard-unavailable' })
  })

  it('distinguishes a headless display failure from an empty clipboard', async () => {
    const headless = runner({ xclip: failure("Error: Can't open display: :0") })
    await expect(
      readClipboardImage({ platform: 'linux', environment: {}, run: headless }),
    ).resolves.toMatchObject({ ok: false, code: 'clipboard-unavailable' })

    const empty = runner({ xclip: failure('Error: target image/png not available') })
    await expect(
      readClipboardImage({ platform: 'linux', environment: {}, run: empty }),
    ).resolves.toMatchObject({ ok: false, code: 'no-image' })
  })

  it('reads Windows and WSL through STA PowerShell without quoting the script', async () => {
    const wsl = runner({
      'powershell.exe': ok(
        JSON.stringify({
          kind: 'image',
          mediaType: 'image/png',
          data: Buffer.from(PNG).toString('base64'),
        }),
      ),
    })
    const result = await readClipboardImage({
      platform: 'linux',
      environment: { WSL_DISTRO_NAME: 'Ubuntu' },
      run: wsl,
    })
    expect(result).toMatchObject({ ok: true })
    const args = wsl.calls[0] ?? []
    expect(args.slice(0, 5)).toEqual([
      'powershell.exe',
      '-STA',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
    ])
    // The encoded script keeps the pasteboard read off the command line.
    expect(Buffer.from(args[5] ?? '', 'base64').toString('utf16le')).toContain(
      'System.Windows.Forms.Clipboard',
    )

    const windows = runner({
      powershell: ok(JSON.stringify({ kind: 'none' })),
    })
    await expect(
      readClipboardImage({ platform: 'win32', environment: {}, run: windows }),
    ).resolves.toMatchObject({ ok: false, code: 'no-image' })
  })

  it('treats an oversized read as too-large and a stalled read as unavailable', async () => {
    const overflow = runner({
      osascript: { ...macImage(), overflow: true, code: -1 },
    })
    await expect(
      readClipboardImage({ platform: 'darwin', environment: {}, run: overflow }),
    ).resolves.toMatchObject({ ok: false, code: 'too-large' })

    const stalled = runner({ osascript: { ...failure(), timedOut: true, code: -1 } })
    await expect(
      readClipboardImage({ platform: 'darwin', environment: {}, run: stalled }),
    ).resolves.toMatchObject({ ok: false, code: 'clipboard-unavailable' })
  })

  it('keeps the platform scripts on the success stream', () => {
    // JXA's console.log writes to stderr, where the reader never looks, so the
    // macOS payload must be the script's final expression instead.
    const macosCode = MACOS_SCRIPT.split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(macosCode).not.toContain('console.log')
    expect(MACOS_SCRIPT.trimEnd().endsWith('JSON.stringify(readPasteboard())')).toBe(true)
    // Same contract for PowerShell: Write-Output is the success stream.
    expect(POWERSHELL_SCRIPT).toContain('Write-Output')
    expect(POWERSHELL_SCRIPT).not.toContain('Write-Error')
  })

  it('logs only metadata, never image bytes or paths', async () => {
    const lines: string[] = []
    const run = runner({ osascript: macImage() })
    await readClipboardImage({
      platform: 'darwin',
      environment: {},
      run,
      logger: {
        debug: (message) => lines.push(message),
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })
    expect(lines.join('\n')).toContain('platform=darwin ok=true')
    expect(lines.join('\n')).toContain('bytes=24')
    expect(lines.join('\n')).not.toMatch(/[A-Za-z0-9+/]{40}/)
  })
})
