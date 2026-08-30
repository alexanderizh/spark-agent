import { useCallback, useMemo, useState } from 'react'
import { Select } from 'antd'
import { Icons } from '../Icons'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useIpcInvoke } from '../hooks/useIpc'
import './ProjectSelect.less'

/**
 * "不需要项目"在下拉里的哨兵值 —— 不会与真实项目名冲突。
 * 数据层 project='' 即代表"不需要项目"；这里用哨兵把它显式化为一个可选项，
 * 以便和"用户还没选"区分开（必填校验依赖这个区分）。
 */
export const NO_PROJECT_VALUE = '__no_project__'

const NO_PROJECT_NAMES = new Set(['No project', '不使用项目'])

/** Select 当前值 → 落库值：哨兵或未选都转空串。 */
export function projectValueToStorage(v?: string): string {
  if (!v || v === NO_PROJECT_VALUE) return ''
  return v
}

/** 落库值 → Select 当前值：空串视为"不需要项目"(哨兵)，undefined 视为未选。 */
export function storageToProjectValue(stored?: string): string | undefined {
  if (stored === undefined) return undefined
  return stored === '' ? NO_PROJECT_VALUE : stored
}

/**
 * 项目选择器：会话已有项目 + "不需要项目" + "新增项目"（轻量创建，不切换活动项目）。
 * 受控组件，value 语义：undefined=未选 / NO_PROJECT_VALUE=不需要项目 / 项目名=已选某项目。
 */
export function ProjectSelect({
  value,
  onChange,
  invalid,
  placeholder = '选择项目',
  className,
}: {
  value?: string | undefined
  onChange: (v: string | undefined) => void
  invalid?: boolean
  placeholder?: string
  className?: string
}) {
  const sessionCtx = useSessionSidebar()
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: getTempProjectDir } = useIpcInvoke('app:get-temp-project-dir')

  const [selectOpen, setSelectOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [creating, setCreating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const options = useMemo(() => {
    const list = sessionCtx.projectGroups
      .map((g) => g.workspace)
      .filter((w) => w.name && !NO_PROJECT_NAMES.has(w.name))
      .map((w) => ({ label: w.name, value: w.name }))
    return [...list, { label: '不需要项目', value: NO_PROJECT_VALUE }]
  }, [sessionCtx.projectGroups])

  const openCreate = useCallback(() => {
    setSelectOpen(false)
    setErrorMsg('')
    setNewName('')
    setNewPath('')
    setCreateOpen(true)
  }, [])

  const handlePickPath = useCallback(async () => {
    try {
      const res = await openDirectoryDialog({ title: '选择项目目录（可选）' })
      if (res && !res.canceled && res.filePath) setNewPath(res.filePath)
    } catch {
      /* ignore */
    }
  }, [openDirectoryDialog])

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name) {
      setErrorMsg('请输入项目名称')
      return
    }
    if (creating) return
    setCreating(true)
    setErrorMsg('')
    try {
      let rootPath = newPath.trim()
      if (!rootPath) {
        const { tempDir } = await getTempProjectDir({})
        const safe = name.replace(/[^a-zA-Z0-9一-龥_-]/g, '_') || 'project'
        rootPath = `${tempDir}/${safe}-${Date.now()}`
      }
      const res = await openWorkspace({ create: { name, rootPath } })
      await sessionCtx.refreshData()
      onChange(res.workspace.name)
      setCreateOpen(false)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '创建项目失败')
    } finally {
      setCreating(false)
    }
  }, [creating, getTempProjectDir, newName, newPath, onChange, openWorkspace, sessionCtx])

  return (
    <>
      <Select
        className={`ps-select${invalid ? ' invalid' : ''}${className ? ` ${className}` : ''}`}
        value={value ?? null}
        open={selectOpen}
        onDropdownVisibleChange={setSelectOpen}
        onChange={(v) => onChange(v ?? undefined)}
        placeholder={placeholder}
        showSearch
        optionFilterProp="label"
        options={options}
        popupRender={(menu) => (
          <>
            {menu}
            <div className="ps-popup-divider" />
            <button type="button" className="ps-create-entry" onClick={openCreate}>
              <Icons.Plus size={12} />
              <span>新增项目</span>
            </button>
          </>
        )}
      />

      {createOpen && (
        <div
          className="ps-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setCreateOpen(false) }}
        >
          <div className="ps-modal">
            <div className="ps-modal-h">
              <div className="ps-modal-icon"><Icons.FolderPlus size={16} /></div>
              <div className="ps-modal-titles">
                <div className="ps-modal-title">新增项目</div>
                <div className="ps-modal-sub">为该任务新建一个项目，不会切换当前活动项目</div>
              </div>
              <button className="ps-modal-x" onClick={() => setCreateOpen(false)} aria-label="关闭">
                <Icons.X size={14} />
              </button>
            </div>
            <div className="ps-modal-body">
              {errorMsg && (
                <div className="ps-notice">
                  <Icons.AlertTriangle size={12} />
                  <span>{errorMsg}</span>
                </div>
              )}
              <label className="ps-field">
                <span>项目名称</span>
                <input
                  className="ps-input"
                  value={newName}
                  placeholder="输入项目名称"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
                  autoFocus
                />
              </label>
              <label className="ps-field">
                <span>目录（可选）</span>
                <div className="ps-path-picker">
                  <input
                    className="ps-input"
                    value={newPath}
                    placeholder="留空则使用临时目录"
                    onChange={(e) => setNewPath(e.target.value)}
                  />
                  <button type="button" className="ps-btn ghost" onClick={handlePickPath}>选择</button>
                </div>
              </label>
            </div>
            <div className="ps-modal-foot">
              <button type="button" className="ps-btn ghost" onClick={() => setCreateOpen(false)}>取消</button>
              <button type="button" className="ps-btn primary" onClick={handleCreate} disabled={creating}>
                {creating ? '创建中…' : '创建并选择'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
