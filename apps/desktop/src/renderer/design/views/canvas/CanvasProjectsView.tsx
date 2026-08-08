import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dropdown, Modal } from '@lobehub/ui'
import { Modal as AntdModal, Spin, message } from 'antd'
import { Icons } from '../../Icons'
import { Input as LobeInput, TextArea as LobeTextArea } from '@lobehub/ui'
import { canvasApi } from './canvas.api'
import { useCanvasProjects } from './canvas.store'
import { openCanvasProjectWindow } from './canvas-window-client'
import { CanvasProjectDetail, getAssetCoverUrl } from './CanvasProjectDetail'
import type { CanvasAsset } from './canvas.types'
import { CanvasAcceptanceLauncher } from './acceptance/CanvasAcceptanceLauncher'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { useApp } from '../../AppContext'
import { useCanvasProjectSelection } from './CanvasProjectSelectionContext'
import './CanvasProjectsView.less'

// 记录已被本组件处理过的「新建项目」信号值（来自侧栏 L1「新建项目」按钮）。
// 用 module-level 而非 ref，确保 unmount→remount（切走再切回 canvas view）
// 时不会重复响应同一个已处理过的信号——用户切走再回来不应自动弹窗。
let handledCanvasCreateSignal = 0
import './uiux-v4/projects.less'
import './uiux-v4/modals.less'
import './canvas-workflow.less'

