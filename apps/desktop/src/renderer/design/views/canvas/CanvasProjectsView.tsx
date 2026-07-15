import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dropdown, Empty, Modal } from '@lobehub/ui'
import { Modal as AntdModal, Spin, message } from 'antd'
import { Icons } from '../../Icons'
import {
  Input as LobeInput,
  SearchBar as LobeSearchBar,
  TextArea as LobeTextArea,
} from '@lobehub/ui'
import { canvasApi } from './canvas.api'
import {
  CANVAS_PROJECT_SORT_LABELS as SORT_LABELS,
  sortCanvasProjects,
  type CanvasProjectSortDir,
  type CanvasProjectSortKey,
} from './canvasProjectSort'
import { useCanvasProjects } from './canvas.store'
import { openCanvasProjectWindow } from './canvas-window-client'
import { CanvasProjectCard } from './CanvasProjectCard'
import './CanvasProjectsView.less'
import './uiux-v4/projects.less'
import './uiux-v4/modals.less'

export function CanvasProjectsView({
  onWorkspaceActiveChange,
}: {
  onWorkspaceActiveChange?: (active: boolean) => void
}) {
  const { projects, loading, refresh } = useCanvasProjects()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<CanvasProjectSortKey>('updated')
  const [sortDir, setSortDir] = useState<CanvasProjectSortDir>('desc')
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectParentDirectory, setProjectParentDirectory] = useState('')
  /**
   * 新建/编辑对话框中的封面 state：
   *   - coverFile：用户本次新选中的 File（保存时上传到项目目录）
   *   - coverPreviewUrl：预览 URL（File 时是 blob URL；已有项目时是 safe-file/http URL）
   *   - coverRemoved：用户在编辑时主动点「移除封面」（保存时清空 cover_url）
   */
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [coverRemoved, setCoverRemoved] = useState(false)
  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null)
  const [togglingPinId, setTogglingPinId] = useState<string | null>(null)
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null)

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const base = keyword
      ? projects.filter(
          (project) =>
            project.title.toLowerCase().includes(keyword) ||
            (project.description ?? '').toLowerCase().includes(keyword),
        )
      : projects
    return sortCanvasProjects(base, sortKey, sortDir)
  }, [projects, query, sortKey, sortDir])

  useEffect(() => {
    onWorkspaceActiveChange?.(false)
  }, [onWorkspaceActiveChange])

  const handleOpenProject = async (projectId: string) => {
    setOpeningProjectId(projectId)
    try {
      await openCanvasProjectWindow(projectId)
      await refresh()
    } catch (error) {
      const text = error instanceof Error ? error.message : '打开 Canvas 项目失败'
      const code =
        typeof error === 'object' && error != null ? (error as { code?: unknown }).code : null
      if (code === 'VALIDATION_FAILED') message.warning(text)
      else message.error(text)
    } finally {
      setOpeningProjectId(null)
    }
  }

  const openCreate = () => {
    setEditingProjectId(null)
    setTitle('')
    setDescription('')
    setCoverFile(null)
    setCoverPreviewUrl(null)
    setCoverRemoved(false)
    void canvasApi
      .getDefaultProjectsRoot()
      .then(setProjectParentDirectory)
      .catch(() => setProjectParentDirectory(''))
    setCreateOpen(true)
  }

  const openEdit = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    setEditingProjectId(projectId)
    setTitle(project.title)
    setDescription(project.description ?? '')
    setProjectParentDirectory(project.rootPath ?? '')
    setCoverFile(null)
    setCoverPreviewUrl(project.coverUrl ?? null)
    setCoverRemoved(false)
    setCreateOpen(true)
  }

  const handleSelectCoverFile = (file: File | null | undefined) => {
    if (!file) return
    if (!/^image\//i.test(file.type)) {
      message.warning('请选择图片文件')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      message.warning('封面图大小请控制在 8MB 以内')
      return
    }
    setCoverFile(file)
    setCoverPreviewUrl((prev) => {
      // 仅回收本会话创建的 blob URL，避免重复上传累积内存；磁盘/远程 URL 不是 blob，跳过。
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    setCoverRemoved(false)
  }

  const handleClearCover = () => {
    setCoverFile(null)
    setCoverPreviewUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return null
    })
    setCoverRemoved(true)
  }

  const handleChooseProjectLocation = async () => {
    try {
      const selected = await window.spark.invoke('dialog:open-directory', {
        title: editingProjectId == null ? '选择 Canvas 项目保存位置' : '选择 Canvas 项目目录',
        ...(projectParentDirectory ? { defaultPath: projectParentDirectory } : {}),
      })
      if (!selected.canceled && selected.filePath) setProjectParentDirectory(selected.filePath)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '选择项目位置失败')
    }
  }

  const handleSaveProject = async () => {
    if (title.trim().length === 0) {
      message.warning('请输入项目名称')
      return
    }
    setSaving(true)
    try {
      if (editingProjectId == null) {
        const snapshot = await canvasApi.createProject({
          title: title.trim(),
          description: description.trim(),
          ...(projectParentDirectory ? { parentDirectory: projectParentDirectory } : {}),
        })
        const newProjectId = snapshot.project.id
        // 新建时若有选中封面：上传到项目目录并落库（rootPath 此刻已生成）
        if (coverFile) {
          try {
            await canvasApi.uploadProjectCoverFromFile(
              newProjectId,
              coverFile,
              snapshot.project.rootPath ?? null,
            )
          } catch (err) {
            // 封面上传失败不阻塞项目创建，用户可在编辑对话框里重试
            console.warn('[canvas] upload cover failed on create', err)
          }
        }
        setCreateOpen(false)
        setTitle('')
        setDescription('')
        setProjectParentDirectory('')
        setCoverFile(null)
        setCoverPreviewUrl(null)
        setCoverRemoved(false)
        await refresh()
        await handleOpenProject(newProjectId)
      } else {
        await canvasApi.updateProject(editingProjectId, {
          title: title.trim(),
          description: description.trim() || null,
        })
        // 编辑时：新选了文件 → 上传；主动移除 → 清空；未改动 → 不动
        const project = projects.find((item) => item.id === editingProjectId)
        const rootPath = project?.rootPath ?? null
        if (coverFile) {
          await canvasApi.uploadProjectCoverFromFile(editingProjectId, coverFile, rootPath)
        } else if (coverRemoved) {
          await canvasApi.updateProjectCover(editingProjectId, null)
        }
        setCreateOpen(false)
        setEditingProjectId(null)
        setCoverFile(null)
        setCoverPreviewUrl(null)
        setCoverRemoved(false)
        await refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleArchiveProject = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    await canvasApi.updateProject(projectId, {
      status: project.status === 'archived' ? 'active' : 'archived',
    })
    await refresh()
  }

  const handleTogglePin = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    setTogglingPinId(projectId)
    try {
      await canvasApi.setProjectPinned(projectId, !project.pinned)
      await refresh()
    } finally {
      setTogglingPinId(null)
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    AntdModal.confirm({
      title: '删除 Canvas 项目？',
      content: '项目会被标记为删除，后续可接入恢复机制。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await canvasApi.deleteProject(projectId)
        await refresh()
      },
    })
  }

  const handleImportProject = async () => {
    setImporting(true)
    try {
      let targetParentDirectory = ''
      try {
        targetParentDirectory = await canvasApi.getDefaultProjectsRoot()
      } catch {
        targetParentDirectory = ''
      }
      const selectedDirectory = await window.spark.invoke('dialog:open-directory', {
        title: '选择导入项目保存位置',
        ...(targetParentDirectory ? { defaultPath: targetParentDirectory } : {}),
      })
      if (!selectedDirectory.canceled && selectedDirectory.filePath) {
        targetParentDirectory = selectedDirectory.filePath
      }
      const snapshot = await canvasApi.importProjectFromFile(targetParentDirectory || undefined)
      if (!snapshot) return
      message.success(`已导入「${snapshot.project.title}」`)
      await refresh()
      await handleOpenProject(snapshot.project.id)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入 Canvas 项目失败')
    } finally {
      setImporting(false)
    }
  }

  const handleOpenProjectFolder = async (projectId: string) => {
    try {
      const result = await canvasApi.openProjectFolder(projectId)
      if (!result.opened) message.error(result.error || '打开项目文件夹失败')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开项目文件夹失败')
    }
  }

  const handleExportProject = async (projectId: string) => {
    setExportingProjectId(projectId)
    try {
      const result = await canvasApi.exportProjectPackage(projectId)
      if (result.exported) message.success('Canvas 项目包已导出')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出 Canvas 项目失败')
    } finally {
      setExportingProjectId(null)
    }
  }

  return (
    <div className="canvas-projects-view canvas-uiux-v4-projects">
      <header className="canvas-projects-header">
        <div className="canvas-projects-heading">
          <span>PROJECT CANVAS</span>
          <h2>画布项目</h2>
          <p>以项目为入口管理无限画布、素材、任务和生成血缘。</p>
        </div>
        <div className="canvas-projects-header-actions">
          <Button
            size="medium"
            type="text"
            icon={<Icons.Upload size={15} />}
            loading={importing}
            onClick={() => void handleImportProject()}
          >
            导入项目
          </Button>
          <Button size="medium" type="primary" icon={<Icons.Plus size={15} />} onClick={openCreate}>
            新建项目
          </Button>
        </div>
      </header>

      <div className="canvas-projects-toolbar">
        <LobeSearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索项目名称或描述..."
          className="canvas-projects-search"
        />
        <div className="canvas-projects-toolbar-right">
          <div className="canvas-projects-sort">
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: (Object.keys(SORT_LABELS) as CanvasProjectSortKey[]).map((key) => ({
                  key,
                  label: SORT_LABELS[key],
                  icon:
                    sortKey === key ? (
                      <Icons.Check size={13} />
                    ) : (
                      <span className="canvas-projects-sort-icon-placeholder" />
                    ),
                  onClick: () => setSortKey(key),
                })),
              }}
            >
              <Button size="middle" type="text">
                <span className="canvas-projects-sort-label">排序：{SORT_LABELS[sortKey]}</span>
                <Icons.ChevronDown size={13} />
              </Button>
            </Dropdown>
            <Button
              size="middle"
              type="text"
              icon={
                sortDir === 'desc' ? <Icons.ArrowDown size={13} /> : <Icons.ArrowUp size={13} />
              }
              onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
              title={sortDir === 'desc' ? '当前降序，点击切换升序' : '当前升序，点击切换降序'}
            />
          </div>
          {/* <div className="canvas-projects-stats">
            <Tag color="blue">{projects.length} projects</Tag>
            <Tag color="green">
              {projects.reduce((sum, project) => sum + project.taskCount, 0)} tasks
            </Tag>
            <Tag color="orange">
              {projects.reduce((sum, project) => sum + project.assetCount, 0)} assets
            </Tag>
          </div> */}
        </div>
      </div>

      <main className="canvas-projects-main">
        {loading ? (
          <div className="canvas-projects-empty">
            <Spin description="正在加载 Canvas 项目..." />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="canvas-projects-empty">
            <Empty description={projects.length === 0 ? '还没有画布项目' : '没有匹配的项目'} />
            {projects.length === 0 && (
              <Button type="primary" icon={<Icons.Plus size={15} />} onClick={openCreate}>
                创建第一个项目
              </Button>
            )}
          </div>
        ) : (
          <div className="canvas-projects-grid">
            {filteredProjects.map((project) => (
              <CanvasProjectCard
                key={project.id}
                project={project}
                opening={openingProjectId === project.id}
                busy={exportingProjectId === project.id || togglingPinId === project.id}
                onOpen={(projectId) => void handleOpenProject(projectId)}
                onTogglePin={(projectId) => void handleTogglePin(projectId)}
                onEdit={openEdit}
                onOpenFolder={(projectId) => void handleOpenProjectFolder(projectId)}
                onExport={(projectId) => void handleExportProject(projectId)}
                onArchive={(projectId) => void handleArchiveProject(projectId)}
                onDelete={(projectId) => void handleDeleteProject(projectId)}
              />
            ))}
          </div>
        )}
      </main>

      <Modal
        className="canvas-project-modal"
        title={editingProjectId == null ? '新建 Canvas 项目' : '编辑 Canvas 项目'}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleSaveProject()}
        confirmLoading={saving}
        okText={editingProjectId == null ? '创建并进入画布' : '保存'}
        cancelText="取消"
      >
        <div className="canvas-create-form">
          <label>
            项目名称
            <LobeInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：618 商品主图"
              autoFocus
            />
          </label>
          <label>
            描述
            <LobeTextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个项目要生成什么、有哪些素材和风格约束"
              rows={4}
            />
          </label>
          <label>
            封面图
            <div className="canvas-create-cover">
              <button
                type="button"
                className="canvas-create-cover-dropzone"
                onClick={() => coverInputRef.current?.click()}
              >
                {coverPreviewUrl ? (
                  <img src={coverPreviewUrl} alt="封面预览" draggable={false} />
                ) : (
                  <span className="canvas-create-cover-placeholder">
                    <Icons.ImagePlus size={22} />
                    <span>点击选择封面图（建议 16:9，&lt;= 8MB）</span>
                  </span>
                )}
              </button>
              {coverPreviewUrl && (
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Trash size={13} />}
                  onClick={handleClearCover}
                >
                  {editingProjectId != null && !coverFile ? '移除当前封面' : '移除'}
                </Button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  handleSelectCoverFile(file)
                  // 清空 value 让同一文件可重复触发 onChange
                  e.target.value = ''
                }}
              />
            </div>
          </label>
          <label>
            项目位置
            <div className="canvas-create-location">
              <LobeInput value={projectParentDirectory || '使用默认 Canvas 项目根目录'} readOnly />
              <Button
                type="text"
                icon={<Icons.Folder size={14} />}
                onClick={() => void handleChooseProjectLocation()}
                disabled={editingProjectId != null}
              >
                选择
              </Button>
            </div>
          </label>
        </div>
      </Modal>
    </div>
  )
}
