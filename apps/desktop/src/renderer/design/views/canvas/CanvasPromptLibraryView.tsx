import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Checkbox, Empty, Input, Modal, Popconfirm, Select, Spin, message } from 'antd'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import { useApp } from '../../AppContext'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import promptLibraryPlaceholderCover from '../../../assets/canvas-prompt-library-placeholder-cover.png'
import { useCanvasProjects } from './canvas.store'
import { canvasApi } from './canvas.api'
import { CanvasPromptCoverGenerator } from './CanvasPromptCoverGenerator'
import { readFileAsDataUrl } from './canvas-safe-file'
import type { CanvasAsset, CanvasSnapshot } from './canvas.types'
import { filmUid, readAssetKind } from './canvasFilmAssets'
import {
  getPromptCategory,
  getPromptCategoryUsage,
  readLastPromptCategory,
  readPromptLibraryCategories,
  saveLastPromptCategory,
} from './canvasPromptLibraryCategories'
import { readPromptLibraryCover, readPromptLibraryText } from './canvasPromptLibraryData'
import {
  globalPromptToCanvasAsset,
  readGlobalPromptLibrary,
  writeGlobalPromptLibrary,
  type GlobalPromptLibraryItem,
  type GlobalPromptLibraryState,
} from './canvasPromptLibraryStore'
import {
  exportPromptLibraryPackage,
  importPromptLibraryPackage,
  mergeImportedPromptLibrary,
  promptCoverUrlToDataUrl,
} from './canvasPromptLibraryPackage'
import './canvas-prompt-library.less'

type PromptEditorState = {
  source: 'global' | 'project'
  assetId: string | null
  projectId: string | null
  title: string
  text: string
  category: string
  tags: string[]
  coverAssetId: string | null
  coverUrl: string | null
  coverMimeType: string | null
  coverFile: File | null
  coverPreviewUrl: string | null
}

const EMPTY_EDITOR: PromptEditorState = {
  source: 'global',
  assetId: null,
  projectId: null,
  title: '',
  text: '',
  category: '',
  tags: [],
  coverAssetId: null,
  coverUrl: null,
  coverMimeType: null,
  coverFile: null,
  coverPreviewUrl: null,
}

function defaultCategory(categories: string[]): string {
  const last = readLastPromptCategory()
  return (last && categories.includes(last) ? last : categories[0]) ?? ''
}

function editorFromAsset(
  asset: CanvasAsset,
  coverAssets: CanvasAsset[],
  source: 'global' | 'project',
): PromptEditorState {
  const cover = readPromptLibraryCover(asset, coverAssets)
  return {
    source,
    assetId: asset.id,
    projectId: source === 'project' ? asset.projectId : null,
    title: asset.title ?? '',
    text: readPromptLibraryText(asset),
    category: getPromptCategory(asset) ?? '',
    tags: Array.isArray(asset.metadata.tags)
      ? asset.metadata.tags.filter((item): item is string => typeof item === 'string')
      : [],
    coverAssetId: cover.assetId,
    coverUrl: cover.url,
    coverMimeType: cover.mimeType,
    coverFile: null,
    coverPreviewUrl: null,
  }
}

type ProjectPromptEntry = {
  asset: CanvasAsset
  projectName: string
  projectAssets: CanvasAsset[]
}

type PromptLibrarySource = 'all' | 'global' | 'project'

