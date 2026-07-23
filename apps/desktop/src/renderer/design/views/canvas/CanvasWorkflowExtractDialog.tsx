import { useEffect, useRef, useState } from 'react'
import type { CanvasWorkflowDefinition, CanvasWorkflowExposedParam } from '@spark/protocol'
import { Icons } from '../../Icons'
import { canvasWorkflowApi } from './canvasWorkflow.api'
import type { CanvasWorkflowDraft } from './canvasWorkflowExtraction'
import { enhanceCanvasWorkflowDraftWithAi } from './canvasWorkflowAiEnhancement'
import { useCanvasWorkflowDialogFocus } from './useCanvasWorkflowDialogFocus'

export function CanvasWorkflowExtractDialog({
  open,
  projectId,
  draft,
  workflowToUpdate = null,
  onClose,
  onSaved,
}: {
  open: boolean
  projectId: string
  draft: CanvasWorkflowDraft | null
  workflowToUpdate?: CanvasWorkflowDefinition | null
  onClose: () => void
  onSaved: (workflow: CanvasWorkflowDefinition) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [inputNames, setInputNames] = useState<string[]>([])
  const [outputNames, setOutputNames] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [exposedParams, setExposedParams] = useState<CanvasWorkflowExposedParam[]>([])
  const [saving, setSaving] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [enhanced, setEnhanced] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  useCanvasWorkflowDialogFocus(dialogRef, open)

  useEffect(() => {
    if (!open || !draft) return
    setName(workflowToUpdate?.name ?? draft.name)
    setDescription(workflowToUpdate?.description ?? draft.description)
    setInputNames(draft.package.contract.inputs.map((input) => input.name))
    setOutputNames(draft.package.contract.outputs.map((output) => output.name))
    setTags(draft.tags)
    setExposedParams(draft.package.contract.exposedParams)
    setEnhanced(false)
    setError('')
  }, [draft, open, workflowToUpdate])

  if (!open || !draft) return null

  const enhanceWithAi = async () => {
    setEnhancing(true)
    setError('')
    try {
      const currentDraft: CanvasWorkflowDraft = {
        ...draft,
        name: name.trim() || draft.name,
        description: description.trim() || draft.description,
        tags,
        package: {
          ...draft.package,
          contract: {
            ...draft.package.contract,
            inputs: draft.package.contract.inputs.map((input, index) => ({
              ...input,
              name: inputNames[index]?.trim() || input.name,
            })),
            outputs: draft.package.contract.outputs.map((output, index) => ({
              ...output,
              name: outputNames[index]?.trim() || output.name,
            })),
            exposedParams,
          },
        },
      }
      const result = await enhanceCanvasWorkflowDraftWithAi(currentDraft, async (prompt) => {
        const response = await window.spark.invoke('canvas:task:generate-text', {
          operation: 'text_generate',
          prompt,
          modelParams: { responseFormat: 'json', maxTokens: 2_000, temperature: 0.2 },
        })
        if (response.status !== 'succeeded' || !response.text.trim()) {
          throw new Error(response.error?.message ?? 'AI 语义增强失败')
        }
        return response.text
      })
      setName(result.name)
      setDescription(result.description)
      setTags(result.tags)
      setInputNames(result.package.contract.inputs.map((input) => input.name))
      setOutputNames(result.package.contract.outputs.map((output) => output.name))
      setExposedParams(result.package.contract.exposedParams)
      setEnhanced(true)
    } catch (enhanceError) {
      setError(
        `${enhanceError instanceof Error ? enhanceError.message : 'AI 语义增强失败'}。规则草稿未被覆盖，可继续手工保存。`,
      )
    } finally {
      setEnhancing(false)
    }
  }

  const save = async () => {
    const workflowName = name.trim()
    if (!workflowName) return
    setSaving(true)
    setError('')
    try {
      const packageJson = {
        ...draft.package,
        contract: {
          ...draft.package.contract,
          inputs: draft.package.contract.inputs.map((input, index) => ({
            ...input,
            name: inputNames[index]?.trim() || input.name,
          })),
          outputs: draft.package.contract.outputs.map((output, index) => ({
            ...output,
            name: outputNames[index]?.trim() || output.name,
          })),
          exposedParams,
        },
      }
      const workflow = workflowToUpdate
        ? await canvasWorkflowApi.update({
            id: workflowToUpdate.id,
            name: workflowName,
            description: description.trim() || null,
            tags,
            package: packageJson,
          })
        : await canvasWorkflowApi.create({
            name: workflowName,
            description: description.trim() || null,
            scope: 'project',
            projectId,
            tags,
            package: packageJson,
          })
      onSaved(workflow)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存画布工作流失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="canvas-workflow-extract-backdrop">
      <section
        ref={dialogRef}
        className="canvas-workflow-extract-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-workflow-extract-title"
      >
        <header>
          <div>
            <span>SELECTION TO WORKFLOW</span>
            <h2 id="canvas-workflow-extract-title">
              {workflowToUpdate ? '更新画布工作流' : '提取为画布工作流'}
            </h2>
            <p>
              {workflowToUpdate
                ? '确认当前选区拓扑后保存为新的草稿版本。'
                : '确认规则分析出的拓扑和输入输出后保存项目草稿。'}
            </p>
          </div>
          <button data-dialog-initial-focus type="button" aria-label="关闭提取工作流对话框" onClick={onClose}>
            <Icons.X size={16} />
          </button>
        </header>

        {error && (
          <div className="canvas-workflow-extract-error" role="alert">
            {error}
          </div>
        )}

        <div className="canvas-workflow-extract-body">
          <section className="canvas-workflow-extract-facts" aria-label="选区拓扑分析">
            <div className="canvas-workflow-extract-section-title">
              <Icons.GitBranch size={15} />
              <div>
                <h3>结构事实</h3>
                <p>来自当前画布，不由模型改写。</p>
              </div>
            </div>
            <button
              type="button"
              className="canvas-workflow-ai-enhance-button"
              disabled={enhancing || saving}
              onClick={() => void enhanceWithAi()}
            >
              <Icons.Sparkles size={14} />
              {enhancing ? 'AI 分析中…' : enhanced ? '重新进行 AI 语义增强' : 'AI 语义增强'}
            </button>
            <dl>
              <div>
                <dt>来源</dt>
                <dd>
                  {draft.package.provenance?.sourceNodeIds?.length ??
                    draft.package.graph.nodes.length}{' '}
                  个来源节点
                </dd>
              </div>
              <div>
                <dt>拓扑</dt>
                <dd>{draft.package.graph.edges.length} 条内部连线</dd>
              </div>
              <div>
                <dt>输入</dt>
                <dd>{draft.package.contract.inputs.length} 个输入槽</dd>
              </div>
              <div>
                <dt>输出</dt>
                <dd>{draft.package.contract.outputs.length} 个输出槽</dd>
              </div>
            </dl>
            <div className="canvas-workflow-extract-node-list">
              {draft.package.graph.nodes.map((node, index) => (
                <div key={node.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{node.label}</strong>
                  <small>{node.kind.replace('canvas_', '')}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="canvas-workflow-extract-contract" aria-label="工作流草稿设置">
            <label>
              工作流名称
              <input
                aria-label="提取工作流名称"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              说明
              <textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <div className="canvas-workflow-extract-contract-group">
              <h3>输入契约</h3>
              {draft.package.contract.inputs.length > 0 ? (
                draft.package.contract.inputs.map((input, index) => (
                  <label key={input.id}>
                    <span>{input.valueType}</span>
                    <input
                      aria-label={`输入名称 ${index + 1}`}
                      value={inputNames[index] ?? ''}
                      onChange={(event) =>
                        setInputNames((current) =>
                          current.map((value, itemIndex) =>
                            itemIndex === index ? event.target.value : value,
                          ),
                        )
                      }
                    />
                  </label>
                ))
              ) : (
                <p>当前选区没有识别到外部输入。</p>
              )}
            </div>

            {exposedParams.length > 0 && (
              <div className="canvas-workflow-extract-contract-group">
                <h3>暴露参数</h3>
                {exposedParams.map((param) => (
                  <p key={param.id}>
                    {param.name} · {param.valueType} · {param.path}
                  </p>
                ))}
              </div>
            )}

            <div className="canvas-workflow-extract-contract-group">
              <h3>输出契约</h3>
              {draft.package.contract.outputs.length > 0 ? (
                draft.package.contract.outputs.map((output, index) => (
                  <label key={output.id}>
                    <span>{output.valueType}</span>
                    <input
                      aria-label={`输出名称 ${index + 1}`}
                      value={outputNames[index] ?? ''}
                      onChange={(event) =>
                        setOutputNames((current) =>
                          current.map((value, itemIndex) =>
                            itemIndex === index ? event.target.value : value,
                          ),
                        )
                      }
                    />
                  </label>
                ))
              ) : (
                <p>当前选区没有识别到输出节点。</p>
              )}
            </div>
          </section>
        </div>

        <footer>
          <span>
            <Icons.HelpCircle size={14} /> 保存不会删除或替换源节点
          </span>
          <div>
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="is-primary"
              aria-label={workflowToUpdate ? '更新选中的画布工作流' : '保存提取的画布工作流'}
              disabled={saving || !name.trim()}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : workflowToUpdate ? '保存新版本' : '保存项目草稿'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
