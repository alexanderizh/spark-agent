import { useEffect, useRef, useState } from 'react'
import { useSessionWorkflowBinding } from './useSessionWorkflowBinding'
import {
  localizeBindingBlocker,
  workflowBindingLabel,
  workflowExecutionModeLabel,
} from './sessionWorkflowBindingModel'
import './SessionWorkflowPicker.less'

export function SessionWorkflowPicker(props: {
  sessionId: string | null
  disabled?: boolean
  mentionActive?: boolean
}): React.JSX.Element | null {
  const { state, workflows, loading, saving, abandoning, error, reload, update, abandonRun } =
    useSessionWorkflowBinding(props.sessionId)
  const [open, setOpen] = useState(false)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setConfirmAbandon(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  if (props.sessionId == null) {
    return null
  }
  if (state == null) {
    if (!loading && error == null) return null
    return (
      <div className="session-workflow-picker">
        <button
          type="button"
          className="session-workflow-chip"
          disabled={loading}
          title={error ?? '正在读取会话工作流'}
          onClick={() => void reload()}
        >
          <span className="session-workflow-dot" aria-hidden="true" />
          <span className="session-workflow-chip-label">
            {loading ? '正在读取工作流…' : '工作流状态加载失败，重试'}
          </span>
        </button>
      </div>
    )
  }
  if (!state.features.writeEnabled && state.binding == null) return null
  const blocked =
    props.disabled === true || !state.canChange || saving || !state.features.writeEnabled
  const title = !state.features.writeEnabled
    ? '会话工作流当前为只读'
    : state.changeBlockers[0]
      ? localizeBindingBlocker(state.changeBlockers[0])
      : '选择当前会话使用的工作流'

  return (
    <div className="session-workflow-picker" ref={rootRef}>
      <button
        type="button"
        className="session-workflow-chip"
        aria-expanded={open}
        disabled={loading}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="session-workflow-dot" aria-hidden="true" />
        <span className="session-workflow-chip-label">
          {workflowBindingLabel(state.binding, state.effective)}
        </span>
      </button>
      {open && (
        <div className="session-workflow-menu" role="menu">
          <div className="session-workflow-menu-head">
            <span>会话工作流</span>
            <span>{workflowExecutionModeLabel(state.effective.executionMode)}</span>
          </div>
          {!state.features.runtimeEnabled && (
            <div className="session-workflow-notice is-warning">
              {state.features.runtimeRequested
                ? '会话工作流执行尚未接管，当前消息仍按 Agent 默认配置执行。'
                : '会话工作流运行功能暂时停用，当前消息仍按 Agent 默认配置执行。'}
            </div>
          )}
          {!state.features.writeEnabled && (
            <div className="session-workflow-notice">当前挂载为只读，暂时不能修改。</div>
          )}
          {props.mentionActive && (
            <div className="session-workflow-notice">
              本条 @成员消息不应用会话工作流，按成员自身配置执行。
            </div>
          )}
          {state.resumableRun?.status === 'failed' && (
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
            active={state.binding?.mode === 'inherit'}
            disabled={blocked}
            onClick={() => void update({ mode: 'inherit' })}
          />
          <WorkflowOption
            label="本会话不使用工作流"
            active={state.binding?.mode === 'disabled'}
            disabled={blocked}
            onClick={() => void update({ mode: 'disabled' })}
          />
          <div className="session-workflow-divider" />
          <div className="session-workflow-section-label">已发布工作流</div>
          {workflows.length === 0 ? (
            <div className="session-workflow-empty">暂无可挂载工作流</div>
          ) : (
            workflows.map((workflow) => (
              <WorkflowOption
                key={workflow.id}
                label={workflow.name}
                description={`v${workflow.version}`}
                active={
                  state.binding?.mode === 'override' && state.binding.workflowId === workflow.id
                }
                disabled={blocked}
                onClick={() => void update({ mode: 'override', workflowId: workflow.id })}
              />
            ))
          )}
          {!state.canChange && state.changeBlockers[0] && (
            <div className="session-workflow-notice">
              {localizeBindingBlocker(state.changeBlockers[0])}
            </div>
          )}
          {error && <div className="session-workflow-error">{error}</div>}
        </div>
      )}
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
      <span>{props.label}</span>
      {props.description && <small>{props.description}</small>}
    </button>
  )
}
