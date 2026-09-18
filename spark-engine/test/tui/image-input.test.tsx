import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

import type { ImageReadResult, TurnImageAttachment } from '../../src/images/attachments.js'
import type { ImageInputSeam } from '../../src/images/seam.js'
import { InputEditor } from '../../src/tui/components/input-editor.js'
import { defaultTheme } from '../../src/tui/theme.js'

const capabilities = { color: 'mono' as const, unicode: true, width: 100 }

const CTRL_V = '\u0016'
const ALT_V = '\u001bv'

function image(name: string, width = 1920, height = 1080, bytes = 245_760): TurnImageAttachment {
  return { bytes: new Uint8Array(bytes), mediaType: 'image/png', name, width, height }
}

function seam(overrides: Partial<ImageInputSeam> = {}): ImageInputSeam {
  return {
    readClipboard: vi.fn(async () => ({ ok: true as const, image: image('clipboard.png') })),
    readFile: vi.fn(async () => ({ ok: true as const, image: image('file.png') })),
    resolveFilePath: vi.fn(async () => undefined),
    altVPaste: false,
    ...overrides,
  }
}

function editor(props: Partial<Parameters<typeof InputEditor>[0]> = {}) {
  const onSubmit = vi.fn<(value: string, images: readonly TurnImageAttachment[]) => void>()
  const app = render(
    <InputEditor
      active
      locked={false}
      capabilities={capabilities}
      theme={defaultTheme}
      onSubmit={onSubmit}
      onEscape={vi.fn()}
      onControlC={vi.fn()}
      {...props}
    />,
  )
  return { app, onSubmit }
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

/** The clipboard read resolves on a microtask; flush it and let Ink re-render. */
async function settle(): Promise<void> {
  await tick()
  await tick()
}

describe('InputEditor image intake', () => {
  it('inserts an atomic placeholder on Ctrl+V and submits it with the attachment', async () => {
    const { app, onSubmit } = editor({ imageInput: seam() })
    app.stdin.write(CTRL_V)
    await settle()

    expect(app.lastFrame() ?? '').toContain('[Image #1 · 1920×1080 · 240KB]')
    app.stdin.write('describe this')
    await tick()
    app.stdin.write('\r')
    await settle()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const call = onSubmit.mock.calls[0]
    expect(call?.[0]).toBe('[Image #1]describe this')
    expect(call?.[1]).toHaveLength(1)
    expect(call?.[1]?.[0]).toMatchObject({ name: 'clipboard.png' })
    app.unmount()
  })

  it('shows the clipboard error without polluting the draft', async () => {
    const { app, onSubmit } = editor({
      imageInput: seam({
        readClipboard: vi.fn(async () => ({
          ok: false as const,
          code: 'no-image' as const,
          message: '剪贴板里没有图片；先截图或复制一张图片再试。',
        })),
      }),
    })
    app.stdin.write(CTRL_V)
    await settle()
    expect(app.lastFrame() ?? '').toContain('剪贴板里没有图片')

    app.stdin.write('\r')
    await settle()
    expect(onSubmit).not.toHaveBeenCalled()
    app.unmount()
  })

  it('deletes a whole block with Backspace and renumbers the survivors', async () => {
    const { app, onSubmit } = editor({ imageInput: seam() })
    app.stdin.write(CTRL_V)
    await settle()
    app.stdin.write(CTRL_V)
    await settle()
    expect(app.lastFrame() ?? '').toContain('[Image #2 · 1920×1080 · 240KB]')

    // The caret sits after block two; one Backspace removes the whole block.
    app.stdin.write('\u007f')
    await tick()
    expect(app.lastFrame() ?? '').not.toContain('[Image #2')

    app.stdin.write('\r')
    await settle()
    expect(onSubmit.mock.calls[0]?.[0]).toBe('[Image #1]')
    expect(onSubmit.mock.calls[0]?.[1]).toHaveLength(1)
    app.unmount()
  })

  it('drops the picture when the draft keeps no placeholder for it', async () => {
    const { app, onSubmit } = editor({ imageInput: seam() })
    app.stdin.write('look at this: ')
    await tick()
    app.stdin.write(CTRL_V)
    await settle()

    // Ctrl+U clears the draft, so nothing is left to submit.
    app.stdin.write('\u0015')
    await tick()
    app.stdin.write('just text now')
    await tick()
    app.stdin.write('\r')
    await settle()
    expect(onSubmit.mock.calls[0]?.[0]).toBe('just text now')
    expect(onSubmit.mock.calls[0]?.[1]).toEqual([])
    app.unmount()
  })

  it('attaches a pasted image path instead of inserting its text', async () => {
    const readClipboard = vi.fn(async () => ({ ok: false as const, code: 'no-image' as const, message: '' }))
    const resolveFilePath = vi.fn(async () => '/tmp/shot.png')
    const { app, onSubmit } = editor({
      imageInput: seam({ readClipboard, resolveFilePath }),
    })
    app.stdin.write('\u001b[200~/tmp/shot.png\u001b[201~')
    await settle()

    expect(resolveFilePath).toHaveBeenCalledWith('/tmp/shot.png')
    expect(app.lastFrame() ?? '').toContain('[Image #1 · 1920×1080 · 240KB]')
    expect(app.lastFrame() ?? '').toContain('已识别图片路径并附加为图片')

    app.stdin.write('\r')
    await settle()
    expect(onSubmit.mock.calls[0]?.[0]).toBe('[Image #1]')
    expect(onSubmit.mock.calls[0]?.[1]).toHaveLength(1)
    app.unmount()
  })

  it('falls back to plain text when the pasted path is not an image', async () => {
    const { app } = editor({ imageInput: seam() })
    app.stdin.write('\u001b[200~/tmp/notes.md\u001b[201~')
    await settle()
    expect(app.lastFrame() ?? '').toContain('/tmp/notes.md')
    app.unmount()
  })

  it('accepts Alt+V only where the platform reserves Ctrl+V', async () => {
    const off = editor({ imageInput: seam() })
    off.app.stdin.write(ALT_V)
    await settle()
    expect(off.app.lastFrame() ?? '').not.toContain('[Image #1')
    off.app.unmount()

    const on = editor({ imageInput: seam({ altVPaste: true }) })
    on.app.stdin.write(ALT_V)
    await settle()
    expect(on.app.lastFrame() ?? '').toContain('[Image #1')
    on.app.unmount()
  })

  it('hints once when the model never declared image input', async () => {
    const { app } = editor({ imageInput: seam(), supportsImages: false })
    app.stdin.write(CTRL_V)
    await settle()
    expect(app.lastFrame() ?? '').toContain('当前模型未声明图片输入能力')
    // The placeholder still lands: the hint never blocks the turn.
    expect(app.lastFrame() ?? '').toContain('[Image #1')

    app.stdin.write(CTRL_V)
    await settle()
    expect(app.lastFrame() ?? '').not.toContain('当前模型未声明图片输入能力')
    app.unmount()
  })

  it('treats an empty bracketed paste as a pasted picture', async () => {
    // Terminals that route the paste chord through their own paste channel
    // deliver nothing but `\u001b[200~\u001b[201~` when the clipboard holds a
    // picture. That empty event used to be dropped, so Ctrl+V looked dead.
    const readClipboard = vi.fn(async () => ({
      ok: true as const,
      image: image('clipboard.png'),
    }))
    const { app, onSubmit } = editor({ imageInput: seam({ readClipboard }) })
    app.stdin.write('\u001b[200~\u001b[201~')
    await settle()

    expect(readClipboard).toHaveBeenCalledTimes(1)
    expect(app.lastFrame() ?? '').toContain('[Image #1 · 1920×1080 · 240KB]')

    app.stdin.write('\r')
    await settle()
    expect(onSubmit.mock.calls[0]?.[1]).toHaveLength(1)
    app.unmount()
  })

  it('reports the clipboard failure on an empty paste instead of staying silent', async () => {
    const { app } = editor({
      imageInput: seam({
        readClipboard: vi.fn(async () => ({
          ok: false as const,
          code: 'no-image' as const,
          message: '剪贴板里没有图片；先截图或复制一张图片再试。',
        })),
      }),
    })
    app.stdin.write('\u001b[200~\u001b[201~')
    await settle()
    expect(app.lastFrame() ?? '').toContain('剪贴板里没有图片')
    app.unmount()
  })

  it('still pastes plain text normally', async () => {
    const readClipboard = vi.fn(async () => ({ ok: false as const, code: 'no-image' as const, message: '' }))
    const { app, onSubmit } = editor({ imageInput: seam({ readClipboard }) })
    app.stdin.write('\u001b[200~plain pasted text\u001b[201~')
    await settle()
    expect(readClipboard).not.toHaveBeenCalled()
    expect(app.lastFrame() ?? '').toContain('plain pasted text')

    app.stdin.write('\r')
    await settle()
    expect(onSubmit.mock.calls[0]?.[0]).toBe('plain pasted text')
    app.unmount()
  })

  it('attaches a quoted dropped path', async () => {
    const resolveFilePath = vi.fn(async () => '/tmp/shot.png')
    const { app } = editor({ imageInput: seam({ resolveFilePath }) })
    app.stdin.write('\u001b[200~"/tmp/shot.png"\u001b[201~')
    await settle()
    expect(resolveFilePath).toHaveBeenCalledWith('"/tmp/shot.png"')
    expect(app.lastFrame() ?? '').toContain('[Image #1')
    app.unmount()
  })

  it('explains an image paste while a picker owns the keyboard', async () => {
    // Locked used to mean "nothing happens at all", which is exactly the
    // "Ctrl+V does nothing" report. Say why instead, and do not read the
    // clipboard into a draft nobody can see.
    const readClipboard = vi.fn(async () => ({ ok: true as const, image: image('clipboard.png') }))
    const { app } = editor({ imageInput: seam({ readClipboard }), active: false, locked: true })
    app.stdin.write(CTRL_V)
    await settle()

    expect(app.lastFrame() ?? '').toContain('先按 Enter/Esc 关闭')
    expect(readClipboard).not.toHaveBeenCalled()
    app.unmount()
  })

  it('explains an empty paste while locked', async () => {
    const { app } = editor({ imageInput: seam(), active: false, locked: true })
    app.stdin.write('\u001b[200~\u001b[201~')
    await settle()
    expect(app.lastFrame() ?? '').toContain('先按 Enter/Esc 关闭')
    app.unmount()
  })

  it('keeps ordinary typing inert while locked', async () => {
    const { app } = editor({ imageInput: seam(), active: false, locked: true })
    app.stdin.write('hello')
    await tick()
    expect(app.lastFrame() ?? '').toContain('(输入已锁定)')
    expect(app.lastFrame() ?? '').not.toContain('hello')
    app.unmount()
  })

  it('keeps characters typed while the clipboard read is in flight', async () => {
    // A read resolves after a render (osascript costs tens to hundreds of ms).
    // Writing back the pre-read snapshot used to erase what was typed meanwhile,
    // and "paste the picture, then describe it" is the normal flow.
    let release: ((value: ImageReadResult) => void) | undefined
    const readClipboard = vi.fn(
      () =>
        new Promise<ImageReadResult>((resolve) => {
          release = resolve
        }),
    )
    const { app, onSubmit } = editor({ imageInput: seam({ readClipboard }) })

    app.stdin.write(CTRL_V)
    await tick()
    app.stdin.write('describe this')
    await tick()
    release?.({ ok: true, image: image('clipboard.png') })
    await settle()

    expect(app.lastFrame() ?? '').toContain('describe this')
    expect(app.lastFrame() ?? '').toContain('[Image #1')

    app.stdin.write('\r')
    await settle()
    expect(onSubmit.mock.calls[0]?.[0]).toContain('describe this')
    expect(onSubmit.mock.calls[0]?.[1]).toHaveLength(1)
    app.unmount()
  })

  it('reads the clipboard when the chord shares a chunk with typed text', async () => {
    // `\u0016describe` arrives as one stdin chunk when the keystrokes are fast.
    // The whole chunk used to be inserted as text: no picture, plus an
    // invisible control character in the draft.
    const readClipboard = vi.fn(async () => ({ ok: true as const, image: image('clipboard.png') }))
    const { app, onSubmit } = editor({ imageInput: seam({ readClipboard }) })
    app.stdin.write('\u0016describe')
    await settle()

    expect(readClipboard).toHaveBeenCalledTimes(1)
    expect(app.lastFrame() ?? '').toContain('[Image #1')
    expect(app.lastFrame() ?? '').toContain('describe')

    app.stdin.write('\r')
    await settle()
    expect(onSubmit.mock.calls[0]?.[0]).toContain('describe')
    expect(onSubmit.mock.calls[0]?.[1]).toHaveLength(1)
    app.unmount()
  })
})
