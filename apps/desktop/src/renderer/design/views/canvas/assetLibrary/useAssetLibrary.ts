/**
 * 资产库列表状态 hooks（步骤模式设计文档 §5.4，P2）。
 *
 * 数据一律经 P1 的 `canvasAssetRepository`（快照实现）分页读取；组件不直读
 * `snapshot.assets`。列表在外部数据版本号（`revision`，通常来自画布 store 的
 * 快照代次）变化时自动重载，保证画布操作（插入/删除/引用计数）与资产库展示一致。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { canvasApi } from '../canvas.api'
import type { CanvasAsset } from '../canvas.types'
import type { FilmAssetKind } from '../canvasFilmAssets'
import type { AssetListQuery } from './assetRepository'

export type AssetLibrarySort = NonNullable<AssetListQuery['sortBy']>

export type UseAssetLibraryOptions = {
  /** 页大小；缺省 60 */
  pageSize?: number
  /** 影视资产分类筛选；null/undefined 表示全部分类 */
  kind?: FilmAssetKind | FilmAssetKind[] | null
  /** 只看收藏 */
  favorite?: boolean
  /**
   * 外部数据版本号（如资产中心每次写库后递增的 rev / store 快照代次）。
   * 变化时重置到第一页并重载。
   */
  revision?: number
}

export type UseAssetLibraryResult = {
  items: CanvasAsset[]
  total: number
  hasMore: boolean
  loading: boolean
  /** 最近一次加载是否失败（区分空数据与请求失败；可调 refresh 重试） */
  error: boolean
  page: number
  keyword: string
  sortBy: AssetLibrarySort
  setKeyword: (value: string) => void
  setSortBy: (value: AssetLibrarySort) => void
  loadMore: () => void
  refresh: () => void
}

export function useAssetLibrary(
  projectId: string | null,
  options: UseAssetLibraryOptions = {},
): UseAssetLibraryResult {
  const { pageSize = 60, kind = null, favorite, revision } = options

  const [items, setItems] = useState<CanvasAsset[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [keyword, setKeywordState] = useState('')
  const [sortBy, setSortByState] = useState<AssetLibrarySort>('updated')

  const setKeyword = useCallback((value: string) => {
    setKeywordState(value)
  }, [])

  const setSortBy = useCallback((value: AssetLibrarySort) => {
    setSortByState(value)
  }, [])

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return
    setPage((current) => current + 1)
  }, [hasMore, loading])

  const refresh = useCallback(() => {
    setPage((current) => (current === 1 ? current : 1))
    // 已经在第一页时 page 不变，effect 不触发 —— 用递增的内部代次强制重载
    setReloadTick((tick) => tick + 1)
  }, [])

  const [reloadTick, setReloadTick] = useState(0)

  // 「查询形状」：projectId/kind/favorite/keyword/sortBy/pageSize 任一变化即视为
  // 新查询，必须从第 1 页加载（否则会以旧页码取新筛选的切片，或在加载更多之后
  // 以追加模式混入新分类的数据）。仅「形状不变 + 页码恰好 +1」视为加载更多。
  const loadShape = useMemo(
    () => JSON.stringify([projectId, kind, favorite ?? null, keyword.trim(), sortBy, pageSize]),
    [projectId, kind, favorite, keyword, sortBy, pageSize],
  )
  const lastLoadRef = useRef<{ shape: string; page: number; tick: number } | null>(null)

  useEffect(() => {
    if (!projectId) {
      setItems([])
      setTotal(0)
      setHasMore(false)
      setError(false)
      lastLoadRef.current = null
      return
    }
    const prev = lastLoadRef.current
    const shapeChanged = prev == null || prev.shape !== loadShape || prev.tick !== reloadTick
    if (shapeChanged && page !== 1) {
      // 查询形状/刷新代次变化：先回第 1 页，由下一次 effect 执行加载
      setPage(1)
      return
    }
    const appending = prev != null && !shapeChanged && prev.page + 1 === page
    lastLoadRef.current = { shape: loadShape, page, tick: reloadTick }
    let cancelled = false
    setLoading(true)
    setError(false)
    const query: AssetListQuery = {
      page,
      pageSize,
      ...(kind ? { kind } : {}),
      ...(favorite !== undefined ? { favorite } : {}),
      ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      sortBy,
    }
    canvasApi
      .listAssetsPaged(projectId, query)
      .then((result) => {
        if (cancelled) return
        setTotal(result.total)
        setHasMore(result.hasMore)
        setItems((current) => (appending ? [...current, ...result.items] : result.items))
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        // 追加失败保留已加载内容；重置失败才清空（配合 error 态展示重试）
        if (!appending) {
          setItems([])
          setTotal(0)
          setHasMore(false)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, page, pageSize, kind, favorite, keyword, sortBy, reloadTick, loadShape])

  // 外部 revision 变化 → 重置重载（refresh 是稳定引用，无需进依赖）
  const firstRevisionRef = useRef(true)
  useEffect(() => {
    if (firstRevisionRef.current) {
      firstRevisionRef.current = false
      return
    }
    refresh()
  }, [revision, refresh])

  return useMemo(
    () => ({
      items,
      total,
      hasMore,
      loading,
      error,
      page,
      keyword,
      sortBy,
      setKeyword,
      setSortBy,
      loadMore,
      refresh,
    }),
    [
      items,
      total,
      hasMore,
      loading,
      error,
      page,
      keyword,
      sortBy,
      setKeyword,
      setSortBy,
      loadMore,
      refresh,
    ],
  )
}
