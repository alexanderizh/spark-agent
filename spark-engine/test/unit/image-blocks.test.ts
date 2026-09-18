import { describe, expect, it } from 'vitest'

import type { TurnImageAttachment } from '../../src/images/attachments.js'
import {
  admitImage,
  collectSubmittedImages,
  imageBlockNumbers,
  syncImagePlaceholders,
  type DraftBlock,
} from '../../src/tui/components/input-image-blocks.js'
import { pngBytes } from '../fixtures/image-bytes.js'

const image = (bytes = 1_024, width?: number, height?: number): TurnImageAttachment => ({
  bytes: new Uint8Array(bytes),
  mediaType: 'image/png',
  ...(width === undefined ? {} : { width }),
  ...(height === undefined ? {} : { height }),
})

function imageBlock(id: number, start: number, attachment = image()): DraftBlock {
  const end = start + `[Image #${id}]`.length
  return { id, start, end, lineCount: 1, characterCount: end - start, image: attachment }
}

describe('draft image placeholders', () => {
  it('numbers image blocks by document order, not insertion order', () => {
    const blocks = [imageBlock(7, 0), imageBlock(3, 20), imageBlock(5, 40)]
    const numbers = imageBlockNumbers(blocks)
    expect(numbers.get(7)).toBe(1)
    expect(numbers.get(3)).toBe(2)
    expect(numbers.get(5)).toBe(3)
  })

  it('renumbers placeholders after a deletion and keeps ranges valid', () => {
    const text = '[Image #1] and [Image #2]'
    const first = imageBlock(1, 0)
    const second = imageBlock(2, text.indexOf('[Image #2]'))
    const synced = syncImagePlaceholders(text, [first, second])
    expect(synced.text).toBe(text)

    // Deleting the first block removes its text too; the survivor is
    // renumbered to `[Image #1]` and its range shrinks with the label.
    const afterDelete = ' and [Image #2]'
    const shifted = { ...second, start: 5, end: 5 + '[Image #2]'.length }
    const shrunk = syncImagePlaceholders(afterDelete, [shifted])
    expect(shrunk.text).toBe(' and [Image #1]')
    expect(shrunk.blocks[0]).toMatchObject({ id: 2, start: 5, end: 15 })
  })

  it('leaves text paste blocks offset-correct while renumbering', () => {
    const text = `look at [Image #1] ${'x'.repeat(30)}`
    const pasteStart = text.indexOf('x'.repeat(30))
    const paste: DraftBlock = {
      id: 99,
      start: pasteStart,
      end: pasteStart + 30,
      lineCount: 30,
      characterCount: 30,
    }
    const synced = syncImagePlaceholders(text, [imageBlock(1, 8), paste])
    expect(synced.text).toBe(text)
    expect(synced.blocks.find((block) => block.id === 99)?.start).toBe(pasteStart)
  })

  it('submits only the placeholders that survived in the text', () => {
    const text = 'before [Image #1] after'
    const first = imageBlock(1, 7)
    const second = imageBlock(2, 7)
    expect(collectSubmittedImages(text, [first])).toHaveLength(1)
    expect(collectSubmittedImages(text, [first, second])).toHaveLength(1)

    // A placeholder edited into ordinary text drops its picture, and the rest
    // of the prompt still submits.
    const edited = 'before [Image  after'
    expect(collectSubmittedImages(edited, [first])).toHaveLength(0)
  })

  it('keeps the attachment order aligned with the submitted numbers', () => {
    const text = '[Image #1] mid [Image #2]'
    const blocks = [imageBlock(1, 0), imageBlock(2, text.indexOf('[Image #2]'))]
    const submitted = collectSubmittedImages(text, blocks)
    expect(submitted).toHaveLength(2)
    expect(submitted[0]).toBe(blocks[0]?.image)
    expect(submitted[1]).toBe(blocks[1]?.image)
  })

  it('admits an attachment only when the engine limits allow it', () => {
    expect(admitImage([], image(1_024, 800, 600))).toEqual({ ok: true })
    expect(admitImage([], image(21 * 1024 * 1024))).toMatchObject({ ok: false })
    const full = Array.from({ length: 20 }, () => imageBlock(1, 0))
    expect(admitImage(full, image())).toMatchObject({ ok: false })
  })

  it('handles a pixel-format dimension pair used by the TUI label', () => {
    expect(imageBlock(1, 0, image(2_048, 1920, 1080)).image).toMatchObject({
      width: 1920,
      height: 1080,
    })
    expect(pngBytes(4, 4).byteLength).toBe(24)
  })
})
