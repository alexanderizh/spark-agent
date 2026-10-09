import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionWorkflowBindingCreate } from '@spark/protocol'
import { Icons } from '../../../Icons'
import { useSessionWorkflowBinding } from './useSessionWorkflowBinding'
import {
  draftWorkflowBindingLabel,
  localizeBindingBlocker,
  workflowBindingLabel,
  workflowExecutionModeLabel,
} from './sessionWorkflowBindingModel'
import './SessionWorkflowPicker.less'

export function SessionWorkflowPicker(props: {
  sessionId: string | null
  draftBinding?: SessionWorkflowBindingCreate | null
  onDraftBindingChange?: (binding: SessionWorkflowBindingCreate | null) => void
  disabled?: boolean
  mentionActive?: boolean
  /** 会话模式下：发送将被路由到新建会话（所选项目与会话不一致 / 勾选 worktree）。 */
  sendRoutesToNewSession?: boolean
}): React.JSX.Element | null {
  const { sessionId, draftBinding, onDraftBindingChange } = props
  const {
    state,
    features,
    workflows,
    loading,
    saving,
    abandoning,
    error,
    clearError,
    update,
    abandonRun,
  } = useSessionWorkflowBinding(sessionId)
  const [open, setOpen] = useState(false)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ left: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (event: MouseEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
        setConfirmAbandon(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      triggerRef.current?.focus()
      setOpen(false)
      setConfirmAbandon(false)
    }
    window.addEventListener('mousedown', closeOnOutsidePress)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', closeOnOutsidePress)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }
    const updatePosition = () => {
      const trigger = triggerRef.current
      if (trigger == null) return
      const viewportGutter = 16
      const menuWidth = Math.min(320, window.innerWidth - viewportGutter * 2)
      const rect = trigger.getBoundingClientRect()
      setMenuPosition({
        left: Math.min(
          Math.max(viewportGutter, rect.left),
          Math.max(viewportGutter, window.innerWidth - menuWidth - viewportGutter),
        ),
        bottom: Math.max(viewportGutter, window.innerHeight - rect.top + 8),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (sessionId != null || features == null || draftBinding == null) return
    const selectedWorkflowUnavailable =
      draftBinding.mode === 'override' &&
      !workflows.some((workflow) => workflow.id === draftBinding.workflowId)
    if (!features.writeEnabled || workflows.length === 0 || selectedWorkflowUnavailable) {
      onDraftBindingChange?.(null)
    }
  }, [draftBinding, features, onDraftBindingChange, sessionId, workflows])

  const draftMode = sessionId == null
  if ((!draftMode && state == null) || (draftMode && features == null)) return null
  const effectiveFeatures = state?.features ?? features
  if (effectiveFeatures?.writeEnabled !== true || workflows.length === 0) return null
  const canChange = draftMode ? onDraftBindingChange != null : (state?.canChange ?? false)
  const blocked = props.disabled === true || !canChange || saving
  const title = state?.changeBlockers[0]
    ? localizeBindingBlocker(state.changeBlockers[0])
    : draftMode
      ? '选择新会话使用的工作流'
      : '选择当前会话使用的工作流'
  const selectedBinding = draftMode ? (draftBinding ?? null) : (state?.binding ?? null)
  const selectedLabel = draftMode
    ? draftWorkflowBindingLabel(draftBinding ?? null, workflows)
    : state == null
      ? '工作流'
      : workflowBindingLabel(state.binding, state.effective)
  const selected = selectedBinding?.mode === 'override'
  const accessibleLabel = selected ? `${title}，当前为${selectedLabel}` : title
  const closeMenu = () => {
    setConfirmAbandon(false)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const selectBinding = (next: SessionWorkflowBindingCreate) => {
    if (draftMode) {
      onDraftBindingChange?.(next)
      closeMenu()
      return
    }
    // 只有真正写成功才关闭弹窗：失败时保留菜单并让顶部报错留在原地，
    // 否则用户点完什么也看不到（历史实现就是这样把失败静默吞掉的）。
    void update(next).then((saved) => {
      if (saved) closeMenu()
    })
  }

  const toggleMenu = () => {
    if (open) {
      closeMenu()
      return
    }
    // 重新打开先清陈旧错误，避免把上一次的报错误读成本次结果。
    clearError()
    setConfirmAbandon(false)
    setOpen(true)
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="session-workflow-menu"
          role="menu"
          aria-label="会话工作流选择"
          style={{
            left: menuPosition?.left ?? 16,
            bottom: menuPosition?.bottom ?? 16,
            visibility: menuPosition == null ? 'hidden' : 'visible',
          }}
        >
          <div className="session-workflow-menu-head">
            <span>会话工作流</span>
            <span>
              {draftMode
                ? effectiveFeatures.runtimeEnabled
                  ? '运行时接管'
                  : '仅挂载'
                : state == null
                  ? '不执行'
                  : workflowExecutionModeLabel(state.effective.executionMode)}
            </span>
          </div>
          {/* 失败原因排在所有提示之前并吸顶：写入失败时它是用户唯一需要先看到的信息。 */}
          {error && (
            <div className="session-workflow-error" role="alert">
              {error}
            </div>
          )}
          {!effectiveFeatures.runtimeEnabled && (
            <div className="session-workflow-notice is-warning">
              {effectiveFeatures.runtimeRequested
                ? '会话工作流执行尚未接管，当前消息仍按 Agent 默认配置执行。'
                : '会话工作流运行功能暂时停用，当前消息仍按 Agent 默认配置执行。'}
            </div>
          )}
          {props.mentionActive && (
            <div className="session-workflow-notice">
              本条 @成员消息不应用会话工作流，按成员自身配置执行。
            </div>
          )}
          {!draftMode &&
            props.sendRoutesToNewSession === true &&
            selectedBinding?.mode === 'override' && (
              <div className="session-workflow-notice">
                发送将新建会话（项目切换或勾选工作树），已挂载的工作流会跟随到新会话生效。
              </div>
            )}
          {state?.resumableRun?.status === 'failed' && (
            <div className="session-workflow-notice is-warning">
              <div>上次运行失败，下一条 Host 消息将继续此运行。</div>
              {confirmAbandon ? (
                <div className="session-workflow-abandon-confirm">
                  <span>确认放弃此运行？历史保留，下一条消息将新建运行。</span>
                  <button
                    type="button"
                    className="session-workflow-abandon-accept"
                    disabled={abandoning || blocked}
                    onClick={() => {
                      setConfirmAbandon(false)
                      void abandonRun()
                    }}
                  >
                    {abandoning ? '正在放弃…' : '确认放弃'}
                  </button>
                  <button
                    type="button"
                    className="session-workflow-abandon-cancel"
                    disabled={abandoning}
                    onClick={() => setConfirmAbandon(false)}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="session-workflow-abandon"
                  disabled={blocked || abandoning}
                  onClick={() => setConfirmAbandon(true)}
                >
                  放弃并新建运行
                </button>
              )}
            </div>
          )}
          <WorkflowOption
            label="继承 Agent 默认"
            active={selectedBinding?.mode === 'inherit'}
            disabled={blocked}
            onClick={() => selectBinding({ mode: 'inherit' })}
          />
          <WorkflowOption
            label="本会话不使用工作流"
            active={selectedBinding?.mode === 'disabled'}
            disabled={blocked}
            onClick={() => selectBinding({ mode: 'disabled' })}
          />
          <div className="session-workflow-divider" />
          <div className="session-workflow-section-label">已发布工作流</div>
          {workflows.map((workflow) => (
            <WorkflowOption
              key={workflow.id}
              label={workflow.name}
              description={`v${workflow.version}`}
              active={
                selectedBinding?.mode === 'override' && selectedBinding.workflowId === workflow.id
              }
              disabled={blocked}
              onClick={() => selectBinding({ mode: 'override', workflowId: workflow.id })}
            />
          ))}
          {state != null && !state.canChange && state.changeBlockers[0] && (
            <div className="session-workflow-notice">
              {localizeBindingBlocker(state.changeBlockers[0])}
            </div>
          )}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="session-workflow-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`session-workflow-trigger${selected ? ' is-selected' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={accessibleLabel}
        data-selected={selected ? 'true' : 'false'}
        disabled={loading}
        title={accessibleLabel}
        onClick={toggleMenu}
      >
        <span aria-hidden="true">
          <Icons.WorkflowSimple size={14} />
        </span>
      </button>
      {menu}
    </div>
  )
}

function WorkflowOption(props: {
  label: string
  description?: string
  active: boolean
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.active}
      className={`session-workflow-option${props.active ? ' is-active' : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className="session-workflow-option-label" title={props.label}>
        {props.label}
      </span>
      {/* 选中态与权限策略菜单一致：右侧 check 标记 + 版本号，条目本身不变色 */}
      {props.active && <Icons.Check className="session-workflow-option-check" size={14} />}
      {props.description && (
        <small className="session-workflow-option-description" title={props.description}>
          {props.description}
        </small>
      )}
    </button>
  )
}
