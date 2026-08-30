import type { ReplyToState } from './ChatComposerTypes'

export type ComposerReplyReferenceMap = Record<string, ReplyToState>

export function updateComposerReplyReferenceBucket(
  current: ComposerReplyReferenceMap,
  bucket: string,
  next: ReplyToState | null,
): ComposerReplyReferenceMap {
  if (next == null) {
    if (!(bucket in current)) return current
    const nextByBucket = { ...current }
    delete nextByBucket[bucket]
    return nextByBucket
  }

  if (current[bucket] === next) return current
  return { ...current, [bucket]: next }
}
