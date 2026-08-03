import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Empty, Input, Modal, Select, Spin, Switch, Tag, message } from 'antd'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { RemoteAssetImage } from '../../components/RemoteAssetImage'
import { useCanvasProjectSelection } from './CanvasProjectSelectionContext'
import { useCanvasProjects } from './canvas.store'
import { canvasApi } from './canvas.api'
import { readFileAsDataUrl, encodeToSafeFileUrl } from './canvas-safe-file'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'
import { readAssetKind } from './canvasFilmAssets'
import {
  getPromptCategory,
  getPromptCategoryUsage,
  readHideSystemPrompts,
  readLastPromptCategory,
  readPromptLibraryCategories,
  saveHideSystemPrompts,
  saveLastPromptCategory,
  writePromptLibraryCategories,
} from './canvasPromptLibraryCategories'
import {
  isPromptTextNode,
  readPromptLibraryCover,
  readPromptLibraryText,
} from './canvasPromptLibraryData'
import {
  buildCanvasPromptLibraryEntries,
  filterPromptLibraryEntries,
  isSystemPromptLibraryEntry,
  type CanvasPromptLibraryEntry,
} from './CanvasPromptLibraryPanel'
import './canvas-prompt-library.less'

type PromptEditorState = {
  assetId: string | null
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
  assetId: null,
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

function readAssetAttributes(asset: CanvasAsset | null): Record<string, string> {
  if (!asset) return {}
  const attributes = asset.metadata?.attributes
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return {}
  return Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function nodeText(node: CanvasNode, snapshot: CanvasSnapshot): string {
  if (!isPromptTextNode(node)) return ''
  const text = node.data?.text
  if (typeof text === 'string' && text.trim()) return text.trim()
  const prompt = node.data?.prompt
  if (typeof prompt === 'string' && prompt.trim()) return prompt.trim()
  if (node.assetId) {
    const asset = snapshot.assets.find((item) => item.id === node.assetId)
    if (asset) return readPromptLibraryText(asset)
  }
  return ''
}

function defaultCategory(categories: string[]): string {
  const last = readLastPromptCategory()
  return (last && categories.includes(last) ? last : categories[0]) ?? ''
}

function editorFromAsset(asset: CanvasAsset, snapshot: CanvasSnapshot): PromptEditorState {
  const cover = readPromptLibraryCover(asset, snapshot.assets)
  return {
    assetId: asset.id,
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

function buildAttributes(
  editor: PromptEditorState,
  uploadedCover: { url: string; mimeType: string } | null,
): Record<string, string> {
  const directCoverUrl = uploadedCover?.url ?? (!editor.coverAssetId ? editor.coverUrl : null)
  const directCoverMimeType =
    uploadedCover?.mimeType ?? (!editor.coverAssetId ? editor.coverMimeType : null)
  return {
    promptCategory: editor.category.trim(),
    ...(editor.coverAssetId ? { coverAssetId: editor.coverAssetId } : { coverAssetId: '' }),
    ...(directCoverUrl && directCoverMimeType
      ? { coverUrl: directCoverUrl, coverMimeType: directCoverMimeType }
      : { coverUrl: '', coverMimeType: '' }),
  }
}

export function CanvasPromptLibraryView() {
  const { t } = useApp()
  const { projects } = useCanvasProjects()
  const { selectedProjectId } = useCanvasProjectSelection()
  const activeProjectId = selectedProjectId ?? projects[0]?.id ?? null
  const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [hideSystemPrompts, setHideSystemPrompts] = useState(readHideSystemPrompts)
  const [editor, setEditor] = useState<PromptEditorState | null>(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [textPickerOpen, setTextPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [categorySaving, setCategorySaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const reloadRequestRef = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++reloadRequestRef.current
    if (!activeProjectId) {
      setSnapshot(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const nextSnapshot = await canvasApi.openSnapshot(activeProjectId)
      if (requestId === reloadRequestRef.current) setSnapshot(nextSnapshot)
    } catch (loadError) {
      if (requestId === reloadRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : '提示词库加载失败')
      }
    } finally {
      if (requestId === reloadRequestRef.current) setLoading(false)
    }
  }, [activeProjectId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setEditor((current) => {
      if (current?.coverPreviewUrl?.startsWith('blob:'))
        URL.revokeObjectURL(current.coverPreviewUrl)
      return null
    })
    setTextPickerOpen(false)
    setCategoryManagerOpen(false)
    setActiveCategory('all')
    setQuery('')
  }, [activeProjectId])

  const promptAssets = useMemo(
    () => snapshot?.assets.filter((asset) => readAssetKind(asset) === 'prompt_library') ?? [],
    [snapshot],
  )
  const categories = useMemo(
    () => readPromptLibraryCategories(snapshot?.project.metadata),
    [snapshot?.project.metadata],
  )
  const usage = useMemo(() => getPromptCategoryUsage(promptAssets), [promptAssets])
  const systemPromptEntries = useMemo(
    () => buildCanvasPromptLibraryEntries([]).filter(isSystemPromptLibraryEntry),
    [],
  )
  const filteredAssets = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase()
    return promptAssets.filter((asset) => {
      const category = getPromptCategory(asset)
      if (activeCategory !== 'all' && category !== activeCategory) return false
      if (!cleanQuery) return true
      const haystack = `${asset.title ?? ''} ${readPromptLibraryText(asset)} ${category ?? ''} ${
        Array.isArray(asset.metadata.tags) ? asset.metadata.tags.join(' ') : ''
      }`.toLowerCase()
      return haystack.includes(cleanQuery)
    })
  }, [activeCategory, promptAssets, query])
  const filteredSystemPromptEntries = useMemo<CanvasPromptLibraryEntry[]>(() => {
    if (hideSystemPrompts || activeCategory !== 'all') return []
    const cleanQuery = query.trim().toLowerCase()
    return filterPromptLibraryEntries(systemPromptEntries, hideSystemPrompts).filter((entry) => {
      if (!cleanQuery) return true
      const haystack = `${entry.group} ${entry.label} ${entry.text} ${entry.description ?? ''} ${
        entry.tags?.join(' ') ?? ''
      }`.toLowerCase()
      return haystack.includes(cleanQuery)
    })
  }, [activeCategory, hideSystemPrompts, query, systemPromptEntries])

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
      if (!editor && !categoryManagerOpen && !textPickerOpen && snapshot) {
        openCreatePrompt()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [categoryManagerOpen, editor, openCreatePrompt, snapshot, textPickerOpen])

  const openEditPrompt = (asset: CanvasAsset) => {
    if (!snapshot) return
    setEditor(editorFromAsset(asset, snapshot))
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
    if (!activeProjectId || !snapshot || !editor) return
    if (!editor.title.trim() || !editor.text.trim()) {
      message.warning('请填写名称和提示词')
      return
    }
    if (!editor.category.trim()) {
      message.warning('请选择分类')
      return
    }
    setSaving(true)
    try {
      let uploadedCover: { url: string; mimeType: string } | null = null
      if (editor.coverFile) {
        const dataUrl = await readFileAsDataUrl(editor.coverFile)
        const written = await window.spark.invoke('canvas:asset:write-data-url', {
          projectId: activeProjectId,
          projectRootPath: snapshot.project.rootPath ?? null,
          dataUrl,
          mimeType: editor.coverFile.type,
          suggestedBaseName: 'prompt-cover',
          type: 'image',
        })
        uploadedCover = {
          url: encodeToSafeFileUrl(written.filePath),
          mimeType: editor.coverFile.type,
        }
      }
      const attributes = buildAttributes(editor, uploadedCover)
      const nextSnapshot = editor.assetId
        ? await canvasApi.updateFilmAsset(activeProjectId, editor.assetId, {
            title: editor.title.trim(),
            contentText: editor.text.trim(),
            prompt: editor.text.trim(),
            tags: editor.tags,
            attributes,
          })
        : await (async () => {
            await canvasApi.createFilmAsset(activeProjectId, {
              kind: 'prompt_library',
              name: editor.title.trim(),
              text: editor.text.trim(),
              prompt: editor.text.trim(),
              tags: editor.tags,
              attributes,
            })
            return canvasApi.openSnapshot(activeProjectId)
          })()
      saveLastPromptCategory(editor.category)
      setSnapshot(nextSnapshot)
      closeEditor()
      message.success(editor.assetId ? '提示词已保存' : '提示词已创建')
    } catch (saveError) {
      message.error(saveError instanceof Error ? saveError.message : '保存提示词失败')
    } finally {
      setSaving(false)
    }
  }

  const persistCategories = async (nextCategories: string[]) => {
    if (!activeProjectId || !snapshot) return
    setCategorySaving(true)
    try {
      const next = await canvasApi.updateProjectMetadata(
        activeProjectId,
        writePromptLibraryCategories(snapshot.project.metadata, nextCategories),
      )
      setSnapshot(next)
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

  const migratePromptCategory = async (from: string, to: string) => {
    if (!activeProjectId || !snapshot) return null
    const affectedAssets = promptAssets.filter((asset) => getPromptCategory(asset) === from)
    const originalAttributes = new Map(
      affectedAssets.map((asset) => [asset.id, readAssetAttributes(asset)] as const),
    )
    let nextSnapshot = snapshot

    const rollback = async (): Promise<CanvasSnapshot> => {
      let rollbackSnapshot = snapshot
      let rollbackFailed = false
      for (const asset of affectedAssets) {
        try {
          rollbackSnapshot = await canvasApi.updateFilmAsset(activeProjectId, asset.id, {
            attributes: originalAttributes.get(asset.id) ?? {},
          })
        } catch {
          rollbackFailed = true
        }
      }
      if (!rollbackFailed) return rollbackSnapshot
      try {
        return await canvasApi.openSnapshot(activeProjectId)
      } catch {
        return rollbackSnapshot
      }
    }

    try {
      for (const asset of affectedAssets) {
        nextSnapshot = await canvasApi.updateFilmAsset(activeProjectId, asset.id, {
          attributes: { ...originalAttributes.get(asset.id), promptCategory: to },
        })
      }
    } catch (error) {
      setSnapshot(await rollback())
      throw error
    }

    return { snapshot: nextSnapshot, rollback }
  }

  const renameCategory = async (from: string, to: string) => {
    const nextName = to.trim()
    if (!nextName || nextName === from || categories.includes(nextName)) return
    if (!activeProjectId || !snapshot) return
    let migration: Awaited<ReturnType<typeof migratePromptCategory>> = null
    try {
      migration = await migratePromptCategory(from, nextName)
      const nextSnapshot = await persistCategories(
        categories.map((category) => (category === from ? nextName : category)),
      )
      setSnapshot(nextSnapshot ?? migration?.snapshot ?? snapshot)
      if (activeCategory === from) setActiveCategory(nextName)
    } catch (error) {
      if (migration) setSnapshot(await migration.rollback())
      message.error(error instanceof Error ? error.message : '重命名分类失败，已恢复原数据')
    }
  }

  const deleteCategory = async (category: string) => {
    if (categories.length <= 1) {
      message.warning('至少保留一个分类')
      return
    }
    if (!activeProjectId || !snapshot) return
    const fallback = categories.find((item) => item !== category) ?? categories[0] ?? ''
    const count = usage[category] ?? 0
    if (
      count > 0 &&
      !window.confirm(`分类“${category}”有 ${count} 条提示词，将迁移到“${fallback}”，继续吗？`)
    )
      return
    let migration: Awaited<ReturnType<typeof migratePromptCategory>> = null
    try {
      migration = await migratePromptCategory(category, fallback)
      const nextSnapshot = await persistCategories(categories.filter((item) => item !== category))
      setSnapshot(nextSnapshot ?? migration?.snapshot ?? snapshot)
      if (activeCategory === category) setActiveCategory('all')
    } catch (error) {
      if (migration) setSnapshot(await migration.rollback())
      message.error(error instanceof Error ? error.message : '删除分类失败，已恢复原数据')
    }
  }

  const handleInsertAsset = async (asset: CanvasAsset) => {
    if (!activeProjectId || !snapshot) return
    try {
      await canvasApi.insertAssetToBoard({
        projectId: activeProjectId,
        boardId: snapshot.board.id,
        assetId: asset.id,
        x: 260,
        y: 180,
      })
      message.success('已插入当前画布')
    } catch (insertError) {
      message.error(insertError instanceof Error ? insertError.message : '插入画布失败')
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
          <Icons.Edit size={17} />
          <div>
            <h2>提示词库管理</h2>
            <span>
              {snapshot?.project.title ?? '选择一个画布项目'} · {promptAssets.length} 条自建 ·{' '}
              {systemPromptEntries.length} 条内置
            </span>
          </div>
        </div>
        <div className="canvas-prompt-library-header-actions">
          <span className="canvas-prompt-library-shortcut">⌘/Ctrl + E 新建</span>
          <Button type="primary" onClick={openCreatePrompt} disabled={!snapshot}>
            <Icons.Plus size={15} /> 新建提示词
          </Button>
        </div>
      </header>

      {!activeProjectId ? (
        <Empty description="请先创建或选择一个画布项目" />
      ) : loading ? (
        <div className="canvas-prompt-library-loading">
          <Spin />
        </div>
      ) : error ? (
        <div className="canvas-prompt-library-error" role="alert">
          {error}
        </div>
      ) : snapshot ? (
        <div className="canvas-prompt-library-content">
          <div className="canvas-prompt-library-toolbar">
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
                全部{' '}
                <small>
                  {promptAssets.length + (hideSystemPrompts ? 0 : systemPromptEntries.length)}
                </small>
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
                prefix={<Icons.Search size={14} />}
                placeholder="搜索提示词"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          {filteredAssets.length === 0 && filteredSystemPromptEntries.length === 0 ? (
            <Empty
              className="canvas-prompt-library-empty"
              description={query ? '没有匹配的提示词' : '还没有提示词'}
            />
          ) : (
            <div className="canvas-prompt-library-card-grid">
              {filteredAssets.map((asset) => {
                const coverUrl = readPromptLibraryCover(asset, snapshot.assets).url
                const category = getPromptCategory(asset)
                const count = Number(asset.metadata.usageCount ?? 0)
                return (
                  <article
                    key={asset.id}
                    className="canvas-prompt-library-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditPrompt(asset)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openEditPrompt(asset)
                      }
                    }}
                  >
                    <div className="canvas-prompt-library-card-cover">
                      {coverUrl ? (
                        <img src={coverUrl} alt="" />
                      ) : (
                        <div className="canvas-prompt-library-card-cover-fallback">
                          <Icons.Edit size={20} />
                          <span>{category ?? '未分类'}</span>
                        </div>
                      )}
                      <span className="canvas-prompt-library-card-source">
                        {asset.source === 'manual' ? '我的提示词' : '画布产出'}
                      </span>
                    </div>
                    <div className="canvas-prompt-library-card-body">
                      <div className="canvas-prompt-library-card-title-row">
                        <h3>{asset.title || '未命名提示词'}</h3>
                        <button
                          type="button"
                          className="canvas-prompt-library-copy"
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
                      </div>
                      <p>{readPromptLibraryText(asset) || '暂无提示词文案'}</p>
                      <div className="canvas-prompt-library-card-meta">
                        <Tag>{category ?? '未分类'}</Tag>
                        <span>使用 {count} 次</span>
                      </div>
                      <div className="canvas-prompt-library-card-actions">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleInsertAsset(asset)
                          }}
                        >
                          插入画布
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEditPrompt(asset)
                          }}
                        >
                          编辑
                        </button>
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

      {editor && snapshot && (
        <PromptLibraryEditorModal
          editor={editor}
          categories={categories}
          coverUrl={currentCoverUrl}
          snapshot={snapshot}
          saving={saving}
          onChange={setEditor}
          onClose={closeEditor}
          onSave={() => void handleSavePrompt()}
          onPickText={() => setTextPickerOpen(true)}
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
      {snapshot && (
        <TextNodePickerModal
          open={textPickerOpen}
          snapshot={snapshot}
          onClose={() => setTextPickerOpen(false)}
          onPick={(text) => {
            setEditor((current) => (current ? { ...current, text } : current))
            setTextPickerOpen(false)
          }}
        />
      )}
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
          <RemoteAssetImage src={entry.exampleImageSrc} alt="" />
        ) : (
          <div className="canvas-prompt-library-card-cover-fallback">
            <Icons.Book size={20} />
            <span>{entry.group}</span>
          </div>
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
        <div className="canvas-prompt-library-card-meta">
          <Tag>{entry.group}</Tag>
          <span>系统内置</span>
        </div>
        <div className="canvas-prompt-library-card-actions">
          <button type="button" onClick={onCopy}>
            复制提示词
          </button>
        </div>
      </div>
    </article>
  )
}

function PromptLibraryEditorModal({
  editor,
  categories,
  coverUrl,
  snapshot,
  saving,
  onChange,
  onClose,
  onSave,
  onPickText,
  onUploadCover,
  onCreateCategory,
}: {
  editor: PromptEditorState
  categories: string[]
  coverUrl: string | null
  snapshot: CanvasSnapshot
  saving: boolean
  onChange: (next: PromptEditorState) => void
  onClose: () => void
  onSave: () => void
  onPickText: () => void
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
                placeholder="提示词名称"
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
              <button type="button" onClick={onPickText}>
                从画布选择文本
              </button>
            </div>
            <Input.TextArea
              value={editor.text}
              onChange={(event) => onChange({ ...editor, text: event.target.value })}
              rows={7}
              placeholder="输入提示词文案"
            />
            <div className="canvas-prompt-editor-source">
              {editor.text
                ? `来源：${snapshot.nodes.some((node) => nodeText(node, snapshot) === editor.text) ? '画布节点' : '手写'}`
                : '支持手写或从画布选择文本节点'}
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

function TextNodePickerModal({
  open,
  snapshot,
  onClose,
  onPick,
}: {
  open: boolean
  snapshot: CanvasSnapshot
  onClose: () => void
  onPick: (text: string) => void
}) {
  const nodes = snapshot.nodes
    .filter(isPromptTextNode)
    .map((node) => ({ node, text: nodeText(node, snapshot) }))
    .filter((item) => item.text)
  return (
    <Modal open={open} title="从画布选择提示词" onCancel={onClose} footer={null} width={620}>
      <div className="canvas-prompt-text-source-list">
        {nodes.length === 0 ? (
          <Empty description="画布上还没有文本节点" />
        ) : (
          nodes.map(({ node, text }) => (
            <button key={node.id} type="button" onClick={() => onPick(text)}>
              <span>{node.title ?? node.type}</span>
              <small>{text}</small>
            </button>
          ))
        )}
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
