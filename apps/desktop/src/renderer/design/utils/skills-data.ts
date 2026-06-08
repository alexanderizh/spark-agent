/**
 * Shared Skills data utilities
 *
 * Provides a unified data layer for skill management views.
 * All data flows through the real IPC layer (skill:list / skill:update / etc.).
 */
import { useCallback, useEffect, useState } from 'react'
import type { LocalSkillCandidate, RemoteSkillItem, SkillItem } from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'

/* ────────── Manifest Parsing ────────── */

export interface SkillManifestMeta {
  desc: string
  source: string
}

/**
 * Parse a skill's manifestJson into display-friendly metadata.
 * Returns sensible defaults when the manifest is missing or malformed.
 */
export function parseSkillManifest(manifestJson: string): SkillManifestMeta {
  try {
    const parsed = JSON.parse(manifestJson) as {
      desc?: string
      description?: string
      source?: string
    }
    return {
      desc: parsed.desc ?? parsed.description ?? 'Skill 能力模块',
      source: parsed.source ?? '自定义',
    }
  } catch {
    return { desc: 'Skill 能力模块', source: '自定义' }
  }
}

/* ────────── Skill search / filter ────────── */

/**
 * Filter skills by a search query (matches name, desc, or source).
 * Returns the original list when query is empty.
 */
export function filterSkills(
  skills: SkillItem[],
  query: string
): SkillItem[] {
  if (!query.trim()) return skills
  const q = query.toLowerCase()
  return skills.filter((s) => {
    const meta = parseSkillManifest(s.manifestJson)
    return (
      s.name.toLowerCase().includes(q) ||
      meta.desc.toLowerCase().includes(q) ||
      meta.source.toLowerCase().includes(q)
    )
  })
}

/* ────────── Deduplication ────────── */

/**
 * Deduplicate a list of installed skills by name (case-insensitive).
 * Keeps the first occurrence when multiple skills share the same name.
 */
export function deduplicateSkills(skills: SkillItem[]): SkillItem[] {
  const seen = new Set<string>()
  return skills.filter((s) => {
    const key = s.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Deduplicate a list of remote skill items by name (case-insensitive).
 */
export function deduplicateRemoteSkills(skills: RemoteSkillItem[]): RemoteSkillItem[] {
  const seen = new Set<string>()
  return skills.filter((s) => {
    const key = s.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Deduplicate a list of local skill candidates by name (case-insensitive).
 */
export function deduplicateCandidates(candidates: LocalSkillCandidate[]): LocalSkillCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((c) => {
    const key = c.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ────────── Local candidate search / filter ────────── */

/**
 * Filter local skill candidates by a search query (matches name, description, source, or rootPath).
 */
export function filterCandidates(
  candidates: LocalSkillCandidate[],
  query: string
): LocalSkillCandidate[] {
  if (!query.trim()) return candidates
  const q = query.toLowerCase()
  return candidates.filter((c) => {
    return (
      c.name.toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q) ||
      c.source.toLowerCase().includes(q) ||
      c.rootPath.toLowerCase().includes(q)
    )
  })
}

/**
 * Get unique source values from a list of candidates.
 */
export function getCandidateSources(candidates: LocalSkillCandidate[]): string[] {
  const sources = new Set<string>()
  for (const c of candidates) sources.add(c.source)
  return Array.from(sources).sort()
}

/* ────────── Pagination helpers ────────── */

/** Default page size for skill lists */
export const SKILL_PAGE_SIZE = 20

/**
 * Slice a list for paginated display.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice(0, page * pageSize)
}

/* ────────── useSkills hook ────────── */

export interface UseSkillsResult {
  /** Current skills list */
  skills: SkillItem[]
  /** Loading state */
  loading: boolean
  /** Error message */
  error: string
  /** Manually refresh the list */
  refresh: () => void
  /** Toggle a skill's enabled state */
  toggleSkill: (skill: SkillItem) => Promise<void>
  /** Delete a skill */
  deleteSkill: (id: string) => Promise<void>
  /** Statistics */
  total: number
  enabledCount: number
}

/**
 * Reusable hook that wraps all skill IPC operations.
 * Used by skill management views.
 */
export function useSkills(): UseSkillsResult {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [error, setError] = useState('')
  const { invoke: listSkills, loading } = useIpcInvoke('skill:list')
  const { invoke: updateSkill } = useIpcInvoke('skill:update')
  const { invoke: removeSkill } = useIpcInvoke('skill:delete')

  const refresh = useCallback(() => {
    setError('')
    listSkills({})
      .then((res) => setSkills(res.skills))
      .catch((err) =>
        setError(err instanceof Error ? err.message : '加载 Skills 失败')
      )
  }, [listSkills])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggleSkill = useCallback(
    async (skill: SkillItem) => {
      await updateSkill({ id: skill.id, enabled: !skill.enabled })
      refresh()
    },
    [updateSkill, refresh]
  )

  const deleteSkill = useCallback(
    async (id: string) => {
      // Optimistic update: remove from local state immediately to avoid flash/scroll reset
      setSkills((prev) => prev.filter((s) => s.id !== id))
      try {
        await removeSkill({ id })
      } catch {
        refresh() // restore correct state on error
      }
    },
    [removeSkill, refresh]
  )

  return {
    skills,
    loading,
    error,
    refresh,
    toggleSkill,
    deleteSkill,
    total: skills.length,
    enabledCount: skills.filter((s) => s.enabled).length,
  }
}
