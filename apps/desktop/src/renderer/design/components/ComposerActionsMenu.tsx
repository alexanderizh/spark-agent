/**
 * ComposerActionsMenu — 输入框工具栏的「+」弹窗菜单
 *
 * 把原来单一的上传按钮升级为可下拉的弹窗，提供：
 *   1. 添加文件或图片
 *   2. 技能（hover 展示全量 skills 子菜单，点击插入 `@技能名 ` 到输入框）
 *
 * 弹窗向上展开（图示），与现有 `composer-menu` 风格一致。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import type { SkillItem } from '@spark/protocol'

interface ComposerActionsMenuProps {
  /** 触发「添加文件或图片」 */
  onAddAttachments: () => void
  /** 触发「添加相关文件或目录」：选中后挂为路径引用（不发送内容，仅作上下文参考） */
  onAddContextFiles?: () => void
  /** 把技能名作为 `@技能名 ` 插入到输入框（由父组件实现光标位置） */
  onInsertSkillMention: (skill: SkillItem) => void
  /** 触发斜杠命令菜单：等同在输入框键入 `/` */
  onInsertSlashCommand?: () => void
  /** 打开技能管理页面，可指定目标 tab */
  onOpenSkillStore?: (tab: 'installed' | 'create') => void
  /** 是否在运行中（运行中禁用整个菜单） */
  disabled?: boolean
}

type SkillSubPlacement = 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left'

