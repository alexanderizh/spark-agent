import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Modal, Tag } from '@lobehub/ui'
import { Modal as AntdModal, Spin, message } from 'antd'
import { Icons } from '../../Icons'
import { MacWindowDragHeader } from '../../components/MacWindowDragHeader'
import { Input as LobeInput, SearchBar as LobeSearchBar, TextArea as LobeTextArea } from '@lobehub/ui'
import { canvasApi } from './canvas.api'
import { useCanvasProjects, type CanvasViewMode } from './canvas.store'
import { CanvasWorkspaceView } from './CanvasWorkspaceView'
import './CanvasProjectsView.less'

export function CanvasProjectsView({
  onWorkspaceActiveChange,
}: {
  onWorkspaceActiveChange?: (active: boolean) => void
}) {
  const { projects, loading, refresh } = useCanvasProjects()
  const [viewMode, setViewMode] = useState<CanvasViewMode>({ mode: 'projects' })
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return projects
    return projects.filter(
      (project) =>
        project.title.toLowerCase().includes(keyword) ||
        (project.description ?? '').toLowerCase().includes(keyword),
    )
  }, [projects, query])

  useEffect(() => {
    onWorkspaceActiveChange?.(viewMode.mode === 'workspace')
  }, [onWorkspaceActiveChange, viewMode.mode])

  if (viewMode.mode === 'workspace') {
    return (
      <CanvasWorkspaceView
        projectId={viewMode.projectId}
        onBack={() => {
          setViewMode({ mode: 'projects' })
          void refresh()
        }}
      />
    )
  }

  const openCreate = () => {
    setEditingProjectId(null)
    setTitle('')
    setDescription('')
    setCreateOpen(true)
  }

  const openEdit = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    setEditingProjectId(projectId)
    setTitle(project.title)
    setDescription(project.description ?? '')
    setCreateOpen(true)
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
        })
        setCreateOpen(false)
        setTitle('')
        setDescription('')
        await refresh()
        setViewMode({ mode: 'workspace', projectId: snapshot.project.id })
      } else {
        await canvasApi.updateProject(editingProjectId, {
          title: title.trim(),
          description: description.trim() || null,
        })
        setCreateOpen(false)
        setEditingProjectId(null)
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

  return (
    <div className="canvas-projects-view">
      <MacWindowDragHeader />
      <header className="canvas-projects-header">
        <div>
          <h2>Canvas Projects</h2>
          <p>以项目为入口管理无限画布、素材、任务和生成血缘。</p>
        </div>
        <Button type="primary" icon={<Icons.Plus size={15} />} onClick={openCreate}>
          新建项目
        </Button>
      </header>

      <div className="canvas-projects-toolbar">
        <LobeSearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索项目名称或描述..."
          className="canvas-projects-search"
        />
        <div className="canvas-projects-stats">
          <Tag color="blue">
            {projects.length} projects
          </Tag>
          <Tag color="green">
            {projects.reduce((sum, project) => sum + project.taskCount, 0)} tasks
          </Tag>
          <Tag color="orange">
            {projects.reduce((sum, project) => sum + project.assetCount, 0)} assets
          </Tag>
        </div>
      </div>

      <main className="canvas-projects-main">
        {loading ? (
          <div className="canvas-projects-empty">
            <Spin tip="正在加载 Canvas 项目..." />
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
              <article
                key={project.id}
                className="canvas-project-card"
                onClick={() => setViewMode({ mode: 'workspace', projectId: project.id })}
              >
                <div className="canvas-project-cover">
                  <Icons.Canvas size={34} />
                  <div className="canvas-project-cover-grid" />
                </div>
                <div className="canvas-project-card-body">
                  <div className="canvas-project-card-top">
                    <h3>{project.title}</h3>
                    <Tag color={project.status === 'archived' ? 'default' : 'green'}>
                      {project.status === 'archived' ? '已归档' : '进行中'}
                    </Tag>
                  </div>
                  <p>{project.description || '暂无描述'}</p>
                  <div className="canvas-project-card-meta">
                    <span>{project.nodeCount} 节点</span>
                    <span>{project.assetCount} 资产</span>
                    <span>{project.taskCount} 任务</span>
                  </div>
                  <div className="canvas-project-card-foot">
                    <span>更新 {new Date(project.updatedAt).toLocaleString()}</span>
                    <div
                      className="canvas-project-actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Dropdown
                        trigger={['click']}
                        placement="bottom"
                        menu={{
                          items: [
                            { key: 'rename', label: '重命名', onClick: () => openEdit(project.id) },
                            { key: 'archive', label: project.status === 'archived' ? '恢复' : '归档', onClick: () => void handleArchiveProject(project.id) },
                            { key: 'delete', label: '删除', onClick: () => void handleDeleteProject(project.id) },
                          ],
                        }}
                      >
                        <Button size="small" type="text" icon={<Icons.More size={13} />} />
                      </Dropdown>
                      <Button size="small" type="text" icon={<Icons.ChevronRight size={13} />}>
                        打开
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <Modal
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
        </div>
      </Modal>
    </div>
  )
}
