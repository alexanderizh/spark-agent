import { useEffect, useState } from 'react'
import { Checkbox, Input, Modal, Spin, Tag, message } from 'antd'
import { Button } from '@lobehub/ui'
import {
  capabilityForOperation,
  type CanvasMediaModelSummary,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { canvasApi, operationLabel } from './canvas.api'
import {
  buildModelParams,
  mergeSchemaFields,
  modelSuggestedFields,
  operationSuggestedFields,
  schemaFields,
} from './CanvasInlineAiComposer'
import { CanvasModelPicker } from './CanvasModelPicker'
import { CanvasOperationParameterControls } from './CanvasOperationParameterControls'
import {
  type CanvasBatchEditableData,
  type CanvasBatchTaskEntry,
  type CanvasBatchTaskPatch,
} from './canvasBatchTaskModel'
import { mediaModelKey } from './canvasModelPickerModel'
import type {
  CanvasBatchTaskState,
  CanvasBatchSubmitResult,
} from './useCanvasBatchTasks'
import type { CanvasOperationType } from './canvas.types'
import './CanvasBatchTaskPanel.less'

export type CanvasBatchTaskPanelProps = {
  state: CanvasBatchTaskState
  onPatchGroup: (
    operation: CanvasOperationType,
    patch: CanvasBatchTaskPatch,
  ) => void
  onPatchNode: (nodeId: string, patch: CanvasBatchTaskPatch) => void
  onSaveDrafts: () => Promise<void>
  onSubmit: () => Promise<void>
  onConfirmSubmit: () => Promise<void>
  onRetryFailed: () => Promise<void>
  onSkipNextConfirmationChange: (skip: boolean) => void
  onSkipParameterValidationChange: (skip: boolean) => void
  onBackToConfigure: () => void
  onClose: () => void
}

export function CanvasBatchTaskPanel({
  state,
  onPatchGroup,
  onPatchNode,
  onSaveDrafts,
  onSubmit,
  onConfirmSubmit,
  onRetryFailed,
  onSkipNextConfirmationChange,
  onSkipParameterValidationChange,
  onBackToConfigure,
  onClose,
}: CanvasBatchTaskPanelProps) {
  const [activeOperation, setActiveOperation] = useState<CanvasOperationType | null>(null)
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [groupSelection, setGroupSelection] = useState<CanvasOperationType | null>(null)
  const [acknowledgedIssueSignature, setAcknowledgedIssueSignature] = useState('')
  const [query, setQuery] = useState('')
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const session = state.session
  const open = state.mode !== 'closed' && session != null
  const entries = session?.entries ?? []
  const operationGroups = groupEntries(entries)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void canvasApi
      .listMediaModels({ enabledOnly: true })
      .then((response) => {
        if (!cancelled) setMediaModels(response.models)
      })
      .catch(() => {
        if (!cancelled) setMediaModels([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!session) return null

  const sessionActiveEntry = session.activeNodeId
    ? entries.find((entry) => entry.nodeId === session.activeNodeId) ?? null
    : null
  const localActiveEntry = activeNodeId
    ? entries.find((entry) => entry.nodeId === activeNodeId) ?? null
    : null
  const firstIssueEntry = state.issues[0]
    ? entries.find((entry) => entry.nodeId === state.issues[0]?.nodeId) ?? null
    : null
  const issueSignature = state.issues
    .map((issue) => `${issue.nodeId}:${issue.fieldPath.join('.')}:${issue.message}`)
    .join('|')
  const focusFirstIssue =
    firstIssueEntry != null && acknowledgedIssueSignature !== issueSignature
  const selectedEntry = focusFirstIssue
    ? firstIssueEntry
    : groupSelection
      ? null
      : (localActiveEntry ?? sessionActiveEntry ?? firstIssueEntry)
  const currentOperation =
    (focusFirstIssue ? firstIssueEntry.operation : groupSelection) ??
    selectedEntry?.operation ??
    (activeOperation && operationGroups.has(activeOperation)
      ? activeOperation
      : session.activeOperation)
  const operationEntries = operationGroups.get(currentOperation) ?? []
  const activeNodeEntry =
    selectedEntry && selectedEntry.operation === currentOperation ? selectedEntry : null
  const editingEntries = activeNodeEntry ? [activeNodeEntry] : operationEntries
  const issueCountByNodeId = countIssuesByNodeId(state.issues)
  const visibleGroups = [...operationGroups.entries()].map(([operation, groupEntries]) => ({
    operation,
    entries: sortEntriesByIssues(
      groupEntries.filter((entry) =>
        issueCountByNodeId.has(entry.nodeId) ||
        entry.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
      issueCountByNodeId,
    ),
  }))
  const title =
    state.mode === 'confirm'
      ? `确认提交 ${entries.length} 个任务`
      : state.mode === 'result'
        ? '批量提交结果'
        : '批量配置参数'
  const busy = state.saving || state.mode === 'submitting'
  const closePanel = () => {
    if (busy) return
    setActiveOperation(null)
    setActiveNodeId(null)
    setGroupSelection(null)
    setAcknowledgedIssueSignature('')
    setQuery('')
    onClose()
  }

  return (
    <Modal
      open={open}
      width="min(1040px, calc(100vw - 32px))"
      title={title}
      footer={null}
      centered
      destroyOnHidden
      className="canvas-batch-task-modal"
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      onCancel={closePanel}
    >
      {state.mode === 'confirm' ? (
        <ConfirmView
          entries={entries}
          skip={state.skipNextConfirmation}
          skipParameterValidation={state.skipParameterValidation}
          validationWarnings={state.validationWarnings}
          onSkipChange={onSkipNextConfirmationChange}
          onSkipParameterValidationChange={onSkipParameterValidationChange}
          onBack={onBackToConfigure}
          onConfirm={onConfirmSubmit}
        />
      ) : state.mode === 'result' ? (
        <ResultView
          entries={entries}
          results={state.results}
          onRetryFailed={onRetryFailed}
          onClose={closePanel}
        />
      ) : (
        <div className={`canvas-batch-task-shell${busy ? ' is-busy' : ''}`} aria-busy={busy}>
          <aside className="canvas-batch-task-sidebar">
            <div className="canvas-batch-task-sidebar-head">
              <div>
                <strong>{entries.length} 个任务</strong>
                <span>{operationGroups.size} 种类型</span>
              </div>
              <StatusCounts entries={entries} state={state} />
            </div>
            <Input.Search
              allowClear
              value={query}
              placeholder="搜索任务节点"
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="canvas-batch-task-groups">
              {visibleGroups.map(({ operation, entries: group }) => (
                <div key={operation} className="canvas-batch-task-group">
                  <button
                    type="button"
                    className={`canvas-batch-task-group-button${
                      currentOperation === operation && !activeNodeEntry ? ' is-active' : ''
                    }`}
                    aria-current={
                      currentOperation === operation && !activeNodeEntry ? 'true' : undefined
                    }
                    onClick={() => {
                      setActiveOperation(operation)
                      setGroupSelection(operation)
                      setActiveNodeId(null)
                      setAcknowledgedIssueSignature(issueSignature)
                    }}
                  >
                    <span>{operationLabel(operation)}</span>
                    <Tag>{group.length}</Tag>
                  </button>
                  {group.map((entry) => {
                    const issueCount = issueCountByNodeId.get(entry.nodeId) ?? 0
                    const active = activeNodeEntry?.nodeId === entry.nodeId
                    return (
                      <button
                        key={entry.nodeId}
                        type="button"
                        className={`canvas-batch-task-node-button${
                          active ? ' is-active' : ''
                        }${issueCount > 0 ? ' has-error' : ''}`}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          setActiveOperation(entry.operation)
                          setGroupSelection(null)
                          setActiveNodeId(entry.nodeId)
                          setAcknowledgedIssueSignature(issueSignature)
                        }}
                      >
                        <span className="canvas-batch-task-node-copy">
                          <strong>{entry.title}</strong>
                          <small>
                            {entry.draft.modelId || entry.draft.agentId || '未选择模型'}
                          </small>
                        </span>
                        {issueCount > 0 ? (
                          <span className="canvas-batch-task-error-count">
                            <Icons.AlertTriangle size={13} />
                            {issueCount}
                          </span>
                        ) : (
                          <Icons.Check size={13} />
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </aside>

          <section className="canvas-batch-task-editor">
            <div className="canvas-batch-task-editor-head">
              <div>
                <span className="canvas-batch-task-kicker">
                  {activeNodeEntry ? '节点覆盖' : '类型共享参数'}
                </span>
                <h3>
                  {activeNodeEntry?.title ?? operationLabel(currentOperation)}
                </h3>
              </div>
              <div className="canvas-batch-task-scope-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!activeNodeEntry}
                  onClick={() => {
                    setGroupSelection(currentOperation)
                    setActiveNodeId(null)
                    setAcknowledgedIssueSignature(issueSignature)
                  }}
                >
                  类型共享参数
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={Boolean(activeNodeEntry)}
                  disabled={!activeNodeEntry}
                >
                  节点覆盖
                </button>
              </div>
            </div>

            <BatchConfigurationEditor
              operation={currentOperation}
              entries={editingEntries}
              mediaModels={mediaModels}
              modelsLoading={modelsLoading}
              onPatch={(patch) => {
                setAcknowledgedIssueSignature('')
                if (activeNodeEntry) onPatchNode(activeNodeEntry.nodeId, patch)
                else onPatchGroup(currentOperation, patch)
              }}
            />

            {state.issues.length > 0 && (
              <div className="canvas-batch-task-issues" role="alert">
                <strong>整批校验未通过，不会提交任何任务</strong>
                {state.issues
                  .filter(
                    (issue) =>
                      !activeNodeEntry || issue.nodeId === activeNodeEntry.nodeId,
                  )
                  .map((issue, index) => (
                    <div key={`${issue.nodeId}-${index}`}>
                      <Icons.AlertTriangle size={13} />
                      <span>{issue.message}</span>
                    </div>
                  ))}
              </div>
            )}
          </section>

          <footer className="canvas-batch-task-footer">
            <span aria-live="polite">
              {state.saving
                ? '正在保存参数草稿…'
                : state.issues.length > 0
                  ? `${state.issues.length} 个问题待修正`
                  : '批量修改只覆盖明确变更的字段'}
            </span>
            <div>
              <Button
                type="text"
                loading={busy}
                disabled={busy}
                onClick={() => {
                  void onSaveDrafts()
                    .then(() => message.success('批量参数草稿已保存'))
                    .catch((error) =>
                      message.error(error instanceof Error ? error.message : '保存失败'),
                    )
                }}
              >
                保存参数草稿
              </Button>
              <Button
                type="primary"
                loading={busy}
                disabled={busy}
                onClick={() => {
                  void onSubmit().catch((error) =>
                    message.error(error instanceof Error ? error.message : '提交前保存失败'),
                  )
                }}
              >
                检查并提交
              </Button>
            </div>
          </footer>
        </div>
      )}
    </Modal>
  )
}

function BatchConfigurationEditor({
  operation,
  entries,
  mediaModels,
  modelsLoading,
  onPatch,
}: {
  operation: CanvasOperationType
  entries: CanvasBatchTaskEntry[]
  mediaModels: CanvasMediaModelSummary[]
  modelsLoading: boolean
  onPatch: (patch: CanvasBatchTaskPatch) => void
}) {
  const capabilityIds = capabilityForOperation(operation)
  const supportedModels = mediaModels.filter((model) =>
    model.capabilities.some((capability) =>
      (capabilityIds as readonly string[]).includes(capability.id),
    ),
  )
  const modelIdentity = commonRuntimeIdentity(entries)
  const selectedModel =
    modelIdentity.manifestId && modelIdentity.modelId
      ? supportedModels.find(
          (model) =>
            model.providerProfileId === modelIdentity.providerProfileId &&
            model.manifestId === modelIdentity.manifestId &&
            model.effectiveModelId === modelIdentity.modelId,
        ) ?? null
      : null
  const selectedCapability =
    selectedModel?.capabilities.find((capability) =>
      (capabilityIds as readonly string[]).includes(capability.id),
    ) ?? null
  const fields = mergeSchemaFields(
    schemaFields(selectedCapability?.paramSchema ?? {}),
    operationSuggestedFields(operation),
    modelSuggestedFields(selectedModel ?? undefined),
  )
  const values = Object.fromEntries(
    fields.map((field) => [
      field.name,
      commonValue(entries, (entry) => entry.draft.modelParams?.[field.name]),
    ]),
  )
  const knownNames = new Set(fields.map((field) => field.name))
  const extraParamNames = Array.from(
    new Set(
      entries.flatMap((entry) => Object.keys(entry.draft.modelParams ?? {})),
    ),
  ).filter((name) => !knownNames.has(name) && name !== 'workflow')
  const isText =
    operation === 'text_generate' ||
    operation === 'text_rewrite' ||
    operation === 'prompt_optimize'

  return (
    <div className="canvas-batch-task-fields">
      {isText ? (
        <div className="canvas-batch-task-runtime-grid">
          <label>
            <span>Agent ID</span>
            <Input
              value={commonValue(entries, (entry) => entry.draft.agentId)}
              placeholder="多个值或未设置"
              onChange={(event) =>
                onPatch({
                  touched: ['agentId'],
                  values: { agentId: event.target.value },
                })
              }
            />
          </label>
          <label>
            <span>Provider ID</span>
            <Input
              value={commonValue(
                entries,
                (entry) => entry.draft.providerProfileId,
              )}
              placeholder="多个值或未设置"
              onChange={(event) =>
                onPatch({
                  touched: ['providerProfileId'],
                  values: { providerProfileId: event.target.value },
                })
              }
            />
          </label>
          <label>
            <span>模型 ID</span>
            <Input
              value={commonValue(entries, (entry) => entry.draft.modelId)}
              placeholder="多个值或未设置"
              onChange={(event) =>
                onPatch({
                  touched: ['modelId'],
                  values: { modelId: event.target.value },
                })
              }
            />
          </label>
        </div>
      ) : modelsLoading ? (
        <Spin />
      ) : (
        <CanvasModelPicker
          models={supportedModels}
          value={selectedModel ? mediaModelKey(selectedModel) : ''}
          allowEmpty
          emptyLabel="多个值或未选择模型"
          onChange={(modelKey) => {
            const model = supportedModels.find(
              (candidate) => mediaModelKey(candidate) === modelKey,
            )
            onPatch({
              touched: [
                'providerProfileId',
                'manifestId',
                'modelId',
              ],
              values: model
                ? {
                    ...(model.providerProfileId
                      ? { providerProfileId: model.providerProfileId }
                      : {}),
                    manifestId: model.manifestId,
                    modelId: model.effectiveModelId,
                  }
                : {},
            })
          }}
        />
      )}

      <CanvasOperationParameterControls
        variant="panel"
        models={[]}
        modelValue=""
        showModelPicker={false}
        fields={fields}
        values={values}
        onModelChange={() => undefined}
        onParameterChange={(name, value) => {
          const field = fields.find((candidate) => candidate.name === name)
          const parsedValue = field
            ? buildModelParams([field], { [name]: value })[name]
            : value
          onPatch({
            touched: [`modelParams.${name}`],
            values: { modelParams: { [name]: parsedValue } },
          })
        }}
      />

      {extraParamNames.length > 0 && (
        <div className="canvas-batch-task-extra-params">
          <h4>其他参数</h4>
          {extraParamNames.map((name) => (
            <label key={name}>
              <span>{name}</span>
              <Input
                value={commonValue(
                  entries,
                  (entry) => entry.draft.modelParams?.[name],
                )}
                placeholder="多个值或未设置"
                onChange={(event) =>
                  onPatch({
                    touched: [`modelParams.${name}`],
                    values: { modelParams: { [name]: event.target.value } },
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfirmView({
  entries,
  skip,
  skipParameterValidation,
  validationWarnings,
  onSkipChange,
  onSkipParameterValidationChange,
  onBack,
  onConfirm,
}: {
  entries: CanvasBatchTaskEntry[]
  skip: boolean
  skipParameterValidation: boolean
  validationWarnings: CanvasBatchTaskState['validationWarnings']
  onSkipChange: (skip: boolean) => void
  onSkipParameterValidationChange: (skip: boolean) => void
  onBack: () => void
  onConfirm: () => Promise<void>
}) {
  const groups = groupEntries(entries)
  return (
    <div className="canvas-batch-confirm">
      <div className="canvas-batch-confirm-stats">
        <div><small>任务</small><strong>{entries.length} 个</strong></div>
        <div><small>类型</small><strong>{groups.size} 种</strong></div>
        <div className={validationWarnings.length > 0 ? 'has-warning' : 'is-valid'}>
          <small>校验</small>
          <strong>{validationWarnings.length > 0 ? `${validationWarnings.length} 个提醒` : '全部通过'}</strong>
        </div>
      </div>
      <div className="canvas-batch-confirm-list">
        {[...groups.entries()].map(([operation, operationEntries]) => (
          <div key={operation}>
            <div>
              <strong>{operationLabel(operation)} · {operationEntries.length}</strong>
              <span>{commonValue(operationEntries, (entry) => entry.draft.modelId) || '自动选择模型'}</span>
            </div>
            <p>{operationEntries.map((entry) => entry.title).join('、')}</p>
          </div>
        ))}
      </div>
      {validationWarnings.length > 0 && (
        <div className="canvas-batch-confirm-warnings" role="alert">
          <strong>以下参数问题不会阻止提交，但可能导致供应商拒绝任务：</strong>
          {validationWarnings.map((warning, index) => (
            <div key={`${warning.nodeId}-${warning.fieldPath.join('.')}-${index}`}>
              <span>{warning.nodeId}</span>
              <p>{warning.message}</p>
            </div>
          ))}
        </div>
      )}
      <div className="canvas-batch-confirm-preference">
        <Checkbox
          checked={skip}
          onChange={(event) => onSkipChange(event.target.checked)}
        >
          下次不再确认，校验通过后直接提交
        </Checkbox>
        <p>该偏好对当前用户的所有项目生效，可在设置中恢复。</p>
      </div>
      {validationWarnings.length > 0 && (
        <div className="canvas-batch-confirm-parameter-preference">
          <Checkbox
            checked={skipParameterValidation}
            onChange={(event) => onSkipParameterValidationChange(event.target.checked)}
          >
            下次不再提醒参数校验问题
          </Checkbox>
        </div>
      )}
      <footer>
        <Button type="text" onClick={onBack}>返回修改</Button>
        <Button type="primary" onClick={() => void onConfirm()}>
          确认提交 {entries.length} 个任务
        </Button>
      </footer>
    </div>
  )
}

function ResultView({
  entries,
  results,
  onRetryFailed,
  onClose,
}: {
  entries: CanvasBatchTaskEntry[]
  results: CanvasBatchSubmitResult[]
  onRetryFailed: () => Promise<void>
  onClose: () => void
}) {
  const succeeded = results.filter((result) => result.status === 'succeeded').length
  const failed = results.length - succeeded
  const titleByNodeId = new Map(entries.map((entry) => [entry.nodeId, entry.title]))
  return (
    <div className="canvas-batch-result">
      <div className="canvas-batch-result-summary" aria-live="polite">
        <Icons.Check size={18} />
        <strong>{succeeded} 个提交成功</strong>
        {failed > 0 && <span>{failed} 个失败</span>}
      </div>
      <div className="canvas-batch-result-list">
        {results.map((result) => (
          <div key={result.nodeId} className={result.status === 'failed' ? 'has-error' : ''}>
            <span>{titleByNodeId.get(result.nodeId) ?? result.nodeId}</span>
            <strong>{result.status === 'succeeded' ? '已提交' : result.error}</strong>
          </div>
        ))}
      </div>
      <footer>
        {failed > 0 && (
          <Button type="primary" onClick={() => void onRetryFailed()}>
            仅重试失败节点
          </Button>
        )}
        <Button type="text" onClick={onClose}>关闭</Button>
      </footer>
    </div>
  )
}

function StatusCounts({
  entries,
  state,
}: {
  entries: CanvasBatchTaskEntry[]
  state: CanvasBatchTaskState
}) {
  const invalidIds = new Set(state.issues.map((issue) => issue.nodeId))
  return (
    <span>
      {entries.length - invalidIds.size} 就绪 · {invalidIds.size} 异常
    </span>
  )
}

function groupEntries(
  entries: CanvasBatchTaskEntry[],
): Map<CanvasOperationType, CanvasBatchTaskEntry[]> {
  const result = new Map<CanvasOperationType, CanvasBatchTaskEntry[]>()
  for (const entry of entries) {
    const group = result.get(entry.operation) ?? []
    group.push(entry)
    result.set(entry.operation, group)
  }
  return result
}

function sortEntriesByIssues(
  entries: CanvasBatchTaskEntry[],
  issueCountByNodeId: Map<string, number>,
): CanvasBatchTaskEntry[] {
  return [...entries].sort(
    (left, right) =>
      (issueCountByNodeId.get(right.nodeId) ?? 0) -
      (issueCountByNodeId.get(left.nodeId) ?? 0),
  )
}

function countIssuesByNodeId(
  issues: CanvasBatchTaskState['issues'],
): Map<string, number> {
  const result = new Map<string, number>()
  for (const issue of issues) {
    result.set(issue.nodeId, (result.get(issue.nodeId) ?? 0) + 1)
  }
  return result
}

function commonValue(
  entries: CanvasBatchTaskEntry[],
  read: (entry: CanvasBatchTaskEntry) => unknown,
): string {
  if (entries.length === 0) return ''
  const values = entries.map(read)
  const first = values[0]
  return values.every((value) => Object.is(value, first)) && first != null
    ? String(first)
    : ''
}

function commonRuntimeIdentity(entries: CanvasBatchTaskEntry[]): CanvasBatchEditableData {
  const first = entries[0]?.draft
  if (
    !first ||
    !entries.every(
      (entry) =>
        entry.draft.providerProfileId === first.providerProfileId &&
        entry.draft.manifestId === first.manifestId &&
        entry.draft.modelId === first.modelId,
    )
  ) {
    return {}
  }
  return {
    ...(first.providerProfileId !== undefined
      ? { providerProfileId: first.providerProfileId }
      : {}),
    ...(first.manifestId !== undefined ? { manifestId: first.manifestId } : {}),
    ...(first.modelId !== undefined ? { modelId: first.modelId } : {}),
  }
}
