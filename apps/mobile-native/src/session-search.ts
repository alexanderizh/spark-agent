import { matchSession, type SessionFilterState } from '../../mobile/src/utils/session-filters'
import type { Relay, SessionSearchHit } from './relay'

const MAX_DESKTOP_OFFSET = 10_000

export type SearchResult = SessionSearchHit & { detailsMissing?: true }

// Search returns title/content hits without the fields used by list filters.
export async function hydrateSessionSearch(
  hits: SessionSearchHit[],
  getPage: (offset: number) => ReturnType<Relay['sessions']>,
  isCurrent: () => boolean,
): Promise<SearchResult[]> {
  const pending = new Map(hits.map((hit) => [hit.id, hit]))
  const matched = new Map<string, SessionSearchHit>()
  let offset: number | null = 0
  while (offset !== null && offset <= MAX_DESKTOP_OFFSET && pending.size && isCurrent()) {
    const page = await getPage(offset)
    if (!isCurrent()) return []
    for (const row of page.sessions) {
      const hit = pending.get(row.id)
      if (!hit) continue
      matched.set(row.id, { ...hit, ...row })
      pending.delete(row.id)
    }
    offset = page.nextOffset !== null && page.nextOffset > offset ? page.nextOffset : null
  }
  // Older desktops re-sort each growing candidate list before slicing. A hit
  // that moves into an earlier page may never be returned by the list route.
  return isCurrent()
    ? hits.map((hit) => matched.get(hit.id) ?? { ...hit, detailsMissing: true })
    : []
}

export function classifySearchResult(row: SearchResult, filter: SessionFilterState) {
  const needsDetails =
    filter.statuses.length || filter.labels.length || filter.projectIds.length || filter.pinnedOnly
  if (row.detailsMissing && needsDetails) {
    return matchSession(row, {
      statuses: [],
      labels: [],
      projectIds: [],
      pinnedOnly: false,
      activity: filter.activity,
    })
      ? 'unverified'
      : 'excluded'
  }
  return matchSession(row, filter) ? 'matched' : 'excluded'
}