export function ComposerActionsMenu({
  onAddAttachments,
  onAddContextFiles,
  onInsertSkillMention,
  onInsertSlashCommand,
  onOpenSkillStore,
  disabled = false,
}: ComposerActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const skillItemRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [skillSubOpen, setSkillSubOpen] = useState(false)
  const [skillSubPlacement, setSkillSubPlacement] =
    useState<SkillSubPlacement>('bottom-right')
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillSearch, setSkillSearch] = useState('')
  const { invoke: listSkills } = useIpcInvoke('skill:list')
  const { toast } = useToast()

  const updateSkillSubPlacement = useCallback(() => {
    const item = skillItemRef.current
    if (item == null || typeof window === 'undefined') return

    const gutter = 12
    const rect = item.getBoundingClientRect()
    const estimatedSubWidth = 260
    const estimatedSubHeight = Math.min(320, window.innerHeight - gutter * 2)
    const nextVertical = rect.top + estimatedSubHeight > window.innerHeight - gutter ? 'bottom' : 'top'
    const nextHorizontal =
      rect.right + 6 + estimatedSubWidth > window.innerWidth - gutter ? 'left' : 'right'

    setSkillSubPlacement(`${nextVertical}-${nextHorizontal}` as SkillSubPlacement)
  }, [])

  // 用户 hover 到「技能」项时再加载全量 skills（按需加载，避免每次打开弹窗都请求）
  const loadSkills = useCallback(() => {
    if (skills.length > 0 || skillsLoading) return
    setSkillsLoading(true)
    listSkills({})
      .then((res) => {
        const list = res.skills ?? []
        // 排个序：启用的在前，再按名字
        list.sort((a, b) => {
          if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setSkills(list)
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : '加载技能失败')
      })
      .finally(() => setSkillsLoading(false))
  }, [skills.length, skillsLoading, listSkills, toast])

  // 子菜单关闭时清空搜索，避免下次打开残留过滤结果
  useEffect(() => {
    if (!skillSubOpen) setSkillSearch('')
  }, [skillSubOpen])

  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase()
    if (!q) return skills
    return skills.filter((s) => s.name.toLowerCase().includes(q))
  }, [skills, skillSearch])

  // 外部点击关闭
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current != null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setSkillSubOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !skillSubOpen) return
    updateSkillSubPlacement()
    window.addEventListener('resize', updateSkillSubPlacement)
    return () => {
      window.removeEventListener('resize', updateSkillSubPlacement)
    }
  }, [open, skillSubOpen, updateSkillSubPlacement])

  const handleOpenToggle = () => {
    if (disabled) return
    setOpen((prev) => {
      const next = !prev
      if (!next) setSkillSubOpen(false)
      return next
    })
  }

  const handleAddClick = () => {
    setOpen(false)
    setSkillSubOpen(false)
    onAddAttachments()
  }

  const handleContextClick = () => {
    setOpen(false)
    setSkillSubOpen(false)
    onAddContextFiles?.()
  }

  const handleCommandClick = () => {
    setOpen(false)
    setSkillSubOpen(false)
    onInsertSlashCommand?.()
  }

  const handleSkillClick = (skill: SkillItem) => {
    setOpen(false)
    setSkillSubOpen(false)
    onInsertSkillMention(skill)
  }

  const handleOpenSkillStore = (tab: 'installed' | 'create') => {
    setOpen(false)
    setSkillSubOpen(false)
    onOpenSkillStore?.(tab)
  }

  return (
    <div
      ref={rootRef}
      className={`composer-actions-menu${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <button
        type="button"
        className="icon-btn composer-actions-trigger"
        title="添加文件、图片或技能"
        disabled={disabled}
        onClick={handleOpenToggle}
      >
        <Icons.Plus size={14} />
      </button>
      {open && (
        <div className="composer-actions-popup">
          <button
            type="button"
            className="composer-actions-item"
            onClick={handleAddClick}
            onMouseEnter={() => setSkillSubOpen(false)}
          >
            <span className="composer-actions-item-icon">
              <Icons.FilePlus size={14} />
            </span>
            <span className="composer-actions-item-label">添加文件或图片</span>
          </button>
          {onAddContextFiles && (
            <button
              type="button"
              className="composer-actions-item"
              onClick={handleContextClick}
              onMouseEnter={() => setSkillSubOpen(false)}
            >
              <span className="composer-actions-item-icon">
                <Icons.FolderPlus size={14} />
              </span>
              <span className="composer-actions-item-label">添加相关文件或目录</span>
            </button>
          )}
          {onInsertSlashCommand && (
            <button
              type="button"
              className="composer-actions-item"
              onClick={handleCommandClick}
              onMouseEnter={() => setSkillSubOpen(false)}
            >
              <span className="composer-actions-item-icon">
                <Icons.Command size={14} />
              </span>
              <span className="composer-actions-item-label">命令</span>
            </button>
          )}
          <div
            ref={skillItemRef}
            className={`composer-actions-item has-sub${skillSubOpen ? ' sub-open' : ''}`}
            onMouseEnter={() => {
              updateSkillSubPlacement()
              setSkillSubOpen(true)
              loadSkills()
            }}
            onClick={() => {
              updateSkillSubPlacement()
              setSkillSubOpen((v) => !v)
            }}
            role="button"
            tabIndex={0}
          >
            <span className="composer-actions-item-icon">
              <Icons.Skills size={14} />
            </span>
            <span className="composer-actions-item-label">技能</span>
            <span className="composer-actions-item-chev">
              <Icons.ChevronRight size={12} />
            </span>
            {skillSubOpen && (
              <div
                className={`composer-actions-sub placement-${skillSubPlacement}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="composer-actions-sub-search">
                  <Icons.Search size={12} />
                  <input
                    type="text"
                    value={skillSearch}
                    placeholder="搜索技能"
                    onChange={(e) => setSkillSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                {skillsLoading ? (
                  <div className="composer-actions-sub-empty">
                    <Icons.Spinner size={12} /> 加载中…
                  </div>
                ) : filteredSkills.length === 0 ? (
                  <div className="composer-actions-sub-empty">
                    {skillSearch ? '没有匹配的技能' : '暂无可用技能'}
                  </div>
                ) : (
                  <div className="composer-actions-sub-list">
                    {filteredSkills.map((skill) => (
                      <button
                        key={skill.id}
                        type="button"
                        className="composer-actions-sub-item"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSkillClick(skill)
                        }}
                      >
                        <span className="composer-actions-sub-item-icon">
                          <Icons.File size={12} />
                        </span>
                        <span className="composer-actions-sub-item-name">
                          {skill.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {!skillsLoading && skills.length > 0 && (
                  <>
                    <div className="composer-actions-sub-divider" />
                    <button
                      type="button"
                      className="composer-actions-sub-item is-utility"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenSkillStore('installed')
                      }}
                    >
                      <span className="composer-actions-sub-item-icon">
                        <Icons.Sliders size={12} />
                      </span>
                      <span className="composer-actions-sub-item-name">管理技能</span>
                    </button>
                    <button
                      type="button"
                      className="composer-actions-sub-item is-utility"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenSkillStore('create')
                      }}
                    >
                      <span className="composer-actions-sub-item-icon">
                        <Icons.Plus size={12} />
                      </span>
                      <span className="composer-actions-sub-item-name">添加技能</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