export function CanvasProjectsView({
  onWorkspaceActiveChange,
}: {
  onWorkspaceActiveChange?: (active: boolean) => void
}) {
  const { projects, loading, refresh } = useCanvasProjects()
  const { t } = useApp()
  const { selectedProjectId, selectProject, registerProjectEditHandler } =
    useCanvasProjectSelection()
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

  // 详情页模式下，主区根据 selectedProjectId 显示详情；未选中显示欢迎页
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  // 欢迎页最近项目缩略（最多 4 个，按更新时间降序）
  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
    [projects],
  )

  useEffect(() => {
    onWorkspaceActiveChange?.(false)
  }, [onWorkspaceActiveChange])

  // 监听侧栏「新建项目」按钮触发：canvasCreateSignal 递增时打开创建弹窗。
  // 信号可能在 CanvasProjectsView mount 之前就已发出（用户从别的模式点击），
  // 所以用 module-level 变量比对，只响应当前未处理的信号值。
  useEffect(() => {
    const signal = t.canvasCreateSignal
    if (signal > 0 && signal !== handledCanvasCreateSignal) {
      handledCanvasCreateSignal = signal
      openCreate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.canvasCreateSignal])

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

  const openEdit = useCallback(
    (projectId: string) => {
      const project = projects.find((item) => item.id === projectId)
      // 项目列表尚在恢复时保留请求，加载完成仍不存在则消费掉失效请求。
      if (!project) return !loading
      setEditingProjectId(projectId)
      setTitle(project.title)
      setDescription(project.description ?? '')
      setProjectParentDirectory(project.rootPath ?? '')
      setCoverFile(null)
      setCoverPreviewUrl(project.coverUrl ?? null)
      setCoverRemoved(false)
      setCreateOpen(true)
      return true
    },
    [loading, projects],
  )

  // 侧栏项目右键菜单与主区是兄弟组件；通过选择上下文转交编辑请求，
  // 等项目列表可用后复用这里唯一的一套完整编辑弹窗。
  useEffect(() => {
    return registerProjectEditHandler(openEdit)
  }, [openEdit, registerProjectEditHandler])

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
      content: '项目会被标记为删除。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await canvasApi.deleteProject(projectId)
        await refresh()
      },
    })
  }

  // 导入走默认项目根目录（canvas.api 内的 ensureCanvasProjectDirectory 兜底），
  // 避免每次导入都强制弹两次系统对话框（先选保存位置、再选 .json）。
  const handleImportProject = async () => {
    setImporting(true)
    try {
      const snapshot = await canvasApi.importProjectFromFile()
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

  // 详情页封面点击上传/更换：校验类型+大小后调 uploadProjectCoverFromFile。
  // 复用新建/编辑对话框里的同款校验，保持一致。
  const handleUploadCover = async (file: File) => {
    if (!selectedProject) return
    if (!/^image\//i.test(file.type)) {
      message.warning('请选择图片文件')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      message.warning('封面图大小请控制在 8MB 以内')
      return
    }
    try {
      await canvasApi.uploadProjectCoverFromFile(
        selectedProject.id,
        file,
        selectedProject.rootPath ?? null,
      )
      await refresh()
      message.success('封面已更新')
    } catch (err) {
      console.warn('[canvas] upload cover failed from detail page', err)
      message.error('封面上传失败')
    }
  }

  // 资源瀑布流「设为封面」：直接用资源自身的 URL 写入 cover_url，
  // 无需重新上传文件（资源已在项目目录内，URL 可直接复用）。
  const handleSetCoverFromAsset = async (asset: CanvasAsset) => {
    if (!selectedProject) return
    const coverUrl = getAssetCoverUrl(asset)
    if (!coverUrl) {
      message.warning('该资源暂无可用封面图')
      return
    }
    try {
      await canvasApi.updateProjectCover(selectedProject.id, coverUrl)
      await refresh()
      message.success('已设为项目封面')
    } catch (err) {
      console.warn('[canvas] set cover from asset failed', err)
      message.error('设为封面失败')
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
      <header
        className="canvas-projects-header canvas-view-titlebar"
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        {t.sidebarHidden && <SidebarExpandButton />}
        <div className="canvas-projects-heading">
          {/* <span>CANVAS STUDIO</span> */}
          <h2>无限画布</h2>
        </div>
        <div className="canvas-projects-header-actions">
          {import.meta.env.DEV && (
            <CanvasAcceptanceLauncher
              onReady={async (projectId) => {
                await refresh()
                await handleOpenProject(projectId)
              }}
            />
          )}
          <Button
            size="medium"
            type="text"
            onClick={() => void handleImportProject()}
            icon={<Icons.Plus size={15} />}
          >
            导入项目
          </Button>
        </div>
      </header>

      <main className="canvas-projects-main canvas-projects-detail-main">
        {loading ? (
          <div className="canvas-projects-empty">
            <Spin description="正在加载 Canvas 项目..." />
          </div>
        ) : selectedProject ? (
          <CanvasProjectDetail
            project={selectedProject}
            opening={openingProjectId === selectedProject.id}
            onOpen={(projectId) => void handleOpenProject(projectId)}
            onEdit={openEdit}
            onExport={(projectId) => void handleExportProject(projectId)}
            onArchive={(projectId) => void handleArchiveProject(projectId)}
            onDelete={(projectId) => void handleDeleteProject(projectId)}
            onOpenFolder={(projectId) => void handleOpenProjectFolder(projectId)}
            onTogglePin={(projectId) => void handleTogglePin(projectId)}
            onUploadCover={handleUploadCover}
            onSetCoverFromAsset={handleSetCoverFromAsset}
          />
        ) : (
          <div className="canvas-projects-welcome">
            <div className="canvas-welcome-hero">
              <Icons.Canvas size={48} />
              <h3>选择左侧项目查看详情，或新建画布开始创作</h3>
              {/* <p>
                无限画布以项目为单位组织素材、节点、任务与生成血缘。
                点击侧栏项目查看详情，双击直接进入画布。
              </p> */}
              <Button
                size="middle"
                type="primary"
                icon={<Icons.Plus size={16} />}
                onClick={openCreate}
              >
                新建项目
              </Button>
            </div>
            {recentProjects.length > 0 && (
              <div className="canvas-welcome-recent">
                <h4>最近项目</h4>
                <div className="canvas-welcome-recent-grid">
                  {recentProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="canvas-welcome-recent-card"
                      onClick={() => selectProject(p.id)}
                      title={p.title}
                    >
                      {p.coverUrl ? (
                        <img src={p.coverUrl} alt={p.title} draggable={false} />
                      ) : (
                        <span className="canvas-welcome-recent-placeholder">
                          <Icons.Canvas size={20} />
                        </span>
                      )}
                      <span className="canvas-welcome-recent-name">{p.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
