/**
 * Shared Skills data utilities
 *
 * Provides a unified data layer for skill management views.
 * All data flows through the real IPC layer (skill:list / skill:update / etc.).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  InstallableSkillCatalogItem,
  LocalSkillCandidate,
  SkillRegistryCategoryItem,
  RemoteSkillItem,
  SkillHubShowcaseSection,
  SkillItem,
} from '@spark/protocol'
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

/** Page size for SkillHub marketplace lists and searches */
export const SKILLHUB_PAGE_SIZE = 20

/**
 * Slice a list for paginated display.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
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
      const nextEnabled = !skill.enabled
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, enabled: nextEnabled } : s))
      )
      try {
        await updateSkill({ id: skill.id, enabled: nextEnabled })
      } catch {
        setSkills((prev) =>
          prev.map((s) => (s.id === skill.id ? { ...s, enabled: skill.enabled } : s))
        )
      }
    },
    [updateSkill]
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

  // 计数按去重（同名）口径，与下方分区展示一致，避免"宿主软链重复"导致数字虚高。
  const dedupedSkills = deduplicateSkills(skills)
  return {
    skills,
    loading,
    error,
    refresh,
    toggleSkill,
    deleteSkill,
    total: dedupedSkills.length,
    enabledCount: dedupedSkills.filter((s) => s.enabled).length,
  }
}

/* ────────── Installable Catalog（内置可安装技能卡片） ────────── */

/**
 * 读取内置可安装技能清单（含安装状态）。
 * 沿用 useSkills 的成熟写法（数据获取在本 hook 内），便于组件直接消费。
 */
export function useInstallableCatalog(): {
  items: InstallableSkillCatalogItem[]
  loading: boolean
  error: string
  refresh: () => void
} {
  const [items, setItems] = useState<InstallableSkillCatalogItem[]>([])
  const [error, setError] = useState('')
  const { invoke: listInstallable, loading } = useIpcInvoke('skill:list-installable')

  const refresh = useCallback(() => {
    setError('')
    listInstallable({})
      .then((res) => setItems(res.items))
      .catch((err) =>
        setError(err instanceof Error ? err.message : '加载精选技能失败'),
      )
  }, [listInstallable])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, loading, error, refresh }
}

/* ────────── SkillHub Featured（推荐精选 = 网页 sortBy=curated_score） ────────── */

/**
 * 拉取的池子上限。
 *
 * SkillHub 的 /api/v1/showcase/recommended 接口不接收 limit 参数、总是返回全量推荐
 * （约 60+ 条），因此把 limit 调大**不会增加任何网络开销**——只是让 adapter 在内存里少
 * slice 一些。这里拉一个较大的池子，前端「换一批」就在池子里本地随机重抽，零额外请求。
 */
const SKILLHUB_FEATURED_POOL = 60

/** Fisher-Yates 洗牌（返回新数组，不改原数组）。 */
function shuffleArray<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

/**
 * 拉取 SkillHub 推荐精选技能（国内首选源，内容走腾讯云 COS 加速）。
 * 用于精选技能页的「SkillHub 推荐精选」分区。
 *
 * 内部拉一个较大池子（`SKILLHUB_FEATURED_POOL`），`skills` 暴露**全量去重后的池子**，
 * 由调用方自行分页（`paginate` + `SKILLHUB_PAGE_SIZE`）。`shuffle()` 在本地池子里整体
 * 洗牌，实现「换一批」而不额外打远程——洗牌后调用方应把页码重置回 1。
 *
 * 传 `section` 可切换榜单（`recommended` / `hot_downloads`）；section 改变时
 * 会自动重新拉取。`category` 为分类 key（如 'office-efficiency'）时透传给后端做服务端过滤。
 * `refresh()` 用于切 section/category 后强制再拉一次。
 */
