export type VideoWorkbenchResourceFilter = 'all' | 'video' | 'image'

export interface VideoWorkbenchPickerCandidate {
  id: string
  title: string
  kind: 'video' | 'image'
  url: string
  thumbnailUrl?: string
  durationSec?: number
  width?: number
  height?: number
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function filterVideoWorkbenchPickerCandidates<T extends VideoWorkbenchPickerCandidate>(
  candidates: T[],
  filter: VideoWorkbenchResourceFilter,
  query: string,
): T[] {
  const normalizedQuery = normalizeSearchText(query)
  return candidates.filter((candidate) => {
    if (filter !== 'all' && candidate.kind !== filter) return false
    if (!normalizedQuery) return true
    const searchableText = normalizeSearchText(
      `${candidate.title} ${decodeURIComponentSafe(candidate.url.split(/[\\/]/).pop() ?? '')}`,
    )
    return searchableText.includes(normalizedQuery)
  })
}
