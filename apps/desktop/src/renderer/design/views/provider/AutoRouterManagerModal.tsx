import { useEffect, useMemo, useState } from 'react'
import { Alert, Switch } from 'antd'
import { Button, Input, Modal, Select } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import {
  AUTO_ROUTER_PROVIDER_TYPE,
  type AutoRouterConfig,
  type AutoRouterExecutorRef,
  type ProviderAutoRouterTestDispatcherResponse,
  type ProviderProfile,
  type RouterAdapter,
  type RouterIntensity,
  type SessionReasoningEffort,
  createDefaultAutoRouterConfig,
  isProviderAllowedForAutoRouter,
} from '@spark/protocol'

/**
 * AutoRouter 管理弹层（重构版）：router = provider_profiles 中 provider_type='auto-router'
 * 的真实落库行。左侧 router 列表，右侧编辑表单（分流器 + 三强度执行模型 + 高级项）。
 * 保存走 provider:auto-router:create / update；删除复用 provider:delete。
 */

interface AutoRouterManagerModalProps {
  open: boolean
  providers: ProviderProfile[]
  onClose: () => void
  onChanged: () => void
  /**
   * 外部指定打开时聚焦的 router（渠道卡片「编辑」入口）。
   * 为 null / 不在列表中时按既有逻辑（恢复上次选中或进入新建态）。
   */
  focusRouterId?: string | null
}

const INTENSITY_OPTIONS: Array<{ value: RouterIntensity; label: string; badgeClass: string }> = [
  { value: 'high', label: '高', badgeClass: 'badge dot danger' },
  { value: 'balanced', label: '平衡', badgeClass: 'badge dot success' },
  { value: 'low', label: '低', badgeClass: 'badge dot info' },
]

const ADAPTER_OPTIONS: Array<{ value: RouterAdapter; label: string }> = [
  { value: 'claude', label: 'Claude 引擎（Anthropic 渠道）' },
  { value: 'codex', label: 'Codex 引擎（OpenAI 系渠道）' },
]

/**
 * 执行器推理强度选项（模型思考深度；与条目的"任务强度档位"是两回事）。
 * 哨兵空串 = 跟随会话/Agent 既有配置（不写 reasoningEffort 字段）。
 */
const REASONING_EFFORT_FOLLOW = ''

const REASONING_EFFORT_OPTIONS: Array<{ value: SessionReasoningEffort; label: string }> = [
  { value: 'minimal', label: 'minimal · 最少推理' },
  { value: 'low', label: 'low · 快速省资源' },
  { value: 'medium', label: 'medium · 标准速度' },
  { value: 'high', label: 'high · 更强推理' },
  { value: 'xhigh', label: 'xhigh · 深度推理' },
  { value: 'max', label: 'max · 极限推理' },
]

function intensityBadgeClass(intensity: RouterIntensity): string {
  return INTENSITY_OPTIONS.find((option) => option.value === intensity)?.badgeClass ?? 'badge dot'
}

function providerModels(provider: ProviderProfile): string[] {
  const ids = provider.modelIds.length > 0 ? provider.modelIds : [provider.defaultModel]
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))]
}

