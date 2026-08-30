import { useCallback, useState, type SetStateAction } from 'react'
import type { CodeReference } from '../../components/code-viewer/composerInsert'

export type ComposerCodeReferenceMap = Record<string, CodeReference[]>

export function updateComposerCodeReferenceBucket(
  current: ComposerCodeReferenceMap,
  bucket: string,
  next: SetStateAction<CodeReference[]>,
): ComposerCodeReferenceMap {
  const base = current[bucket] ?? []
  const resolved = typeof next === 'function' ? next(base) : next
  if (resolved === base) return current
  if (resolved.length === 0) {
    if (!(bucket in current)) return current
    const nextByBucket = { ...current }
    delete nextByBucket[bucket]
    return nextByBucket
  }
  return { ...current, [bucket]: resolved }
}

export function clearComposerCodeReferenceBuckets(
  current: ComposerCodeReferenceMap,
  buckets: readonly (string | null | undefined)[],
): ComposerCodeReferenceMap {
  const uniqueBuckets = new Set(
    buckets.filter((bucket): bucket is string => bucket != null && bucket !== ''),
  )
  if (uniqueBuckets.size === 0) return current

  const next = { ...current }
  let changed = false
  for (const bucket of uniqueBuckets) {
    if (!(bucket in next)) continue
    delete next[bucket]
    changed = true
  }
  return changed ? next : current
}

export function useComposerCodeReferences(bucket: string): {
  codeReferences: CodeReference[]
  setCodeReferences: (next: SetStateAction<CodeReference[]>) => void
  clearCodeReferenceBuckets: (buckets: readonly (string | null | undefined)[]) => void
} {
  const [referencesByBucket, setReferencesByBucket] = useState<ComposerCodeReferenceMap>({})
  const codeReferences = referencesByBucket[bucket] ?? []
  const setCodeReferences = useCallback(
    (next: SetStateAction<CodeReference[]>) => {
      setReferencesByBucket((current) => updateComposerCodeReferenceBucket(current, bucket, next))
    },
    [bucket],
  )
  const clearCodeReferenceBuckets = useCallback(
    (buckets: readonly (string | null | undefined)[]) => {
      setReferencesByBucket((current) => clearComposerCodeReferenceBuckets(current, buckets))
    },
    [],
  )

  return { codeReferences, setCodeReferences, clearCodeReferenceBuckets }
}