export function useSkillHubFeatured(
  opts: { section?: SkillHubShowcaseSection; category?: string } = {},
): {
  skills: RemoteSkillItem[]
  loading: boolean
  error: string
  refresh: () => void
  shuffle: () => void
} {
  const [skills, setSkills] = useState<RemoteSkillItem[]>([])
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const { invoke: featured, loading } = useIpcInvoke('skill-registry:featured')

  const section: SkillHubShowcaseSection = opts.section ?? 'recommended'
  // 'all' 与空值等价（不传）；其他值视为分类 key 直接透传
  const category = opts.category && opts.category !== 'all' ? opts.category : ''

  const refresh = useCallback(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setError('')
    featured({
      registryId: 'skillhub',
      limit: SKILLHUB_FEATURED_POOL,
      section,
      ...(category ? { category } : {}),
    })
      .then((res) => {
        if (requestId !== requestIdRef.current) return
        setSkills(deduplicateRemoteSkills(res.skills ?? []))
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return
        setError(err instanceof Error ? err.message : '加载 SkillHub 推荐失败')
        setSkills([])
      })
  }, [featured, section, category])

  const shuffle = useCallback(() => {
    setSkills((prev) => shuffleArray(prev))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { skills, loading, error, refresh, shuffle }
}

/* ────────── SkillHub Categories（顶部 chip 条） ────────── */

/**
 * 拉取 SkillHub 分类列表（每项含 key/name，service 已 prepend '全部'）。
 * 用于精选市场页的横向分类 chip 条：chip 显示 name，点击后用 key 做后端过滤。
 */
export function useSkillHubCategories(): {
  categories: SkillRegistryCategoryItem[]
  loading: boolean
  error: string
  refresh: () => void
} {
  const [categories, setCategories] = useState<SkillRegistryCategoryItem[]>([
    { key: 'all', name: '全部' },
  ])
  const [error, setError] = useState('')
  const { invoke: listCategories, loading } = useIpcInvoke('skill-registry:categories')

  const refresh = useCallback(() => {
    setError('')
    listCategories({ registryId: 'skillhub' })
      .then((res) => {
        const list = res.categories ?? []
        // 兜底：若 service 没 prepend '全部'，前端加一下
        setCategories(
          list.length > 0 && list[0]?.key === 'all' ? list : [{ key: 'all', name: '全部' }, ...list],
        )
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载 SkillHub 分类失败')
        setCategories([{ key: 'all', name: '全部' }])
      })
  }, [listCategories])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { categories, loading, error, refresh }
}

/* ────────── SkillHub Search（关键词搜索，走 skill-registry:search） ────────── */

/**
 * 按关键词搜索 SkillHub 技能。
 * query 去除首尾空格后为空时不发请求（交由调用方回退到 featured）；
 * 非 empty 时 debounce 300ms 调用 skill-registry:search，避免逐键打远程。
 *
 * `category` 为分类 key（如 'office-efficiency'）时透传给后端做服务端过滤；
 * 空值/'all' 不传。
 */
export function useSkillHubSearch(
  query: string,
  limit = SKILLHUB_PAGE_SIZE,
  opts: { category?: string; offset?: number } = {},
): {
  skills: RemoteSkillItem[]
  total: number
  loading: boolean
  error: string
  searching: boolean
  refresh: () => void
} {
  const [skills, setSkills] = useState<RemoteSkillItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const { invoke: search } = useIpcInvoke('skill-registry:search')

  const term = query.trim()
  const category = opts.category && opts.category !== 'all' ? opts.category : ''
  const offset = Math.max(0, opts.offset ?? 0)

  useEffect(() => {
    if (!term) {
      setSkills([])
      setTotal(0)
      setError('')
      setLoading(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      setError('')
      search({
        registryId: 'skillhub',
        query: term,
        limit,
        offset,
        ...(category ? { category } : {}),
      })
        .then((res) => {
          if (cancelled) return
          setSkills(deduplicateRemoteSkills(res.skills ?? []))
          setTotal(res.total)
        })
        .catch((err) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : '搜索 SkillHub 技能失败')
          setSkills([])
          setTotal(0)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term, limit, offset, category, search, refreshKey])

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1)
  }, [])

  return { skills, total, loading, error, searching: term.length > 0, refresh }
}