export function CanvasPromptLibraryView() {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const { t } = useApp()
  const { projects } = useCanvasProjects()
  const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null)
  const [library, setLibrary] = useState<GlobalPromptLibraryState | null>(null)
  const [projectEntries, setProjectEntries] = useState<ProjectPromptEntry[]>([])
  const [activeSource, setActiveSource] = useState<PromptLibrarySource>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [editor, setEditor] = useState<PromptEditorState | null>(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [categorySaving, setCategorySaving] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const reloadRequestRef = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++reloadRequestRef.current
    setLoading(true)
    setError('')
    try {
      const nextLibrary = await readGlobalPromptLibrary()
      const projectSnapshots = await Promise.all(
        projects.map(async (project) => {
          try {
            const snap = await canvasApi.openSnapshot(project.id)
            return { project, snap }
          } catch {
            return null
          }
        }),
      )
      const nextProjectEntries: ProjectPromptEntry[] = projectSnapshots.flatMap((entry) => {
        if (!entry) return []
        return entry.snap.assets
          .filter((asset) => readAssetKind(asset) === 'prompt_library')
          .map((asset) => ({
            asset,
            projectName: entry.project.title,
            projectAssets: entry.snap.assets,
          }))
      })
      const nextSnapshot = projectSnapshots[0]?.snap ?? null
      if (requestId === reloadRequestRef.current) {
        setLibrary(nextLibrary)
        setProjectEntries(nextProjectEntries)
        setSnapshot(nextSnapshot)
      }
    } catch (loadError) {
      if (requestId === reloadRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : translate('canvasPromptLibrary.t1'))
      }
    } finally {
      if (requestId === reloadRequestRef.current) setLoading(false)
    }
  }, [projects])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setEditor((current) => {
      if (current?.coverPreviewUrl?.startsWith('blob:'))
        URL.revokeObjectURL(current.coverPreviewUrl)
      return null
    })
    setCategoryManagerOpen(false)
    setActiveCategory('all')
    setQuery('')
  }, [])

  const globalAssets = useMemo(
    () => (library?.items ?? []).map(globalPromptToCanvasAsset),
    [library],
  )
  const visibleProjectEntries = useMemo(
    () =>
      projectEntries.filter(
        ({ asset }) =>
          !(library?.items ?? []).some(
            (item) =>
              item.id === `legacy:${asset.projectId}:${asset.id}` ||
              item.id === `legacy:${asset.id}`,
          ),
      ),
    [library, projectEntries],
  )
  const categories = useMemo(
    () =>
      library?.categories.length ? library.categories : readPromptLibraryCategories(undefined),
    [library],
  )
  const allPromptAssets = useMemo(
    () => [...globalAssets, ...visibleProjectEntries.map((entry) => entry.asset)],
    [globalAssets, visibleProjectEntries],
  )
  const usage = useMemo(() => getPromptCategoryUsage(allPromptAssets), [allPromptAssets])
  const sourceCount = useMemo(
    () => ({
      all: globalAssets.length + visibleProjectEntries.length,
      global: globalAssets.length,
      project: visibleProjectEntries.length,
    }),
    [globalAssets, visibleProjectEntries],
  )
  const filteredGlobalAssets = useMemo(() => {
    if (activeSource === 'project') return []
    const cleanQuery = query.trim().toLowerCase()
    return globalAssets.filter((asset) => {
      const category = getPromptCategory(asset)
      if (activeCategory !== 'all' && category !== activeCategory) return false
      if (!cleanQuery) return true
      const haystack = `${asset.title ?? ''} ${readPromptLibraryText(asset)} ${category ?? ''} ${
        Array.isArray(asset.metadata.tags) ? asset.metadata.tags.join(' ') : ''
      }`.toLowerCase()
      return haystack.includes(cleanQuery)
    })
  }, [activeCategory, activeSource, globalAssets, query])
  const filteredProjectEntries = useMemo(() => {
    if (activeSource === 'global') return []
    const cleanQuery = query.trim().toLowerCase()
    return visibleProjectEntries.filter(({ asset, projectName }) => {
      const category = getPromptCategory(asset)
      if (activeCategory !== 'all' && category !== activeCategory) return false
      if (!cleanQuery) return true
      const haystack = `${asset.title ?? ''} ${readPromptLibraryText(asset)} ${category ?? ''} ${
        Array.isArray(asset.metadata.tags) ? asset.metadata.tags.join(' ') : ''
      } ${projectName}`.toLowerCase()
      return haystack.includes(cleanQuery)
    })
  }, [activeCategory, activeSource, query, visibleProjectEntries])
  const visibleSelectableKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const asset of filteredGlobalAssets) keys.add(`global:${asset.id}`)
    for (const { asset } of filteredProjectEntries) {
      keys.add(`project:${asset.projectId}:${asset.id}`)
    }
    return keys
  }, [filteredGlobalAssets, filteredProjectEntries])
  const allVisibleSelected =
    visibleSelectableKeys.size > 0 &&
    [...visibleSelectableKeys].every((key) => selectedKeys.has(key))
  const someVisibleSelected = [...visibleSelectableKeys].some((key) => selectedKeys.has(key))

  const enterSelectionMode = () => {
    setSelectionMode(true)
    setSelectedKeys(new Set())
    setEditor((current) => {
      if (current?.coverPreviewUrl?.startsWith('blob:'))
        URL.revokeObjectURL(current.coverPreviewUrl)
      return null
    })
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedKeys(new Set())
  }

  const toggleSelectedKey = (key: string) => {
    setSelectedKeys((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    setSelectedKeys((previous) => {
      if ([...visibleSelectableKeys].every((key) => previous.has(key))) {
        const next = new Set(previous)
        for (const key of visibleSelectableKeys) next.delete(key)
        return next
      }
      return new Set([...previous, ...visibleSelectableKeys])
    })
  }

  const handleExportSelected = async () => {
    if (!library || selectedKeys.size === 0 || exporting) return
    setExporting(true)
    try {
      const items: GlobalPromptLibraryItem[] = []
      let skippedCovers = 0
      for (const item of library.items) {
        if (!selectedKeys.has(`global:${item.id}`)) continue
        const coverUrl = await promptCoverUrlToDataUrl(item.coverUrl)
        if (item.coverUrl && !coverUrl) skippedCovers += 1
        items.push({ ...item, coverUrl, coverMimeType: coverUrl ? item.coverMimeType : null })
      }
      for (const { asset, projectAssets } of projectEntries) {
        if (!selectedKeys.has(`project:${asset.projectId}:${asset.id}`)) continue
        const text = readPromptLibraryText(asset)
        if (!text.trim()) continue
        const cover = readPromptLibraryCover(asset, projectAssets)
        const coverUrl = await promptCoverUrlToDataUrl(cover.url)
        if (cover.url && !coverUrl) skippedCovers += 1
        items.push({
          id: asset.id,
          title: asset.title ?? '-',
          text,
          category: getPromptCategory(asset) ?? '',
          tags: Array.isArray(asset.metadata.tags)
            ? asset.metadata.tags.filter((tag): tag is string => typeof tag === 'string')
            : [],
          coverUrl,
          coverMimeType: coverUrl ? (cover.mimeType ?? 'image/png') : null,
          usageCount:
            typeof asset.metadata.usageCount === 'number' &&
            Number.isFinite(asset.metadata.usageCount)
              ? asset.metadata.usageCount
              : 0,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        })
      }
      if (items.length === 0) {
        message.warning(translate('canvasPromptLibrary.t2'))
        return
      }
      const result = await exportPromptLibraryPackage({ categories, items })
      if (!result.exported) {
        if (result.error) message.error(translate('canvasPromptLibrary.tpl5Desc', { reason: result.error }))
        return
      }
      message.success(
        translate('canvasPromptLibrary.tpl1Desc', {
          count: result.exportedCount ?? items.length,
          rest:
            skippedCovers > 0
              ? translate('canvasPromptLibrary.tpl2Desc', { count: skippedCovers })
              : '',
        }),
      )
      exitSelectionMode()
    } catch (exportError) {
      message.error(exportError instanceof Error ? exportError.message : translate('canvasPromptLibrary.t3'))
    } finally {
      setExporting(false)
    }
  }

  const handleImportPackage = async () => {
    if (!library || importing) return
    setImporting(true)
    try {
      const payload = await importPromptLibraryPackage()
      if (!payload) return
      const { next, importedCount, skippedCount } = mergeImportedPromptLibrary(library, payload)
      if (importedCount === 0) {
        message.info(
          skippedCount > 0
            ? translate('canvasPromptLibrary.tpl6Desc', { count: skippedCount })
            : translate('canvasPromptLibrary.t4Desc'),
        )
        return
      }
      await writeGlobalPromptLibrary(next)
      setLibrary(next)
      message.success(
        translate('canvasPromptLibrary.tpl7Desc', {
          count: importedCount,
          rest:
            skippedCount > 0
              ? translate('canvasPromptLibrary.tpl8Desc', { count: skippedCount })
              : '',
        }),
      )
    } catch (importError) {
      message.error(importError instanceof Error ? importError.message : translate('canvasPromptLibrary.t5'))
    } finally {
      setImporting(false)
    }
  }

  const openCreatePrompt = useCallback(() => {
    setEditor({ ...EMPTY_EDITOR, category: defaultCategory(categories) })
  }, [categories])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'e' ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      )
        return
      const target = event.target as HTMLElement | null
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        Boolean(target?.closest('.ant-modal, .ant-drawer'))
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (!editor && !categoryManagerOpen && snapshot) {
        openCreatePrompt()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [categoryManagerOpen, editor, openCreatePrompt, snapshot])

  const openEditPrompt = (
    asset: CanvasAsset,
    source: 'global' | 'project',
    coverAssets: CanvasAsset[],
  ) => {
    setEditor(editorFromAsset(asset, coverAssets, source))
  }

  const closeEditor = () => {
    if (editor?.coverPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(editor.coverPreviewUrl)
    setEditor(null)
  }

  const handleCoverFile = (file: File | undefined) => {
    if (!file || !editor) return
    if (!file.type.startsWith('image/')) {
      message.warning(translate('canvasPromptLibrary.t6'))
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      message.warning(translate('canvasPromptLibrary.t7Desc'))
      return
    }
    if (editor.coverPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(editor.coverPreviewUrl)
    setEditor({
      ...editor,
      coverFile: file,
      coverAssetId: null,
      coverUrl: null,
      coverMimeType: file.type,
      coverPreviewUrl: URL.createObjectURL(file),
    })
  }

  const handleSavePrompt = async () => {
    if (!editor) return
    const promptText = editor.text.trim()
    if (!promptText) {
      message.warning(translate('canvasPromptLibrary.t8'))
      return
    }
    const promptTitle = editor.title.trim() || '-'
    setSaving(true)
    try {
      let uploadedCover: { url: string; mimeType: string } | null = null
      if (editor.coverFile) {
        const dataUrl = await readFileAsDataUrl(editor.coverFile)
        uploadedCover = {
          url: dataUrl,
          mimeType: editor.coverFile.type,
        }
      }

      if (editor.source === 'project') {
        if (!editor.projectId || !editor.assetId) {
          message.warning(translate('canvasPromptLibrary.t9Desc'))
          return
        }
        const existingEntry = visibleProjectEntries.find(
          (entry) => entry.asset.id === editor.assetId,
        )
        const existingAttributes = (existingEntry?.asset.metadata?.attributes ?? {}) as Record<
          string,
          string
        >
        await canvasApi.updateFilmAsset(editor.projectId, editor.assetId, {
          title: promptTitle,
          contentText: promptText,
          prompt: promptText,
          tags: editor.tags,
          attributes: {
            ...existingAttributes,
            promptCategory: editor.category.trim(),
            coverUrl: uploadedCover?.url ?? editor.coverUrl ?? '',
            coverMimeType: uploadedCover?.mimeType ?? editor.coverMimeType ?? '',
          },
        })
        saveLastPromptCategory(editor.category)
        closeEditor()
        message.success(translate('canvasPromptLibrary.t10'))
        void reload()
        return
      }

      if (!library) return
      const existing = editor.assetId
        ? library.items.find((item) => item.id === editor.assetId)
        : undefined
      const now = new Date().toISOString()
      const nextItem: GlobalPromptLibraryItem = {
        id: existing?.id ?? filmUid('prompt'),
        title: promptTitle,
        text: promptText,
        category: editor.category.trim(),
        tags: editor.tags,
        coverUrl: uploadedCover?.url ?? editor.coverUrl,
        coverMimeType: uploadedCover?.mimeType ?? editor.coverMimeType,
        usageCount: existing?.usageCount ?? 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      const nextLibrary = {
        ...library,
        items: existing
          ? library.items.map((item) => (item.id === existing.id ? nextItem : item))
          : [...library.items, nextItem],
      }
      await writeGlobalPromptLibrary(nextLibrary)
      setLibrary(nextLibrary)
      saveLastPromptCategory(editor.category)
      closeEditor()
      message.success(editor.assetId ? translate('canvasPromptLibrary.t10') : translate('canvasPromptLibrary.t11'))
    } catch (saveError) {
      message.error(saveError instanceof Error ? saveError.message : translate('canvasPromptLibrary.t12'))
    } finally {
      setSaving(false)
    }
  }

  const persistCategories = async (nextCategories: string[]) => {
    if (!library) return
    setCategorySaving(true)
    try {
      const next = { ...library, categories: nextCategories }
      await writeGlobalPromptLibrary(next)
      setLibrary(next)
      return next
    } finally {
      setCategorySaving(false)
    }
  }

  const createCategory = async (name: string): Promise<string | null> => {
    const nextName = name.trim()
    if (!nextName) return null
    if (categories.includes(nextName)) {
      message.warning(translate('canvasPromptLibrary.t13'))
      return null
    }
    try {
      await persistCategories([...categories, nextName])
      setEditor((current) => (current ? { ...current, category: nextName } : current))
      return nextName
    } catch (error) {
      message.error(error instanceof Error ? error.message : translate('canvasPromptLibrary.t14'))
      return null
    }
  }

  const renameCategory = async (from: string, to: string) => {
    const nextName = to.trim()
    if (!nextName || nextName === from || categories.includes(nextName)) return
    try {
      const nextCategories = categories.map((category) => (category === from ? nextName : category))
      await persistCategories(nextCategories)
      if (library) {
        const nextItems = library.items.map((item) =>
          item.category === from
            ? { ...item, category: nextName, updatedAt: new Date().toISOString() }
            : item,
        )
        const next = { ...library, categories: nextCategories, items: nextItems }
        await writeGlobalPromptLibrary(next)
        setLibrary(next)
      }
      if (activeCategory === from) setActiveCategory(nextName)
    } catch (error) {
      message.error(error instanceof Error ? error.message : translate('canvasPromptLibrary.t15'))
    }
  }

  const deleteCategory = async (category: string) => {
    if (categories.length <= 1) {
      message.warning(translate('canvasPromptLibrary.t16'))
      return
    }
    const fallback = categories.find((item) => item !== category) ?? categories[0] ?? ''
    const count = usage[category] ?? 0
    if (
      count > 0 &&
      !window.confirm(translate('canvasPromptLibrary.tpl10Desc', { category, count, fallback }))
    )
      return
    try {
      const nextCategories = categories.filter((item) => item !== category)
      const nextItems =
        library?.items.map((item) =>
          item.category === category
            ? { ...item, category: fallback, updatedAt: new Date().toISOString() }
            : item,
        ) ?? []
      const next = {
        ...(library as GlobalPromptLibraryState),
        categories: nextCategories,
        items: nextItems,
      }
      await writeGlobalPromptLibrary(next)
      setLibrary(next)
      if (activeCategory === category) setActiveCategory('all')
    } catch (error) {
      message.error(error instanceof Error ? error.message : translate('canvasPromptLibrary.t17'))
    }
  }

  const handleCopyPrompt = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(translate('canvasPromptLibrary.tpl11Desc', { title: label }))
    } catch {
      message.error(translate('canvasPromptLibrary.t18'))
    }
  }

  const handleDeletePrompt = async (asset: CanvasAsset, source: 'global' | 'project') => {
    try {
      if (source === 'project') {
        await canvasApi.deleteFilmAsset(asset.projectId, asset.id, { hardDelete: true })
        if (editor?.assetId === asset.id) closeEditor()
        message.success(translate('canvasPromptLibrary.tpl9Desc', { title: asset.title ?? translate('canvasPromptLibrary.t19') }))
        void reload()
        return
      }
      if (!library) return
      const nextLibrary = {
        ...library,
        items: library.items.filter((item) => item.id !== asset.id),
      }
      await writeGlobalPromptLibrary(nextLibrary)
      setLibrary(nextLibrary)
      if (editor?.assetId === asset.id) closeEditor()
      message.success(translate('canvasPromptLibrary.tpl9Desc', { title: asset.title ?? translate('canvasPromptLibrary.t19') }))
    } catch (deleteError) {
      message.error(deleteError instanceof Error ? deleteError.message : translate('canvasPromptLibrary.t20'))
    }
  }

  const currentCoverUrl = editor?.coverPreviewUrl ?? editor?.coverUrl ?? null

  return (
    <section className="canvas-prompt-library-page" aria-label={translate('canvasPromptLibrary.t32')}>
      <header
        className="canvas-prompt-library-page-header canvas-view-titlebar"
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        {t.sidebarHidden && <SidebarExpandButton />}
        <div className="canvas-prompt-library-title-wrap">
          <h2>{translate('canvasPromptLibrary.t32')}</h2>
        </div>
        <div className="canvas-prompt-library-header-actions">
          <span className="canvas-prompt-library-shortcut">{translate('canvasPromptLibrary.t53Desc')}</span>
          <Button
            size="small"
            type="text"
            loading={importing}
            disabled={!library}
            onClick={() => void handleImportPackage()}
            icon={<Icons.Upload size={15} />}
            aria-label={translate('canvasPromptLibrary.t33')}
          >
            {translate('canvasPromptLibrary.t54')}
          </Button>
          <Button
            size="small"
            type="text"
            disabled={!library || selectionMode}
            onClick={enterSelectionMode}
            icon={<Icons.Download size={15} />}
            aria-label={translate('canvasPromptLibrary.t34')}
          >
            {translate('canvasPromptLibrary.t55')}
          </Button>
          <Button
            size="small"
            type="text"
            loading={loading}
            onClick={() => void reload()}
            icon={<Icons.Refresh size={15} />}
            aria-label={translate('canvasPromptLibrary.t35')}
          >
            {translate('canvasPromptLibrary.t56')}
          </Button>
          <Button size="small" type="text" onClick={openCreatePrompt} disabled={!library}>
            <Icons.Plus size={15} /> {translate('canvasPromptLibrary.t29')}
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="canvas-prompt-library-loading">
          <Spin />
        </div>
      ) : error ? (
        <div className="canvas-prompt-library-error" role="alert">
          {error}
        </div>
      ) : library ? (
        <div className="canvas-prompt-library-content">
          <div className="canvas-prompt-library-toolbar">
            <div
              className="canvas-prompt-library-source-filter"
              role="tablist"
              aria-label={translate('canvasPromptLibrary.t36')}
            >
              {(
                [
                  ['all', translate('canvasPromptLibrary.t21')],
                  ['global', translate('canvasPromptLibrary.t22')],
                  ['project', translate('canvasPromptLibrary.t23')],
                ] as const
              ).map(([source, label]) => (
                <button
                  key={source}
                  type="button"
                  className={activeSource === source ? 'active' : ''}
                  onClick={() => setActiveSource(source)}
                >
                  {label} <small>{sourceCount[source]}</small>
                </button>
              ))}
            </div>
            <div
              className="canvas-prompt-library-categories"
              role="tablist"
              aria-label={translate('canvasPromptLibrary.t37')}
            >
              <button
                type="button"
                className={activeCategory === 'all' ? 'active' : ''}
                onClick={() => setActiveCategory('all')}
              >
                {translate('canvasPromptLibrary.t21')} <small>{sourceCount.all}</small>
              </button>
              {categories.map((category) => (
                <button
                  type="button"
                  className={activeCategory === category ? 'active' : ''}
                  key={category}
                  onClick={() => setActiveCategory(category)}
                >
                  {category} <small>{usage[category] ?? 0}</small>
                </button>
              ))}
              <button type="button" className="manage" onClick={() => setCategoryManagerOpen(true)}>
                <Icons.Settings size={13} /> {translate('canvasPromptLibrary.t51')}
              </button>
            </div>
            <div className="canvas-prompt-library-toolbar-tools">
              <Input
                allowClear
                className="canvas-prompt-library-search"
                prefix={<Icons.Search size={15} />}
                placeholder={translate('canvasPromptLibrary.t38')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          {selectionMode && (
            <div
              className="canvas-prompt-library-selection-bar"
              role="toolbar"
              aria-label={translate('canvasPromptLibrary.t39')}
            >
              <label className="canvas-prompt-library-selection-all">
                <Checkbox
                  checked={allVisibleSelected}
                  indeterminate={!allVisibleSelected && someVisibleSelected}
                  onChange={toggleSelectAllVisible}
                />
                <span>{translate('canvasPromptLibrary.tpl12Desc', { count: visibleSelectableKeys.size })}</span>
              </label>
              <span className="canvas-prompt-library-selection-count">
                {translate('canvasPromptLibrary.tpl13Desc', { count: selectedKeys.size })}
              </span>
              <div className="canvas-prompt-library-selection-actions">
                <Button
                  size="small"
                  onClick={() => setSelectedKeys(new Set())}
                  disabled={selectedKeys.size === 0}
                >
                  {translate('canvasPromptLibrary.t57')}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  loading={exporting}
                  disabled={selectedKeys.size === 0}
                  onClick={() => void handleExportSelected()}
                >
                  {translate('canvasPromptLibrary.t74')}{selectedKeys.size > 0 ? translate('canvasPromptLibrary.tpl14Desc', { count: selectedKeys.size }) : ''}
                </Button>
                <Button size="small" onClick={exitSelectionMode}>
                  {translate('canvasPromptLibrary.t58')}
                </Button>
              </div>
            </div>
          )}

          {filteredGlobalAssets.length === 0 && filteredProjectEntries.length === 0 ? (
            <Empty
              className="canvas-prompt-library-empty"
              description={query ? translate('canvasPromptLibrary.t24') : translate('canvasPromptLibrary.t25')}
            />
          ) : (
            <div className="canvas-prompt-library-card-grid">
              {filteredGlobalAssets.map((asset) => {
                const coverUrl = readPromptLibraryCover(asset, snapshot?.assets ?? []).url
                const selectionKey = `global:${asset.id}`
                const selected = selectedKeys.has(selectionKey)
                return (
                  <article
                    key={selectionKey}
                    className={`canvas-prompt-library-card${selectionMode ? ' selecting' : ''}${
                      selectionMode && selected ? ' selected' : ''
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectionMode ? selected : undefined}
                    onClick={() =>
                      selectionMode
                        ? toggleSelectedKey(selectionKey)
                        : openEditPrompt(asset, 'global', snapshot?.assets ?? [])
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (selectionMode) toggleSelectedKey(selectionKey)
                        else openEditPrompt(asset, 'global', snapshot?.assets ?? [])
                      }
                    }}
                  >
                    <div className="canvas-prompt-library-card-cover">
                      {selectionMode && (
                        <span
                          className="canvas-prompt-library-card-check"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            checked={selected}
                            onChange={() => toggleSelectedKey(selectionKey)}
                          />
                        </span>
                      )}
                      {coverUrl ? (
                        <PromptLibraryCoverImage src={coverUrl} />
                      ) : (
                        <PromptLibraryCoverPlaceholder />
                      )}
                      <span className="canvas-prompt-library-card-source">{translate('canvasPromptLibrary.t22')}</span>
                    </div>
                    <div className="canvas-prompt-library-card-body">
                      <div className="canvas-prompt-library-card-title-row">
                        <h3>{asset.title || translate('canvasPromptLibrary.t26')}</h3>
                      </div>
                      <p>{readPromptLibraryText(asset) || translate('canvasPromptLibrary.t27')}</p>
                      <div className="canvas-prompt-library-card-actions">
                        <button
                          type="button"
                          className="canvas-prompt-library-copy"
                          aria-label={translate('canvasPromptLibrary.tpl15Desc', { title: asset.title ?? translate('canvasPromptLibrary.t19') })}
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleCopyPrompt(
                              readPromptLibraryText(asset),
                              asset.title ?? translate('canvasPromptLibrary.t19'),
                            )
                          }}
                        >
                          {translate('canvasPromptLibrary.t59')}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEditPrompt(asset, 'global', snapshot?.assets ?? [])
                          }}
                        >
                          {translate('canvasPromptLibrary.t60')}
                        </button>
                        <span onClick={(event) => event.stopPropagation()}>
                          <Popconfirm
                            title={translate('canvasPromptLibrary.t40')}
                            description={translate('canvasPromptLibrary.t41')}
                            okText={translate('canvasPromptLibrary.t42')}
                            cancelText={translate('canvasPromptLibrary.t43')}
                            okType="danger"
                            onConfirm={() => void handleDeletePrompt(asset, 'global')}
                          >
                            <button
                              type="button"
                              className="canvas-prompt-library-delete"
                              aria-label={translate('canvasPromptLibrary.tpl16Desc', { title: asset.title ?? translate('canvasPromptLibrary.t19') })}
                            >
                              {translate('canvasPromptLibrary.t42')}
                            </button>
                          </Popconfirm>
                        </span>
                      </div>
                    </div>
                  </article>
                )
              })}
              {filteredProjectEntries.map((entry) => {
                const { asset, projectName, projectAssets } = entry
                const coverUrl = readPromptLibraryCover(asset, projectAssets).url
                const selectionKey = `project:${asset.projectId}:${asset.id}`
                const selected = selectedKeys.has(selectionKey)
                return (
                  <article
                    key={selectionKey}
                    className={`canvas-prompt-library-card${selectionMode ? ' selecting' : ''}${
                      selectionMode && selected ? ' selected' : ''
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectionMode ? selected : undefined}
                    onClick={() =>
                      selectionMode
                        ? toggleSelectedKey(selectionKey)
                        : openEditPrompt(asset, 'project', projectAssets)
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (selectionMode) toggleSelectedKey(selectionKey)
                        else openEditPrompt(asset, 'project', projectAssets)
                      }
                    }}
                  >
                    <div className="canvas-prompt-library-card-cover">
                      {selectionMode && (
                        <span
                          className="canvas-prompt-library-card-check"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            checked={selected}
                            onChange={() => toggleSelectedKey(selectionKey)}
                          />
                        </span>
                      )}
                      {coverUrl ? (
                        <PromptLibraryCoverImage src={coverUrl} />
                      ) : (
                        <PromptLibraryCoverPlaceholder />
                      )}
                      <span className="canvas-prompt-library-card-source">
                  {translate('canvasPromptLibrary.tpl17Desc', { name: projectName })}
                </span>
                    </div>
                    <div className="canvas-prompt-library-card-body">
                      <div className="canvas-prompt-library-card-title-row">
                        <h3>{asset.title || translate('canvasPromptLibrary.t26')}</h3>
                      </div>
                      <p>{readPromptLibraryText(asset) || translate('canvasPromptLibrary.t27')}</p>
                      <div className="canvas-prompt-library-card-actions">
                        <button
                          type="button"
                          className="canvas-prompt-library-copy"
                          aria-label={translate('canvasPromptLibrary.tpl15Desc', { title: asset.title ?? translate('canvasPromptLibrary.t19') })}
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleCopyPrompt(
                              readPromptLibraryText(asset),
                              asset.title ?? translate('canvasPromptLibrary.t19'),
                            )
                          }}
                        >
                          {translate('canvasPromptLibrary.t59')}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEditPrompt(asset, 'project', projectAssets)
                          }}
                        >
                          {translate('canvasPromptLibrary.t60')}
                        </button>
                        <span onClick={(event) => event.stopPropagation()}>
                          <Popconfirm
                            title={translate('canvasPromptLibrary.t40')}
                            description={translate('canvasPromptLibrary.t44Desc')}
                            okText={translate('canvasPromptLibrary.t42')}
                            cancelText={translate('canvasPromptLibrary.t43')}
                            okType="danger"
                            onConfirm={() => void handleDeletePrompt(asset, 'project')}
                          >
                            <button
                              type="button"
                              className="canvas-prompt-library-delete"
                              aria-label={translate('canvasPromptLibrary.tpl16Desc', { title: asset.title ?? translate('canvasPromptLibrary.t19') })}
                            >
                              {translate('canvasPromptLibrary.t42')}
                            </button>
                          </Popconfirm>
                        </span>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {editor && (
        <PromptLibraryEditorModal
          editor={editor}
          categories={categories}
          coverUrl={currentCoverUrl}
          saving={saving}
          onChange={setEditor}
          onClose={closeEditor}
          onSave={() => void handleSavePrompt()}
          onUploadCover={() => fileInputRef.current?.click()}
          onCreateCategory={createCategory}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          handleCoverFile(event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <PromptCategoryManagerModal
        open={categoryManagerOpen}
        categories={categories}
        usage={usage}
        saving={categorySaving}
        onClose={() => setCategoryManagerOpen(false)}
        onCreate={createCategory}
        onRename={renameCategory}
        onDelete={deleteCategory}
      />
    </section>
  )
}

function PromptLibraryCoverImage({ src }: { src: string }) {
  return (
    <>
      <img
        className="canvas-prompt-library-card-cover-ambient"
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <img className="canvas-prompt-library-card-cover-image" src={src} alt="" draggable={false} />
    </>
  )
}

function PromptLibraryCoverPlaceholder() {
  return (
    <div className="canvas-prompt-library-card-cover-fallback">
      <img
        className="canvas-prompt-library-card-cover-fallback-image"
        src={promptLibraryPlaceholderCover}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <div className="canvas-prompt-library-card-cover-fallback-content">
        <span>{translate('canvasPromptLibrary.t61')}</span>
      </div>
    </div>
  )
}

function PromptLibraryEditorModal({
  editor,
  categories,
  coverUrl,
  saving,
  onChange,
  onClose,
  onSave,
  onUploadCover,
  onCreateCategory,
}: {
  editor: PromptEditorState
  categories: string[]
  coverUrl: string | null
  saving: boolean
  onChange: (next: PromptEditorState) => void
  onClose: () => void
  onSave: () => void
  onUploadCover: () => void
  onCreateCategory: (name: string) => Promise<string | null>
}) {
  const [newCategoryOpen, setNewCategoryOpen] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const addCategory = async () => {
    const created = await onCreateCategory(newCategory)
    if (created) {
      setNewCategory('')
      setNewCategoryOpen(false)
    }
  }
  return (
    <Modal
      open
      title={editor.assetId ? translate('canvasPromptLibrary.t28') : translate('canvasPromptLibrary.t29')}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={saving}>
          {translate('canvasPromptLibrary.t43')}
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={onSave}>
          {translate('canvasPromptLibrary.t62')}
        </Button>,
      ]}
    >
      <div className="canvas-prompt-editor-modal">
        <div className="canvas-prompt-editor-grid">
          <div>
            <div className="canvas-prompt-editor-label">{translate('canvasPromptLibrary.t63')}</div>
            <button type="button" className="canvas-prompt-cover-picker" onClick={onUploadCover}>
              {coverUrl ? (
                <img src={coverUrl} alt={translate('canvasPromptLibrary.t45')} />
              ) : (
                <div className="canvas-prompt-cover-empty">
                  <Icons.ImagePlus size={22} />
                  <span>{translate('canvasPromptLibrary.t64')}</span>
                </div>
              )}
              <span className="canvas-prompt-cover-actions">
                <span
                  onClick={(event) => {
                    event.stopPropagation()
                    onUploadCover()
                  }}
                >
                  {translate('canvasPromptLibrary.t65')}
                </span>
              </span>
            </button>
            <CanvasPromptCoverGenerator
              promptText={editor.text}
              disabled={saving}
              onGenerated={(cover) => {
                if (editor.coverPreviewUrl?.startsWith('blob:'))
                  URL.revokeObjectURL(editor.coverPreviewUrl)
                onChange({
                  ...editor,
                  coverFile: null,
                  coverAssetId: null,
                  coverUrl: cover.url,
                  coverMimeType: cover.mimeType,
                  coverPreviewUrl: null,
                })
              }}
            />
          </div>
          <div>
            <label className="canvas-prompt-editor-field">
              <span>{translate('canvasPromptLibrary.t66')}</span>
              <Input
                autoFocus
                value={editor.title}
                onChange={(event) => onChange({ ...editor, title: event.target.value })}
                placeholder={translate('canvasPromptLibrary.t46')}
              />
            </label>
            <div className="canvas-prompt-editor-label canvas-prompt-category-label">
              <span>{translate('canvasPromptLibrary.t67')}</span>
              <button type="button" onClick={() => setNewCategoryOpen((value) => !value)}>
                {translate('canvasPromptLibrary.t68')}
              </button>
            </div>
            <Select
              value={editor.category || undefined}
              placeholder={translate('canvasPromptLibrary.t47')}
              options={categories.map((category) => ({ label: category, value: category }))}
              onChange={(category) => onChange({ ...editor, category: category ?? '' })}
              className="canvas-prompt-category-select"
            />
            {newCategoryOpen && (
              <div className="canvas-prompt-inline-category">
                <Input
                  size="middle"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  placeholder={translate('canvasPromptLibrary.t48')}
                  onPressEnter={() => void addCategory()}
                />
                <Button size="middle" type="primary" onClick={() => void addCategory()}>
                  {translate('canvasPromptLibrary.t69')}
                </Button>
              </div>
            )}
            <div className="canvas-prompt-editor-label canvas-prompt-text-label">
              <span>{translate('canvasPromptLibrary.t19')}</span>
            </div>
            <Input.TextArea
              value={editor.text}
              onChange={(event) => onChange({ ...editor, text: event.target.value })}
              rows={7}
              placeholder={translate('canvasPromptLibrary.t49')}
            />
            <div className="canvas-prompt-editor-source">
              {editor.text ? translate('canvasPromptLibrary.t30') : translate('canvasPromptLibrary.t31')}
            </div>
            <div className="canvas-prompt-editor-label">
              <span>{translate('canvasPromptLibrary.t70')}</span>
            </div>
            <Input
              value={editor.tags.join(', ')}
              onChange={(event) =>
                onChange({
                  ...editor,
                  tags: event.target.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              placeholder={translate('canvasPromptLibrary.t50')}
            />
          </div>
        </div>
        <div className="canvas-prompt-editor-hint">
          {translate('canvasPromptLibrary.t71Desc')}
        </div>
      </div>
    </Modal>
  )
}

function PromptCategoryManagerModal({
  open,
  categories,
  usage,
  saving,
  onClose,
  onCreate,
  onRename,
  onDelete,
}: {
  open: boolean
  categories: string[]
  usage: Record<string, number>
  saving: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<string | null>
  onRename: (from: string, to: string) => Promise<void>
  onDelete: (category: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const visible = categories.filter((category) =>
    category.toLowerCase().includes(query.trim().toLowerCase()),
  )
  return (
    <Modal open={open} title={translate('canvasPromptLibrary.t51')} onCancel={onClose} footer={null} width={480}>
      <div className="canvas-prompt-category-manager">
        <Input
          prefix={<Icons.Search size={14} />}
          placeholder={translate('canvasPromptLibrary.t52')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="canvas-prompt-category-create">
          <Input
            placeholder={translate('canvasPromptLibrary.t48')}
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onPressEnter={() => {
              void onCreate(newCategory).then((created) => {
                if (created) setNewCategory('')
              })
            }}
          />
          <Button
            type="primary"
            loading={saving}
            onClick={() => {
              void onCreate(newCategory).then((created) => {
                if (created) setNewCategory('')
              })
            }}
          >
            {translate('canvasPromptLibrary.t69')}
          </Button>
        </div>
        <div className="canvas-prompt-category-list">
          {visible.map((category) => (
            <div key={category} className="canvas-prompt-category-row">
              {editing === category ? (
                <Input
                  size="small"
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                  onPressEnter={() => {
                    void onRename(category, editingValue).then(() => setEditing(null))
                  }}
                />
              ) : (
                <span>
                  {category}
                  <small>{translate('canvasPromptLibrary.tpl18Desc', { count: usage[category] ?? 0 })}</small>
                </span>
              )}
              <div>
                {editing === category ? (
                  <button
                    type="button"
                    onClick={() => {
                      void onRename(category, editingValue).then(() => setEditing(null))
                    }}
                  >
                    {translate('canvasPromptLibrary.t62')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(category)
                      setEditingValue(category)
                    }}
                  >
                    {translate('canvasPromptLibrary.t72')}
                  </button>
                )}
                <button type="button" className="danger" onClick={() => void onDelete(category)}>
                  {translate('canvasPromptLibrary.t42')}
                </button>
              </div>
            </div>
          ))}
        </div>
        <p>{translate('canvasPromptLibrary.t73Desc')}</p>
      </div>
    </Modal>
  )
}
