import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Empty, Input, Modal, Popconfirm, Select, Spin, Switch, message } from 'antd'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { RemoteAssetImage } from '../../components/RemoteAssetImage'
import promptLibraryPlaceholderCover from '../../../assets/canvas-prompt-library-placeholder-cover.png'
import { useCanvasProjects } from './canvas.store'
import { canvasApi } from './canvas.api'
import { readFileAsDataUrl } from './canvas-safe-file'
import type { CanvasAsset, CanvasSnapshot } from './canvas.types'
import { filmUid, readAssetKind } from './canvasFilmAssets'
import {
  getPromptCategory,
  getPromptCategoryUsage,
  readHideSystemPrompts,
  readLastPromptCategory,
  readPromptLibraryCategories,
  saveHideSystemPrompts,
  saveLastPromptCategory,
} from './canvasPromptLibraryCategories'
import { readPromptLibraryCover, readPromptLibraryText } from './canvasPromptLibraryData'
import {
  buildCanvasPromptLibraryEntries,
  filterPromptLibraryEntries,
  isSystemPromptLibraryEntry,
  type CanvasPromptLibraryEntry,
} from './CanvasPromptLibraryPanel'
import {
  globalPromptToCanvasAsset,
  readGlobalPromptLibrary,
  writeGlobalPromptLibrary,
  type GlobalPromptLibraryItem,
  type GlobalPromptLibraryState,
} from './canvasPromptLibraryStore'
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

type PromptLibrarySource = 'all' | 'global' | 'project' | 'system'

