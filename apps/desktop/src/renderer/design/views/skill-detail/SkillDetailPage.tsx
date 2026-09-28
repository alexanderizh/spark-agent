/**
 * SkillDetailPage — 技能详情页（技能管理的二级页面）。
 *
 * 布局对齐「文件浏览器」范式（左文件树 + 右文件面板）：
 *
 *   ┌ 头部：← 返回 | 图标 + 技能名 + 触发描述 · N 个文件 · 已分发 N 个 Agent
 *   │       右侧：刷新 / 技能概览 / 编辑（或 保存·取消）/ 更多(发布到团队·卸载) / 安装给 Agent
 *   ├ 左栏：技能目录文件树（SKILL.md 置顶）
 *   └ 右栏：技能文件查看器（预览 / 源码 / 编辑）
 *
 * 两类技能的数据来源：
 *   1. **磁盘技能**（本地导入 / 目录 / 软链 / 市场安装 / 内置文件技能）
 *      → skill:files 拿目录树，skill:read-file 预览，skill:write-file 保存
 *   2. **虚拟技能**（「手动创建」表单产生，rootPath = `user://xxx`，磁盘无文件）
 *      → 用技能定义合成一份 SKILL.md 供预览/编辑，保存走 skill:update 写回 manifest
 *
 * 只读策略：内置技能（readOnly）禁用编辑入口，并在头部给出原因提示。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ManagedAgent, SkillDetailInfo, SkillFileNode, SkillItem } from '@spark/protocol'
import { ActionIcon, Button, Dropdown } from '@lobehub/ui'
import type { DropdownMenuItemType } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'
import { SkillFileTree } from './SkillFileTree'
import { SkillFileViewer } from './SkillFileViewer'
import type { SkillFileViewMode } from './SkillFileViewer'
import {
  SKILL_ENTRY_FILE,
  composeVirtualSkillMarkdown,
  countFiles,
  dirnameAbsolute,
  isImageFile,
  joinAbsolutePath,
  parseVirtualSkillMarkdown,
  toSingleLine,
  utf8ByteLength,
} from './skill-detail-utils'
import './SkillDetailPage.less'

interface SkillDetailPageProps {
  skill: SkillItem
  detail: SkillDetailInfo | null
  detailLoading: boolean
  agents: ManagedAgent[]
  onBack: () => void
  /** 文件 / 元数据变更后通知上层刷新列表与详情 */
  onChanged: () => void
  /** 打开「技能概览」弹窗（沿用既有详情弹窗） */
  onOpenOverview: () => void
  onAssignToAgents: () => void
  onPublishToTeam: () => void
  onJumpToAgent: (agentId: string) => void
}

interface FilesState {
  loading: boolean
  rootPath: string | null
  files: SkillFileNode[]
  readOnly: boolean
  readOnlyReason: string
  truncated: boolean
  error: string
}

interface FileState {
  path: string | null
  content: string
  size: number
  truncated: boolean
  error: string
  loading: boolean
}

const EMPTY_FILES: FilesState = {
  loading: true,
  rootPath: null,
  files: [],
  readOnly: false,
  readOnlyReason: '',
  truncated: false,
  error: '',
}

const EMPTY_FILE: FileState = {
  path: null,
  content: '',
  size: 0,
  truncated: false,
  error: '',
  loading: false,
}

/** 默认打开的文件：根目录 SKILL.md → 根目录任意文件 → 递归第一个文件 */
function pickDefaultFile(nodes: SkillFileNode[]): string | null {
  const rootEntry = nodes.find((node) => node.type === 'file' && node.name === SKILL_ENTRY_FILE)
  if (rootEntry != null) return rootEntry.path
  const rootFile = nodes.find((node) => node.type === 'file')
  if (rootFile != null) return rootFile.path
  for (const node of nodes) {
    if (node.type !== 'directory' || node.children == null) continue
    const hit = pickDefaultFile(node.children)
    if (hit != null) return hit
  }
  return null
}

function collectFilePaths(nodes: SkillFileNode[]): string[] {
  const paths: string[] = []
  const visit = (list: SkillFileNode[]): void => {
    for (const node of list) {
      if (node.type === 'file') paths.push(node.path)
      else if (node.children != null) visit(node.children)
    }
  }
  visit(nodes)
  return paths
}