export function AutoRouterManagerModal({
  open,
  providers,
  onClose,
  onChanged,
  focusRouterId = null,
}: AutoRouterManagerModalProps) {
  const { toast } = useToast()
  const { invoke: createRouter } = useIpcInvoke('provider:auto-router:create')
  const { invoke: updateRouter } = useIpcInvoke('provider:auto-router:update')
  const { invoke: deleteProvider } = useIpcInvoke('provider:delete')
  const { invoke: testDispatcherInvoke } = useIpcInvoke('provider:auto-router:test-dispatcher')

  const routers = useMemo(
    () => providers.filter((provider) => provider.providerType === AUTO_ROUTER_PROVIDER_TYPE),
    [providers],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AutoRouterConfig>(() =>
    createDefaultAutoRouterConfig('claude'),
  )
  const [routerName, setRouterName] = useState('')
  const [routerEnabled, setRouterEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  // 分流器连通性测试：testing 进行中；result 为 null 表示未测/已改动作废
  const [dispatcherTesting, setDispatcherTesting] = useState(false)
  const [dispatcherTestResult, setDispatcherTestResult] =
    useState<ProviderAutoRouterTestDispatcherResponse | null>(null)

  // 打开时优先聚焦外部指定的 router（卡片编辑入口）；否则默认选中第一个，
  // 列表为空进入新建态
  useEffect(() => {
    if (!open) return
    const focused =
      focusRouterId != null ? routers.find((router) => router.id === focusRouterId) : undefined
    if (focused != null) {
      // 与当前选中不同才重置表单，避免 effect 重跑时覆盖用户正在编辑的草稿
      if (selectedId !== focused.id) selectRouter(focused)
      return
    }
    if (selectedId == null || !routers.some((router) => router.id === selectedId)) {
      const first = routers[0]
      if (first != null) selectRouter(first)
      else startCreate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, routers, focusRouterId])

  function selectRouter(provider: ProviderProfile): void {
    setSelectedId(provider.id)
    setRouterName(provider.name)
    setRouterEnabled(provider.enabled !== false)
    const config = provider.autoRouterConfig
    setDraft(
      config != null
        ? { ...config, executors: config.executors.map((entry) => ({ ...entry })) }
        : createDefaultAutoRouterConfig('claude'),
    )
    setValidationError(null)
  }

  function startCreate(): void {
    setSelectedId(null)
    setRouterName('')
    setRouterEnabled(true)
    setDraft(createDefaultAutoRouterConfig('claude'))
    setValidationError(null)
  }

  // 分流器 / 执行器候选渠道：按引擎过滤的启用文本渠道
  const candidateProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.providerType !== AUTO_ROUTER_PROVIDER_TYPE &&
          provider.enabled !== false &&
          isProviderAllowedForAutoRouter(draft.adapter, provider),
      ),
    [providers, draft.adapter],
  )

  const providerById = useMemo(
    () => new Map(candidateProviders.map((provider) => [provider.id, provider])),
    [candidateProviders],
  )

  const providerOptions = useMemo(
    () =>
      candidateProviders.map((provider) => ({
        label: provider.name,
        value: provider.id,
      })),
    [candidateProviders],
  )

  const dispatcherModelOptions = useMemo(() => {
    const provider = providerById.get(draft.dispatcher.providerProfileId)
    return (provider ? providerModels(provider) : []).map((modelId) => ({
      label: modelId,
      value: modelId,
    }))
  }, [providerById, draft.dispatcher.providerProfileId])

  function modelsForExecutor(
    executor: AutoRouterExecutorRef,
  ): Array<{ label: string; value: string }> {
    const provider = providerById.get(executor.providerProfileId)
    return (provider ? providerModels(provider) : []).map((modelId) => ({
      label: modelId,
      value: modelId,
    }))
  }

  function patchConfig(patch: Partial<AutoRouterConfig>): void {
    setDraft((prev) => ({ ...prev, ...patch }))
    // 配置变更后旧测试结果失效
    setDispatcherTestResult(null)
  }

  /** 分流器连通性测试：对当前草稿（无需保存）的分流器渠道发最小请求。 */
  async function runDispatcherTest(): Promise<void> {
    if (
      dispatcherTesting ||
      draft.dispatcher.providerProfileId.length === 0 ||
      draft.dispatcher.modelId.length === 0
    ) {
      return
    }
    setDispatcherTesting(true)
    setDispatcherTestResult(null)
    try {
      const result = await testDispatcherInvoke({ dispatcher: draft.dispatcher })
      setDispatcherTestResult(result)
    } catch (err) {
      setDispatcherTestResult({
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setDispatcherTesting(false)
    }
  }

  function patchExecutor(entryId: string, patch: Partial<AutoRouterExecutorRef>): void {
    setDraft((prev) => ({
      ...prev,
      executors: prev.executors.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry,
      ),
    }))
  }

  function addExecutor(): void {
    setDraft((prev) => ({
      ...prev,
      executors: [
        ...prev.executors,
        {
          id: `e-${Date.now().toString(36)}-${prev.executors.length}`,
          providerProfileId: '',
          modelId: '',
          intensity: 'balanced',
          enabled: true,
        },
      ],
    }))
  }

  function removeExecutor(entryId: string): void {
    setDraft((prev) => ({
      ...prev,
      executors: prev.executors.filter((entry) => entry.id !== entryId),
    }))
  }

  function validate(): string | null {
    if (routerName.trim().length === 0) return '请填写路由器名称'
    if (draft.dispatcher.providerProfileId.length === 0 || draft.dispatcher.modelId.length === 0) {
      return '请选择分流器模型（负责分析任务强度）'
    }
    const enabled = draft.executors.filter((entry) => entry.enabled)
    if (enabled.length === 0) return '至少需要一个启用的执行模型'
    if (enabled.some((entry) => !entry.providerProfileId || !entry.modelId)) {
      return '执行模型存在未选择渠道或模型的条目，请补全或删除'
    }
    return null
  }

  async function handleSave(): Promise<void> {
    const error = validate()
    if (error != null) {
      setValidationError(error)
      return
    }
    setSaving(true)
    try {
      if (selectedId != null) {
        await updateRouter({
          id: selectedId,
          name: routerName.trim(),
          config: draft,
          enabled: routerEnabled,
        })
        toast.success('路由器已更新')
      } else {
        await createRouter({ name: routerName.trim(), config: draft, enabled: routerEnabled })
        toast.success('路由器已创建')
      }
      setValidationError(null)
      onChanged()
      // 保存 / 创建成功即视为本轮编辑完成，直接关闭弹窗回到渠道列表
      onClose()
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (selectedId == null) return
    if (!window.confirm(`删除路由器「${routerName}」？此操作不可撤销。`)) return
    setSaving(true)
    try {
      await deleteProvider({ id: selectedId })
      toast.success('路由器已删除')
      setSelectedId(null)
      onChanged()
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={
        <div className="pv_catalog_title">
          <Icons.Shuffle size={16} />
          <span>自动路由管理</span>
        </div>
      }
      footer={
        <div className="arm_footer">
          {selectedId != null && (
            <Button size="small" type="default" loading={saving} onClick={handleDelete}>
              删除
            </Button>
          )}
          <div className="arm_footer_spacer" />
          <Button size="small" onClick={onClose}>
            取消
          </Button>
          <Button size="small" type="primary" loading={saving} onClick={handleSave}>
            {selectedId != null ? '保存' : '创建'}
          </Button>
        </div>
      }
      // 动态宽度：小窗跟随视口收缩、大窗封顶 1240px；下限由 .arm_modal 的
      // min-width 保证（执行模型一行 7 列控件需要足够横向空间）。
      width="min(1240px, 94vw)"
      className="arm_modal"
      onCancel={onClose}
    >
      <div className="arm_layout">
        <div className="arm_sidebar">
          <div className="arm_sidebar_header">
            <span>路由器</span>
            <Button size="small" icon={<Icons.Plus size={14} />} onClick={startCreate}>
              新建
            </Button>
          </div>
          <div className="arm_router_list">
            {routers.length === 0 && (
              <div className="arm_empty">还没有路由器，点击「新建」创建</div>
            )}
            {routers.map((router) => (
              <button
                key={router.id}
                type="button"
                className={`arm_router_item${selectedId === router.id ? ' active' : ''}`}
                onClick={() => selectRouter(router)}
              >
                <span className="arm_router_name">{router.name}</span>
                <span className="arm_router_meta">
                  <span className="badge">{router.autoRouterConfig?.adapter ?? '—'}</span>
                  {router.autoRouterConfig != null && (
                    <span className="badge dot">
                      {router.autoRouterConfig.executors.filter((entry) => entry.enabled).length}{' '}
                      执行模型
                    </span>
                  )}
                  {router.enabled === false && <span className="badge warning">已停用</span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="arm_editor">
          {validationError != null && <Alert type="error" showIcon message={validationError} />}
          <div className="arm_section">
            <div className="arm_section_title">基础</div>
            <div className="arm_form_grid">
              <label className="arm_form_label">名称</label>
              <Input
                value={routerName}
                placeholder="例如：日常分流路由"
                onChange={(e) => setRouterName(e.target.value)}
              />
              <label className="arm_form_label">引擎</label>
              <Select
                value={draft.adapter}
                options={ADAPTER_OPTIONS}
                onChange={(value) => patchConfig({ adapter: value as RouterAdapter })}
              />
              <label className="arm_form_label">启用</label>
              <Switch size="small" checked={routerEnabled} onChange={setRouterEnabled} />
            </div>
          </div>

          <div className="arm_section">
            <div className="arm_section_title arm_section_title_with_action">
              <span>分流器模型</span>
              <Button
                size="small"
                disabled={
                  dispatcherTesting ||
                  draft.dispatcher.providerProfileId.length === 0 ||
                  draft.dispatcher.modelId.length === 0
                }
                onClick={() => {
                  void runDispatcherTest()
                }}
              >
                {dispatcherTesting ? '测试中…' : '测试分流器'}
              </Button>
            </div>
            {dispatcherTestResult != null && (
              <Alert
                type={dispatcherTestResult.ok ? 'success' : 'error'}
                showIcon
                message={
                  dispatcherTestResult.ok
                    ? `连通正常 · ${Math.round(dispatcherTestResult.latencyMs)}ms`
                    : `分流器不可用：${dispatcherTestResult.error}`
                }
              />
            )}
            <div className="arm_form_grid">
              <label className="arm_form_label">渠道</label>
              <Select
                value={draft.dispatcher.providerProfileId || undefined}
                placeholder="选择渠道"
                options={providerOptions}
                popupMatchSelectWidth={false}
                onChange={(value) =>
                  patchConfig({
                    dispatcher: { ...draft.dispatcher, providerProfileId: value, modelId: '' },
                  })
                }
              />
              <label className="arm_form_label">模型</label>
              <Select
                value={draft.dispatcher.modelId || undefined}
                placeholder="建议选择快且便宜的小模型"
                options={dispatcherModelOptions}
                popupMatchSelectWidth={false}
                onChange={(value) =>
                  patchConfig({ dispatcher: { ...draft.dispatcher, modelId: value } })
                }
              />
              <label className="arm_form_label">决策超时 (ms)</label>
              <Input
                type="number"
                value={String(draft.dispatcher.timeoutMs)}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10)
                  patchConfig({
                    dispatcher: {
                      ...draft.dispatcher,
                      timeoutMs: Number.isFinite(parsed) && parsed > 0 ? parsed : 8_000,
                    },
                  })
                }}
              />
            </div>
          </div>

          <div className="arm_section">
            <div className="arm_section_title">执行模型（按强度）</div>
            <div className="arm_executors">
              {draft.executors.length === 0 && (
                <div className="arm_empty">
                  尚未配置执行模型；每轮任务按分流器判定的强度分派给对应档位
                </div>
              )}
              {draft.executors.map((executor) => (
                <div key={executor.id} className="arm_executor_row">
                  <span className={intensityBadgeClass(executor.intensity)}>
                    {INTENSITY_OPTIONS.find((o) => o.value === executor.intensity)?.label}
                  </span>
                  <Select
                    size="small"
                    value={executor.providerProfileId || undefined}
                    placeholder="渠道"
                    options={providerOptions}
                    popupMatchSelectWidth={false}
                    onChange={(value) =>
                      patchExecutor(executor.id, { providerProfileId: value, modelId: '' })
                    }
                  />
                  <Select
                    size="small"
                    value={executor.modelId || undefined}
                    placeholder="模型"
                    options={modelsForExecutor(executor)}
                    popupMatchSelectWidth={false}
                    onChange={(value) => patchExecutor(executor.id, { modelId: value })}
                  />
                  <Select
                    size="small"
                    value={executor.intensity}
                    options={INTENSITY_OPTIONS.map((option) => ({
                      label: option.label,
                      value: option.value,
                    }))}
                    onChange={(value) =>
                      patchExecutor(executor.id, { intensity: value as RouterIntensity })
                    }
                  />
                  <Select
                    size="small"
                    value={executor.reasoningEffort ?? REASONING_EFFORT_FOLLOW}
                    title="推理强度（模型思考深度，留空跟随会话配置）"
                    options={[
                      { label: '推理·跟随会话', value: REASONING_EFFORT_FOLLOW },
                      ...REASONING_EFFORT_OPTIONS,
                    ]}
                    popupMatchSelectWidth={false}
                    onChange={(value) =>
                      patchExecutor(executor.id, {
                        reasoningEffort:
                          value === REASONING_EFFORT_FOLLOW
                            ? null
                            : (value as SessionReasoningEffort),
                      })
                    }
                  />
                  <Switch
                    size="small"
                    checked={executor.enabled}
                    onChange={(enabled) => patchExecutor(executor.id, { enabled })}
                  />
                  <button
                    type="button"
                    className="arm_icon_btn"
                    title="删除该执行模型"
                    onClick={() => removeExecutor(executor.id)}
                  >
                    <Icons.Trash size={13} />
                  </button>
                </div>
              ))}
              <Button size="small" icon={<Icons.Plus size={14} />} onClick={addExecutor}>
                添加执行模型
              </Button>
              <div className="arm_hint">
                推理强度：执行模型的思考深度，与左侧任务强度档位无关；默认「跟随会话」，
                显式指定后经该执行模型执行的轮次以此为准（会话与 Agent 级配置被覆盖）。
              </div>
            </div>
          </div>

          <div className="arm_section">
            <div className="arm_section_title">高级</div>
            <div className="arm_form_grid">
              <label className="arm_form_label">兜底强度</label>
              <Select
                value={draft.fallbackIntensity}
                options={INTENSITY_OPTIONS.map((option) => ({
                  label: option.label,
                  value: option.value,
                }))}
                onChange={(value) => patchConfig({ fallbackIntensity: value as RouterIntensity })}
              />
              <label className="arm_form_label">允许拆分子任务</label>
              <Switch
                size="small"
                checked={draft.allowDecomposition}
                onChange={(allowDecomposition) => patchConfig({ allowDecomposition })}
              />
              <label className="arm_form_label">拆分并发上限</label>
              <Input
                type="number"
                value={String(draft.maxConcurrentSubtasks)}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10)
                  patchConfig({
                    maxConcurrentSubtasks:
                      Number.isFinite(parsed) && parsed >= 1 && parsed <= 10 ? parsed : 3,
                  })
                }}
              />
              <label className="arm_form_label">子代理档位映射</label>
              <Switch
                size="small"
                checked={draft.subagentIntensityMapping}
                onChange={(subagentIntensityMapping) => patchConfig({ subagentIntensityMapping })}
              />
            </div>
            <div className="arm_hint">
              子代理档位映射：把高/平衡/低执行模型注入引擎子代理环境变量（仅 Claude 引擎生效）， 让
              SDK 原生 Task 子代理也按强度分级。
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