export function CanvasPromptLibraryView() {
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
  const [hideSystemPrompts, setHideSystemPrompts] = useState(readHideSystemPrompts)
  const [editor, setEditor] = useState<PromptEditorState | null>(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [categorySaving, setCategorySaving] = useState(false)
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
        setError(loadError instanceof Error ? loadError.message : '提示词库加载失败')
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
    () =>
      (library?.items ?? [])
        .filter((item) => !item.id.startsWith('legacy:'))
        .map(globalPromptToCanvasAsset),
    [library],
  )
  const categories = useMemo(
    () =>
      library?.categories.length ? library.categories : readPromptLibraryCategories(undefined),
    [library],
  )
  const allPromptAssets = useMemo(
    () => [...globalAssets, ...projectEntries.map((entry) => entry.asset)],
    [globalAssets, projectEntries],
  )
  const usage = useMemo(() => getPromptCategoryUsage(allPromptAssets), [allPromptAssets])
  const systemPromptEntries = useMemo(
    () => buildCanvasPromptLibraryEntries([]).filter(isSystemPromptLibraryEntry),
    [],
  )
  const sourceCount = useMemo(
    () => ({
      all: globalAssets.length + projectEntries.length + systemPromptEntries.length,
      global: globalAssets.length,
      project: projectEntries.length,
      system: systemPromptEntries.length,
    }),
    [globalAssets, projectEntries, systemPromptEntries],
  )
  const filteredGlobalAssets = useMemo(() => {
    if (activeSource === 'project' || activeSource === 'system') return []
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
    if (activeSource === 'global' || activeSource === 'system') return []
    const cleanQuery = query.trim().toLowerCase()
    return projectEntries.filter(({ asset, projectName }) => {
      const category = getPromptCategory(asset)
      if (activeCategory !== 'all' && category !== activeCategory) return false
      if (!cleanQuery) return true
      const haystack = `${asset.title ?? ''} ${readPromptLibraryText(asset)} ${category ?? ''} ${
        Array.isArray(asset.metadata.tags) ? asset.metadata.tags.join(' ') : ''
      } ${projectName}`.toLowerCase()
      return haystack.includes(cleanQuery)
    })
  }, [activeCategory, activeSource, projectEntries, query])
  const filteredSystemPromptEntries = useMemo<CanvasPromptLibraryEntry[]>(() => {
    if (activeSource === 'global' || activeSource === 'project') return []
    if (hideSystemPrompts || activeCategory !== 'all') return []
    const cleanQuery = query.trim().toLowerCase()
    return filterPromptLibraryEntries(systemPromptEntries, hideSystemPrompts).filter((entry) => {
      if (!cleanQuery) return true
      const haystack = `${entry.group} ${entry.label} ${entry.text} ${entry.description ?? ''} ${
        entry.tags?.join(' ') ?? ''
      }`.toLowerCase()
      return haystack.includes(cleanQuery)
    })
  }, [activeCategory, activeSource, hideSystemPrompts, query, systemPromptEntries])

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
      message.warning('请选择图片文件')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      message.warning('封面图片请控制在 8MB 以内')
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
      message.warning('请填写提示词')
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
          message.warning('提示词来源信息缺失，无法保存')
          return
        }
        const existingEntry = projectEntries.find((entry) => entry.asset.id === editor.assetId)
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
        message.success('提示词已保存')
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
      message.success(editor.assetId ? '提示词已保存' : '提示词已创建')
    } catch (saveError) {
      message.error(saveError instanceof Error ? saveError.message : '保存提示词失败')
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
      message.warning('分类已存在')
      return null
    }
    try {
      await persistCategories([...categories, nextName])
      setEditor((current) => (current ? { ...current, category: nextName } : current))
      return nextName
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建分类失败')
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
      message.error(error instanceof Error ? error.message : '重命名分类失败')
    }
  }

  const deleteCategory = async (category: string) => {
    if (categories.length <= 1) {
      message.warning('至少保留一个分类')
      return
    }
    const fallback = categories.find((item) => item !== category) ?? categories[0] ?? ''
    const count = usage[category] ?? 0
    if (
      count > 0 &&
      !window.confirm(`分类“${category}”有 ${count} 条提示词，将迁移到“${fallback}”，继续吗？`)
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
      message.error(error instanceof Error ? error.message : '删除分类失败')
    }
  }

  const handleCopyPrompt = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(`已复制提示词：${label}`)
    } catch {
      message.error('复制失败，请稍后重试')
    }
  }

  const handleDeletePrompt = async (asset: CanvasAsset, source: 'global' | 'project') => {
    try {
      if (source === 'project') {
        await canvasApi.deleteFilmAsset(asset.projectId, asset.id)
        if (editor?.assetId === asset.id) closeEditor()
        message.success(`已删除提示词：${asset.title ?? '提示词'}`)
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
      message.success(`已删除提示词：${asset.title ?? '提示词'}`)
    } catch (deleteError) {
      message.error(deleteError instanceof Error ? deleteError.message : '删除提示词失败')
    }
  }

  const currentCoverUrl = editor?.coverPreviewUrl ?? editor?.coverUrl ?? null

  return (
    <section className="canvas-prompt-library-page" aria-label="提示词库管理">
      <header
        className="canvas-prompt-library-page-header canvas-view-titlebar"
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        {t.sidebarHidden && <SidebarExpandButton />}
        <div className="canvas-prompt-library-title-wrap">
          <h2>提示词库管理</h2>
        </div>
        <div className="canvas-prompt-library-header-actions">
          <span className="canvas-prompt-library-shortcut">⌘/Ctrl + E 新建</span>
          <Button
            size="small"
            type="text"
            loading={loading}
            onClick={() => void reload()}
            icon={<Icons.Refresh size={15} />}
            aria-label="刷新提示词库"
          >
            刷新
          </Button>
          <Button size="small" type="text" onClick={openCreatePrompt} disabled={!library}>
            <Icons.Plus size={15} /> 新建提示词
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
              aria-label="提示词来源"
            >
              {(
                [
                  ['all', '全部'],
                  ['global', '全局'],
                  ['project', '画布项目'],
                  ['system', '系统'],
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
              aria-label="提示词分类"
            >
              <button
                type="button"
                className={activeCategory === 'all' ? 'active' : ''}
                onClick={() => setActiveCategory('all')}
              >
                全部 <small>{sourceCount.all}</small>
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
                <Icons.Settings size={13} /> 管理分类
              </button>
            </div>
            <div className="canvas-prompt-library-toolbar-tools">
              <label className="canvas-prompt-library-system-filter">
                <span>隐藏系统提示词</span>
                <Switch
                  size="small"
                  checked={hideSystemPrompts}
                  onChange={(checked) => {
                    setHideSystemPrompts(checked)
                    saveHideSystemPrompts(checked)
                  }}
                />
              </label>
              <Input
                allowClear
                className="canvas-prompt-library-search"
                prefix={<Icons.Search size={15} />}
                placeholder="搜索提示词"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          {filteredGlobalAssets.length === 0 &&
          filteredProjectEntries.length === 0 &&
          filteredSystemPromptEntries.length === 0 ? (
            <Empty
              className="canvas-prompt-library-empty"
              description={query ? '没有匹配的提示词' : '还没有提示词'}
            />
          ) : (
            <div className="canvas-prompt-library-card-grid">
              {filteredGlobalAssets.map((asset) => {
                const coverUrl = readPromptLibraryCover(asset, snapshot?.assets ?? []).url
                return (
                  <article
                    key={`global:${asset.id}`}
                    className="canvas-prompt-library-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditPrompt(asset, 'global', snapshot?.assets ?? [])}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openEditPrompt(asset, 'global', snapshot?.assets ?? [])
                      }
                    }}
                  >
                    <div className="canvas-prompt-library-card-cover">
                      {coverUrl ? (
                        <PromptLibraryCoverImage src={coverUrl} />
                      ) : (
                        <PromptLibraryCoverPlaceholder />
                      )}
                      <span className="canvas-prompt-library-card-source">全局</span>
                    </div>
                    <div className="canvas-prompt-library-card-body">
                      <div className="canvas-prompt-library-card-title-row">
                        <h3>{asset.title || '未命名提示词'}</h3>
                      </div>
                      <p>{readPromptLibraryText(asset) || '暂无提示词文案'}</p>
                      <div className="canvas-prompt-library-card-actions">
                        <button
                          type="button"
                          className="canvas-prompt-library-copy"
                          aria-label={`复制${asset.title ?? '提示词'}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleCopyPrompt(
                              readPromptLibraryText(asset),
                              asset.title ?? '提示词',
                            )
                          }}
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEditPrompt(asset, 'global', snapshot?.assets ?? [])
                          }}
                        >
                          编辑
                        </button>
                        <span onClick={(event) => event.stopPropagation()}>
                          <Popconfirm
                            title="确定删除这条提示词吗？"
                            description="删除后无法恢复。"
                            okText="删除"
                            cancelText="取消"
                            okType="danger"
                            onConfirm={() => void handleDeletePrompt(asset, 'global')}
                          >
                            <button
                              type="button"
                              className="canvas-prompt-library-delete"
                              aria-label={`删除${asset.title ?? '提示词'}`}
                            >
                              删除
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
                return (
                  <article
                    key={`project:${asset.projectId}:${asset.id}`}
                    className="canvas-prompt-library-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditPrompt(asset, 'project', projectAssets)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openEditPrompt(asset, 'project', projectAssets)
                      }
                    }}
                  >
                    <div className="canvas-prompt-library-card-cover">
                      {coverUrl ? (
                        <PromptLibraryCoverImage src={coverUrl} />
                      ) : (
                        <PromptLibraryCoverPlaceholder />
                      )}
                      <span className="canvas-prompt-library-card-source">画布·{projectName}</span>
                    </div>
                    <div className="canvas-prompt-library-card-body">
                      <div className="canvas-prompt-library-card-title-row">
                        <h3>{asset.title || '未命名提示词'}</h3>
                      </div>
                      <p>{readPromptLibraryText(asset) || '暂无提示词文案'}</p>
                      <div className="canvas-prompt-library-card-actions">
                        <button
                          type="button"
                          className="canvas-prompt-library-copy"
                          aria-label={`复制${asset.title ?? '提示词'}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleCopyPrompt(
                              readPromptLibraryText(asset),
                              asset.title ?? '提示词',
                            )
                          }}
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEditPrompt(asset, 'project', projectAssets)
                          }}
                        >
                          编辑
                        </button>
                        <span onClick={(event) => event.stopPropagation()}>
                          <Popconfirm
                            title="确定删除这条提示词吗？"
                            description="该提示词来自画布项目，删除后会从对应项目中移除。"
                            okText="删除"
                            cancelText="取消"
                            okType="danger"
                            onConfirm={() => void handleDeletePrompt(asset, 'project')}
                          >
                            <button
                              type="button"
                              className="canvas-prompt-library-delete"
                              aria-label={`删除${asset.title ?? '提示词'}`}
                            >
                              删除
                            </button>
                          </Popconfirm>
                        </span>
                      </div>
                    </div>
                  </article>
                )
              })}
              {filteredSystemPromptEntries.map((entry) => (
                <SystemPromptCard
                  key={entry.id}
                  entry={entry}
                  onCopy={() => void handleCopyPrompt(entry.text, entry.label)}
                />
              ))}
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

function SystemPromptCard({
  entry,
  onCopy,
}: {
  entry: CanvasPromptLibraryEntry
  onCopy: () => void
}) {
  return (
    <article className="canvas-prompt-library-card canvas-prompt-library-system-card">
      <div className="canvas-prompt-library-card-cover">
        {entry.exampleImageSrc ? (
          <PromptLibraryCoverImage src={entry.exampleImageSrc} remote />
        ) : (
          <PromptLibraryCoverPlaceholder />
        )}
        <span className="canvas-prompt-library-card-source">系统提示词</span>
      </div>
      <div className="canvas-prompt-library-card-body">
        <div className="canvas-prompt-library-card-title-row">
          <h3>{entry.label}</h3>
          <button type="button" className="canvas-prompt-library-copy" onClick={onCopy}>
            复制
          </button>
        </div>
        <p>{entry.text}</p>
        <div className="canvas-prompt-library-card-actions">
          <button type="button" onClick={onCopy}>
            复制提示词
          </button>
        </div>
      </div>
    </article>
  )
}

function PromptLibraryCoverImage({ src, remote = false }: { src: string; remote?: boolean }) {
  return (
    <>
      <img
        className="canvas-prompt-library-card-cover-ambient"
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      {remote ? (
        <RemoteAssetImage
          className="canvas-prompt-library-card-cover-remote"
          src={src}
          alt=""
        />
      ) : (
        <img
          className="canvas-prompt-library-card-cover-image"
          src={src}
          alt=""
          draggable={false}
        />
      )}
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
        <span>无封面</span>
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
      title={editor.assetId ? '编辑提示词' : '新建提示词'}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={saving}>
          取消
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={onSave}>
          保存
        </Button>,
      ]}
    >
      <div className="canvas-prompt-editor-modal">
        <div className="canvas-prompt-editor-grid">
          <div>
            <div className="canvas-prompt-editor-label">封面</div>
            <button type="button" className="canvas-prompt-cover-picker" onClick={onUploadCover}>
              {coverUrl ? (
                <img src={coverUrl} alt="提示词封面" />
              ) : (
                <div className="canvas-prompt-cover-empty">
                  <Icons.ImagePlus size={22} />
                  <span>上传封面图</span>
                </div>
              )}
              <span className="canvas-prompt-cover-actions">
                <span
                  onClick={(event) => {
                    event.stopPropagation()
                    onUploadCover()
                  }}
                >
                  上传
                </span>
              </span>
            </button>
          </div>
          <div>
            <label className="canvas-prompt-editor-field">
              <span>名称</span>
              <Input
                autoFocus
                value={editor.title}
                onChange={(event) => onChange({ ...editor, title: event.target.value })}
                placeholder="不填写时默认为 -"
              />
            </label>
            <div className="canvas-prompt-editor-label canvas-prompt-category-label">
              <span>分类</span>
              <button type="button" onClick={() => setNewCategoryOpen((value) => !value)}>
                ＋ 新分类
              </button>
            </div>
            <Select
              value={editor.category || undefined}
              placeholder="选择分类"
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
                  placeholder="新分类名称"
                  onPressEnter={() => void addCategory()}
                />
                <Button size="middle" type="primary" onClick={() => void addCategory()}>
                  添加
                </Button>
              </div>
            )}
            <div className="canvas-prompt-editor-label canvas-prompt-text-label">
              <span>提示词</span>
            </div>
            <Input.TextArea
              value={editor.text}
              onChange={(event) => onChange({ ...editor, text: event.target.value })}
              rows={7}
              placeholder="输入提示词文案"
            />
            <div className="canvas-prompt-editor-source">
              {editor.text ? '来源：手写' : '支持手写提示词文案'}
            </div>
            <div className="canvas-prompt-editor-label">
              <span>标签</span>
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
              placeholder="用逗号分隔"
            />
          </div>
        </div>
        <div className="canvas-prompt-editor-hint">
          保存后可从画布使用，也可以继续编辑封面、文案和分类。
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
    <Modal open={open} title="管理分类" onCancel={onClose} footer={null} width={480}>
      <div className="canvas-prompt-category-manager">
        <Input
          prefix={<Icons.Search size={14} />}
          placeholder="搜索分类"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="canvas-prompt-category-create">
          <Input
            placeholder="新分类名称"
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
            添加
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
                  <small>{usage[category] ?? 0} 条</small>
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
                    保存
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(category)
                      setEditingValue(category)
                    }}
                  >
                    重命名
                  </button>
                )}
                <button type="button" className="danger" onClick={() => void onDelete(category)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
        <p>删除有引用的分类时，会先迁移到其他分类。</p>
      </div>
    </Modal>
  )
}