export function SkillDetailPage({
  skill,
  detail,
  detailLoading,
  agents,
  onBack,
  onChanged,
  onOpenOverview,
  onAssignToAgents,
  onPublishToTeam,
  onJumpToAgent,
}: SkillDetailPageProps) {
  const { requestConfirm } = useApp()
  const { toast } = useToast()
  const { invoke: listSkillFiles } = useIpcInvoke('skill:files')
  const { invoke: readSkillFile } = useIpcInvoke('skill:read-file')
  const { invoke: writeSkillFile } = useIpcInvoke('skill:write-file')
  const { invoke: updateSkill } = useIpcInvoke('skill:update')
  const { invoke: deleteSkill } = useIpcInvoke('skill:delete')

  const [filesState, setFilesState] = useState<FilesState>(EMPTY_FILES)
  const [fileState, setFileState] = useState<FileState>(EMPTY_FILE)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [mode, setMode] = useState<SkillFileViewMode>('preview')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const definition = detail?.definition ?? null
  const isBuiltin = skill.id.startsWith('builtin:')

  // ── 1. 拉文件树 ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setFilesState((prev) => ({ ...prev, loading: true, error: '' }))
    listSkillFiles({ id: skill.id })
      .then((res) => {
        if (cancelled) return
        setFilesState({
          loading: false,
          rootPath: res.rootPath,
          files: res.files,
          readOnly: res.readOnly,
          readOnlyReason: res.readOnlyReason ?? '',
          truncated: res.truncated === true,
          error: res.error ?? '',
        })
      })
      .catch((err) => {
        if (cancelled) return
        setFilesState({
          ...EMPTY_FILES,
          loading: false,
          readOnly: true,
          error: err instanceof Error ? err.message : '读取技能目录失败',
        })
      })
    return () => {
      cancelled = true
    }
  }, [skill.id, listSkillFiles, reloadKey])

  // ── 2. 虚拟技能：用技能定义合成一份可预览/可编辑的 SKILL.md ────────────
  // 「手动创建」表单产生的技能 rootPath 形如 user://xxx，磁盘上本就没有文件，
  // 这里用技能定义反向渲染出一份 SKILL.md，让预览/编辑体验与磁盘技能一致。
  const pathIsVirtual = skill.rootPath.includes('://')
  const virtual = pathIsVirtual && !filesState.loading
  // 磁盘技能的文件树/预览不依赖 skill:detail，因此不因详情在途而显示加载态
  // （保存文件后上层会重拉详情，若把详情也计入 loading，内容区会无谓闪烁）
  const awaitingDetail = pathIsVirtual && detailLoading
  const dirMissing =
    !pathIsVirtual &&
    !filesState.loading &&
    filesState.rootPath == null &&
    filesState.error.length === 0
  const treeError = dirMissing ? '技能目录不存在或已被移动，无法预览与编辑' : filesState.error
  const virtualContent = useMemo(() => {
    if (!virtual || definition == null) return ''
    return composeVirtualSkillMarkdown({
      name: definition.name || skill.name,
      description: definition.description ?? '',
      version: definition.version || skill.version,
      author: definition.author ?? '',
      category: definition.category ?? '',
      tags: definition.tags ?? [],
      requiredTools: definition.requiredTools ?? [],
      body: definition.systemPrompt ?? '',
    })
  }, [virtual, definition, skill.name, skill.version])

  const nodes = useMemo<SkillFileNode[]>(() => {
    if (!virtual) return filesState.files
    if (definition == null) return []
    return [
      {
        path: SKILL_ENTRY_FILE,
        name: SKILL_ENTRY_FILE,
        type: 'file',
        size: utf8ByteLength(virtualContent),
      },
    ]
  }, [virtual, filesState.files, definition, virtualContent])

  const fileCount = useMemo(() => countFiles(nodes), [nodes])
  const readOnly = filesState.readOnly || (virtual && isBuiltin)
  const readOnlyReason =
    filesState.readOnlyReason || (virtual && isBuiltin ? '内置技能为只读' : '')

  // ── 3. 选中文件：文件树变化后校正选中项 ──────────────────────────────
  useEffect(() => {
    if (filesState.loading || awaitingDetail) return
    setSelectedPath((prev) => {
      const all = collectFilePaths(nodes)
      if (prev != null && all.includes(prev)) return prev
      return pickDefaultFile(nodes)
    })
  }, [nodes, filesState.loading, awaitingDetail])

  // ── 4. 读取选中文件内容（虚拟技能直接用合成内容） ──────────────────────
  useEffect(() => {
    if (selectedPath == null) {
      setFileState(EMPTY_FILE)
      return
    }
    if (virtual) {
      setFileState({
        path: selectedPath,
        content: virtualContent,
        size: utf8ByteLength(virtualContent),
        truncated: false,
        error: '',
        loading: false,
      })
      return
    }
    // 图片等二进制文件不走文本读取（主进程会直接拒绝），预览用 safe-file:// 渲染，
    // 源码视图由 Viewer 给出「二进制」提示。
    if (isImageFile(selectedPath)) {
      setFileState({
        path: selectedPath,
        content: '',
        size: 0,
        truncated: false,
        error: '',
        loading: false,
      })
      return
    }
    let cancelled = false
    setFileState((prev) => ({ ...prev, path: selectedPath, loading: true, error: '' }))
    readSkillFile({ id: skill.id, path: selectedPath })
      .then((res) => {
        if (cancelled) return
        setFileState({
          path: selectedPath,
          content: res.error != null && res.error.length > 0 ? '' : res.content,
          size: res.size,
          truncated: res.truncated === true,
          error: res.error ?? '',
          loading: false,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setFileState({
          path: selectedPath,
          content: '',
          size: 0,
          truncated: false,
          error: err instanceof Error ? err.message : '读取文件失败',
          loading: false,
        })
      })
    return () => {
      cancelled = true
    }
  }, [selectedPath, virtual, virtualContent, skill.id, readSkillFile, reloadKey])

  // ── 5. 草稿与脏标记 ──────────────────────────────────────────────────
  useEffect(() => {
    setDraft(fileState.content)
  }, [fileState.content, fileState.path])

  const dirty = editing && draft !== fileState.content

  // 切换技能 / 卸载时清空编辑态
  useEffect(() => {
    setEditing(false)
    setMode('preview')
  }, [skill.id])

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    const confirmed = await requestConfirm({
      title: '放弃未保存的修改？',
      description: `「${skill.name}」有未保存的内容修改，放弃后无法恢复。`,
      confirmText: '放弃修改',
      danger: true,
    })
    return confirmed
  }, [dirty, requestConfirm, skill.name])

  const handleSelectFile = useCallback(
    async (node: SkillFileNode) => {
      if (node.path === selectedPath) return
      if (!(await confirmDiscard())) return
      setEditing(false)
      setMode('preview')
      setSelectedPath(node.path)
    },
    [selectedPath, confirmDiscard],
  )

  const handleBack = useCallback(async () => {
    if (!(await confirmDiscard())) return
    onBack()
  }, [confirmDiscard, onBack])

  const handleStartEdit = useCallback(() => {
    if (readOnly) {
      toast.warning(readOnlyReason || '该技能为只读')
      return
    }
    if (selectedPath == null) return
    if (isImageFile(selectedPath) || fileState.error.length > 0) {
      toast.warning('该文件为二进制内容，不支持编辑')
      return
    }
    setDraft(fileState.content)
    setMode('source')
    setEditing(true)
  }, [readOnly, readOnlyReason, fileState.error, fileState.content, selectedPath, toast])

  const canEditFile =
    selectedPath != null &&
    !readOnly &&
    !isImageFile(selectedPath) &&
    fileState.error.length === 0

  const handleCancelEdit = useCallback(async () => {
    if (!(await confirmDiscard())) return
    setEditing(false)
    setDraft(fileState.content)
  }, [confirmDiscard, fileState.content])

  // ── 6. 保存 ─────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!editing || saving) return
    if (selectedPath == null) return
    if (readOnly) {
      toast.warning(readOnlyReason || '该技能为只读')
      return
    }
    setSaving(true)
    try {
      if (virtual) {
        const parsed = parseVirtualSkillMarkdown(draft)
        const base = safeParseJson(skill.manifestJson)
        const nextManifest = {
          ...base,
          desc: parsed.description || base.desc || '',
          description: parsed.description || base.description || '',
          author: parsed.author || base.author || '',
          category: parsed.category || base.category || '',
          tags: parsed.tags,
          requiredTools: parsed.requiredTools.length > 0 ? parsed.requiredTools : base.requiredTools,
          systemPrompt: parsed.body,
        }
        const nextName = parsed.name.trim() || skill.name
        const nextVersion = parsed.version.trim() || skill.version
        await updateSkill({
          id: skill.id,
          name: nextName,
          version: nextVersion,
          manifestJson: JSON.stringify(nextManifest),
        })
      } else {
        const res = await writeSkillFile({ id: skill.id, path: selectedPath, content: draft })
        if (!res.success) throw new Error(res.error ?? '保存失败')
      }
      setFileState((prev) => ({
        ...prev,
        content: draft,
        size: utf8ByteLength(draft),
        truncated: false,
        error: '',
      }))
      setEditing(false)
      toast.success(`已保存 ${selectedPath}`)
      onChanged()
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [
    editing,
    saving,
    selectedPath,
    readOnly,
    readOnlyReason,
    virtual,
    draft,
    skill.id,
    skill.name,
    skill.version,
    skill.manifestJson,
    updateSkill,
    writeSkillFile,
    toast,
    onChanged,
  ])

  // 页面级 Ctrl/Cmd+S：焦点不在 Monaco 内时同样生效
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    if (!editing) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void saveRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing])

  // 关闭 / 刷新页面前提醒（Electron 下 beforeunload 仅覆盖窗口关闭）
  useEffect(() => {
    if (!dirty) return undefined
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // ── 7. 卸载技能 ─────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    const confirmed = await requestConfirm({
      title: '删除 Skill？',
      description: `删除后「${skill.name}」将从本地移除，相关能力将不再可用。`,
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      const res = await deleteSkill({ id: skill.id })
      if (!res.success) throw new Error('删除失败')
      toast.success('已删除 Skill')
      onChanged()
      onBack()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }, [requestConfirm, skill.id, skill.name, deleteSkill, toast, onChanged, onBack])

  // ── 8. 头部展示数据 ─────────────────────────────────────────────────
  const manifestDesc = safeParseJson(skill.manifestJson).desc
  const triggerText = toSingleLine(
    definition?.description ?? (typeof manifestDesc === 'string' ? manifestDesc : ''),
  )
  const assignedAgents = useMemo(
    () => agents.filter((a) => a.skillIds.includes(skill.id)),
    [agents, skill.id],
  )

  const selectedNode = useMemo(() => {
    if (selectedPath == null) return null
    const visit = (list: SkillFileNode[]): SkillFileNode | null => {
      for (const node of list) {
        if (node.path === selectedPath) return node
        if (node.children != null) {
          const hit = visit(node.children)
          if (hit != null) return hit
        }
      }
      return null
    }
    return visit(nodes)
  }, [nodes, selectedPath])

  const absolutePath = useMemo(() => {
    if (filesState.rootPath == null || selectedPath == null) return null
    return joinAbsolutePath(filesState.rootPath, selectedPath)
  }, [filesState.rootPath, selectedPath])

  const imageBasePath = useMemo(
    () => (absolutePath != null ? dirnameAbsolute(absolutePath) : null),
    [absolutePath],
  )

  // 体积优先取文件树里的真实大小（图片等二进制文件不做文本读取，fileState.size 为 0）
  const viewerSize = selectedNode?.size ?? fileState.size

  const modelKey = useMemo(() => {
    if (absolutePath != null) return absolutePath
    return `skill://${skill.id.replace(/[:/]/g, '-')}/${selectedPath ?? SKILL_ENTRY_FILE}`
  }, [absolutePath, skill.id, selectedPath])

  const moreItems = useMemo<DropdownMenuItemType[]>(() => {
    const items: DropdownMenuItemType[] = [
      {
        key: 'overview',
        label: '技能概览',
        icon: <Icons.Sliders size={13} />,
        onClick: onOpenOverview,
      },
    ]
    if (isBuiltin) return items
    items.push(
      {
        key: 'publish',
        label: '发布到团队',
        icon: <Icons.Users size={13} />,
        onClick: onPublishToTeam,
      },
      {
        key: 'uninstall',
        label: '卸载技能',
        icon: <Icons.Trash size={13} />,
        danger: true,
        onClick: () => {
          void handleDelete()
        },
      },
    )
    return items
  }, [isBuiltin, onOpenOverview, onPublishToTeam, handleDelete])

  return (
    <div className="skill-detail-page">
      <div className="skill-detail-header">
        <div className="skill-detail-header-left">
          <button
            type="button"
            className="skill-detail-back"
            onClick={() => void handleBack()}
            title="返回技能列表"
          >
            <Icons.ArrowLeft size={15} />
          </button>
          <div className="skill-detail-identity">
            <div className="skill-detail-crumbs">
              <span className="skill-detail-crumbs-root">Skill</span>
              <Icons.ChevronRight size={11} />
              <span>技能详情</span>
            </div>
            <div className="skill-detail-name-row">
              <span className="skill-detail-name" title={skill.name}>
                {skill.name}
              </span>
              {isBuiltin && <span className="skill-detail-badge">内置</span>}
              {!skill.enabled && <span className="skill-detail-badge is-muted">已禁用</span>}
            </div>
            <div className="skill-detail-subtitle" title={triggerText}>
              {triggerText.length > 0 && (
                <>
                  <span className="skill-detail-subtitle-label">触发描述</span>
                  <span className="skill-detail-subtitle-text">{triggerText}</span>
                  <span className="skill-detail-dot">·</span>
                </>
              )}
              <span>{fileCount} 个文件</span>
              {assignedAgents.length > 0 && (
                <>
                  <span className="skill-detail-dot">·</span>
                  <button
                    type="button"
                    className="skill-detail-assign-link"
                    onClick={() => onJumpToAgent(assignedAgents[0]?.id ?? '')}
                    title="查看已分发的 Agent"
                  >
                    已分发 {assignedAgents.length} 个 Agent
                  </button>
                </>
              )}
              {readOnly && (
                <>
                  <span className="skill-detail-dot">·</span>
                  <span className="skill-detail-readonly" title={readOnlyReason}>
                    <Icons.Lock size={11} />
                    只读
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="skill-detail-header-right">
          {editing ? (
            <>
              <span className={`skill-detail-dirty ${dirty ? 'is-dirty' : ''}`}>
                {dirty ? '有未保存的修改' : '无修改'}
              </span>
              <Button size="small" type="text" disabled={saving} onClick={() => void handleCancelEdit()}>
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                loading={saving}
                disabled={!dirty}
                icon={<Icons.Check size={14} />}
                onClick={() => void handleSave()}
              >
                保存
              </Button>
            </>
          ) : (
            <>
              <ActionIcon
                icon={Icons.Refresh}
                size="small"
                variant="borderless"
                title="刷新文件"
                onClick={() => setReloadKey((k) => k + 1)}
              />
              <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
                <Button size="small" type="text" icon={<Icons.More size={14} />}>
                  更多
                </Button>
              </Dropdown>
              <Button
                size="small"
                icon={<Icons.Pencil size={14} />}
                disabled={!canEditFile}
                title={readOnly ? readOnlyReason || '该技能为只读' : `编辑 ${selectedNode?.name ?? ''}`}
                onClick={handleStartEdit}
              >
                编辑
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<Icons.Bot size={14} />}
                onClick={onAssignToAgents}
              >
                安装给 Agent
              </Button>
            </>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="skill-detail-banner">
          <Icons.Lock size={12} />
          <span>{readOnlyReason || '该技能为只读，不支持编辑'}</span>
        </div>
      )}

      <div className="skill-detail-body">
        <SkillFileTree
          rootName={skill.name}
          nodes={nodes}
          selectedPath={selectedPath}
          onSelectFile={(node) => void handleSelectFile(node)}
          dirtyPaths={dirty && selectedPath != null ? [selectedPath] : []}
          subtitle={triggerText}
          loading={filesState.loading || awaitingDetail}
        />

        <SkillFileViewer
          fileName={selectedNode?.name ?? SKILL_ENTRY_FILE}
          relPath={selectedPath ?? SKILL_ENTRY_FILE}
          modelKey={modelKey}
          absolutePath={absolutePath}
          imageBasePath={imageBasePath}
          content={editing ? draft : fileState.content}
          size={viewerSize}
          truncated={fileState.truncated}
          error={fileState.error.length > 0 ? fileState.error : treeError}
          loading={fileState.loading || filesState.loading || awaitingDetail}
          mode={mode}
          onModeChange={setMode}
          editing={editing}
          readOnly={readOnly}
          saving={saving}
          empty={
            !dirMissing &&
            treeError.length === 0 &&
            selectedPath == null &&
            !filesState.loading &&
            !awaitingDetail
          }
          onDraftChange={setDraft}
          onSave={() => void handleSave()}
        />
      </div>

      {treeError.length > 0 && <div className="skill-detail-error">{treeError}</div>}
      {filesState.truncated && (
        <div className="skill-detail-note">目录文件过多，仅展示前 500 个条目</div>
      )}
      {!readOnly && !virtual && filesState.rootPath != null && (
        <div className="skill-detail-foot-hint" title={filesState.rootPath}>
          目录 {filesState.rootPath}
        </div>
      )}
    </div>
  )
}

/** 安全解析 manifestJson（失败返回空对象，避免编辑态崩溃） */
function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* 容错：manifest 损坏时按空对象处理 */
  }
  return {}
}
