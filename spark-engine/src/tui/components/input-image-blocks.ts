/**
 * Draft-model helpers for image placeholders.
 *
 * An image lives in the draft as an atomic `[Image #N]` block: the text is the
 * single source of truth (the model reads it), and the block only carries the
 * attachment plus the range it occupies. That makes deletion, renumbering, and
 * submission-time pruning pure functions, which is what this module holds —
 * the editor component stays a thin renderer/orchestrator.
 */
import {
  imagePlaceholderText,
  validateImageAttachments,
  type TurnImageAttachment,
} from '../../images/attachments.js'

/**
 * One atomic block in the draft. Text pastes use the line/character counts;
 * image placeholders additionally carry the attachment.
 */
export interface DraftBlock {
  readonly id: number
  readonly start: number
  readonly end: number
  readonly lineCount: number
  readonly characterCount: number
  readonly image?: TurnImageAttachment
}

export interface PlaceholderSync {
  readonly text: string
  readonly blocks: readonly DraftBlock[]
}

/** Display numbers (1-based) for the image blocks, in document order. */
export function imageBlockNumbers(blocks: readonly DraftBlock[]): ReadonlyMap<number, number> {
  const numbers = new Map<number, number>()
  for (const block of orderedImageBlocks(blocks)) numbers.set(block.id, numbers.size + 1)
  return numbers
}

export function orderedImageBlocks(blocks: readonly DraftBlock[]): readonly DraftBlock[] {
  return blocks
    .filter((block) => block.image !== undefined)
    .slice()
    .sort((left, right) => left.start - right.start)
}

/**
 * Rewrites every image placeholder to its current 1-based number.
 *
 * Numbers follow document order, so deleting or inserting a block renumbers
 * the rest — the draft text and the attachment order can never disagree.
 */
export function syncImagePlaceholders(
  text: string,
  blocks: readonly DraftBlock[],
): PlaceholderSync {
  const characters = Array.from(text)
  const imageBlocks = orderedImageBlocks(blocks)
  if (imageBlocks.length === 0) return { text, blocks }

  const shiftedImageBlocks: DraftBlock[] = []
  const shiftedById = new Map<number, DraftBlock>()
  let assembled = ''
  let cursor = 0
  let delta = 0
  for (const [index, block] of imageBlocks.entries()) {
    const start = block.start + delta
    const end = block.end + delta
    const expected = imagePlaceholderText(index + 1)
    assembled += characters.slice(cursor, start).join('')
    assembled += expected
    const shiftedBlock = { ...block, start, end: start + expected.length }
    shiftedImageBlocks.push(shiftedBlock)
    shiftedById.set(block.id, shiftedBlock)
    cursor = end
    delta += expected.length - (block.end - block.start)
  }
  assembled += characters.slice(cursor).join('')

  const shiftedBlocks: DraftBlock[] = []
  for (const block of blocks) {
    const shiftedImage = shiftedById.get(block.id)
    if (shiftedImage !== undefined) {
      shiftedBlocks.push(shiftedImage)
      continue
    }
    // A partially overlapping non-image block can no longer describe its
    // range; dropping it keeps the draft consistent.
    if (overlapsImageRange(block, shiftedImageBlocks)) continue
    shiftedBlocks.push({ ...block, start: shiftPosition(block.start, imageBlocks), end: shiftPosition(block.end, imageBlocks) })
  }
  return { text: assembled, blocks: shiftedBlocks }
}

/**
 * The attachments a submission actually sends.
 *
 * A block is only sent while its placeholder still reads exactly as expected,
 * which mirrors Codex's `prune_local_images_for_submission`: editing a
 * placeholder into ordinary text drops the picture, the rest of the prompt
 * still goes out.
 */
export function collectSubmittedImages(
  text: string,
  blocks: readonly DraftBlock[],
): readonly TurnImageAttachment[] {
  const characters = Array.from(text)
  const images: TurnImageAttachment[] = []
  for (const [index, block] of orderedImageBlocks(blocks).entries()) {
    const expected = imagePlaceholderText(index + 1)
    if (characters.slice(block.start, block.end).join('') !== expected) continue
    if (block.image !== undefined) images.push(block.image)
  }
  return images
}

export type ImageAdmission = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** Rejects an attachment the engine would reject, before it reaches the draft. */
export function admitImage(
  blocks: readonly DraftBlock[],
  image: TurnImageAttachment,
): ImageAdmission {
  const existing = orderedImageBlocks(blocks).flatMap((block) =>
    block.image === undefined ? [] : [block.image],
  )
  const validation = validateImageAttachments([...existing, image])
  return validation.ok ? { ok: true } : { ok: false, message: validation.message }
}

function shiftPosition(position: number, imageBlocks: readonly DraftBlock[]): number {
  let adjust = 0
  for (const [index, block] of imageBlocks.entries()) {
    if (block.end > position) break
    adjust += imagePlaceholderText(index + 1).length - (block.end - block.start)
  }
  return position + adjust
}

function overlapsImageRange(block: DraftBlock, imageBlocks: readonly DraftBlock[]): boolean {
  return imageBlocks.some((image) => block.start < image.end && block.end > image.start)
}
