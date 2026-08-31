/**
 * ProviderModelCatalog — 对话模型「候选模型目录 + 已启用模型」面板
 *
 * 设计要点
 * ─────────
 * - 候选模型目录：antd Select multiple 下拉（可搜索、可粘贴逗号分隔批量勾选），
 *   勾选即进入已启用列表；默认模型在下拉与列表中均有标识，且不可被移除。
 * - 已启用模型：行式列表替代 chip——左侧圆点 radio 显式切换默认模型，
 *   右侧 ✕ 显式移除；底部输入行添加自定义模型 ID。
 * - 状态全部由父级持有，组件只做展示与回调（onToggleCatalogModel /
 *   onChangeModelIds / onSelectDefault），定时禁用等联动清理由父级统一处理。
 */
import { useMemo, useState, useCallback, type KeyboardEvent } from 'react'
import { Select } from 'antd'
import { Icons } from '../Icons'
import './ProviderModelCatalog.less'

type ProviderModelCatalogProps = {
  /** 渠道 /models 获取到的候选模型（下拉数据源；为空时隐藏候选目录块） */
  catalogModelIds: string[]
  /** 已启用模型列表（含默认模型，默认模型排在首位） */
  modelIds: string[]
  /** 默认模型 ID */
  defaultModel: string
  /** 处于定时禁用时段内的模型数量（仅用于提示文案） */
  scheduledBlockedCount?: number
  /** 整体禁用（保存 / 测试中） */
  disabled?: boolean
  /** 目录勾选变化：checked=true 启用 / false 移除（父级保证默认模型不可移除的兜底） */
  onToggleCatalogModel: (modelId: string, checked: boolean) => void
  /** 整体设置已启用列表（移除 / 添加自定义模型 / 只选默认）；父级负责 modelSchedules 联动清理 */
  onChangeModelIds: (next: string[]) => void
  /** 切换默认模型 */
  onSelectDefault: (modelId: string) => void
}

export function ProviderModelCatalog({
  catalogModelIds,
  modelIds,
  defaultModel,
  scheduledBlockedCount = 0,
  disabled = false,
  onToggleCatalogModel,
  onChangeModelIds,
  onSelectDefault,
}: ProviderModelCatalogProps) {
  const [draft, setDraft] = useState('')

  const defaultId = defaultModel.trim()
  const catalogSet = useMemo(() => new Set(catalogModelIds), [catalogModelIds])
  // 下拉的受控 value：只含「来自候选目录」的已启用模型，手动添加的不进下拉。
  const selectedFromCatalog = useMemo(
    () => modelIds.filter((id) => catalogSet.has(id)),
    [modelIds, catalogSet],
  )
  const selectedSet = useMemo(() => new Set(selectedFromCatalog), [selectedFromCatalog])

  const catalogOptions = useMemo(
    () =>
      catalogModelIds.map((id) => ({
        value: id,
        // 纯字符串 label 保留 antd 默认搜索行为；optionFilterProp 按 value（模型 ID）过滤。
        label: id,
      })),
    [catalogModelIds],
  )

  const handleCatalogChange = useCallback(
    (next: string[]) => {
      // 默认模型不可通过下拉 tag × / allowClear 移除：受控 value 直接修正回填。
      const fixed =
        defaultId && selectedSet.has(defaultId) && !next.includes(defaultId)
          ? [defaultId, ...next.filter((id) => id !== defaultId)]
          : next
      const nextSet = new Set(fixed)
      // 与逐个 toggle 保持一致的增量回调，父级的顺序 / 去重 / 定时禁用联动逻辑不变。
      for (const id of selectedFromCatalog) {
        if (!nextSet.has(id)) onToggleCatalogModel(id, false)
      }
      for (const id of fixed) {
        if (!selectedSet.has(id)) onToggleCatalogModel(id, true)
      }
    },
    [defaultId, onToggleCatalogModel, selectedFromCatalog, selectedSet],
  )

  const tryAddCustomModel = useCallback(() => {
    const trimmed = draft.trim()
    if (!trimmed || modelIds.includes(trimmed)) return
    onChangeModelIds([...modelIds, trimmed])
    setDraft('')
  }, [draft, modelIds, onChangeModelIds])

  const handleAddKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        tryAddCustomModel()
      }
    },
    [tryAddCustomModel],
  )

  const othersCount = modelIds.filter((m) => m !== defaultId).length
  const canResetToDefault = !!defaultId && othersCount > 0

  return (
    <div className="pmc_catalog">
      {catalogModelIds.length > 0 && (
        <div className="pmc_block">
          <div className="pmc_head">
            <div className="pmc_head_main">
              <span className="pmc_title">候选模型目录</span>
              <span className="pmc_hint">勾选即启用，支持粘贴批量勾选</span>
            </div>
          </div>
          <Select
            mode="multiple"
            size="middle"
            style={{ width: '100%' }}
            placeholder="搜索并勾选模型"
            value={selectedFromCatalog}
            onChange={handleCatalogChange}
            options={catalogOptions}
            optionFilterProp="value"
            tokenSeparators={[',', '，']}
            maxTagCount="responsive"
            disabled={disabled}
            optionRender={(option) => {
              const id = String(option.value)
              return (
                <span className="pmc_option">
                  <span className="pmc_option_label">{id}</span>
                  {id === defaultId && <span className="pmc_option_badge">默认</span>}
                </span>
              )
            }}
          />
        </div>
      )}

      <div className="pmc_block">
        <div className="pmc_head">
          <div className="pmc_head_main">
            <span className="pmc_title">已启用模型（全局可用）</span>
            <span className="pmc_hint">
              {scheduledBlockedCount > 0
                ? `圆点设为默认，✕ 移除；${scheduledBlockedCount} 个模型处于定时禁用时段`
                : '圆点设为默认，✕ 移除'}
            </span>
          </div>
          <button
            type="button"
            className="pmc_section_action"
            disabled={!canResetToDefault}
            title={
              canResetToDefault
                ? `取消其余 ${othersCount} 个模型的启用状态，仅保留默认模型「${defaultId}」`
                : defaultId
                  ? '当前没有其他已启用模型'
                  : '请先指定默认模型'
            }
            onClick={() => {
              if (defaultId) onChangeModelIds([defaultId])
            }}
          >
            <Icons.Check size={11} />
            <span>只选默认</span>
          </button>
        </div>

        <div className="pmc_model_list" role="radiogroup" aria-label="默认模型选择">
          {modelIds.length === 0 ? (
            <div className="pmc_empty">尚未添加任何模型（默认模型会自动加入）</div>
          ) : (
            modelIds.map((id) => {
              const isDefault = id === defaultId
              return (
                <div key={id} className={`pmc_model_row${isDefault ? ' is-default' : ''}`}>
                  <button
                    type="button"
                    className="pmc_default_radio"
                    role="radio"
                    aria-checked={isDefault}
                    disabled={isDefault || disabled}
                    title={isDefault ? `${id}（当前默认模型）` : `将「${id}」设为默认模型`}
                    onClick={() => onSelectDefault(id)}
                  >
                    <span className="pmc_radio_dot" aria-hidden />
                  </button>
                  <span className="pmc_model_id" title={id}>
                    {id}
                  </span>
                  {isDefault ? (
                    <span className="pmc_default_badge">默认</span>
                  ) : (
                    <button
                      type="button"
                      className="pmc_model_remove"
                      disabled={disabled}
                      title={`移除 ${id}`}
                      aria-label={`移除 ${id}`}
                      onClick={() => onChangeModelIds(modelIds.filter((m) => m !== id))}
                    >
                      <Icons.X size={12} />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="pmc_add_row">
          <Icons.Plus size={13} className="pmc_add_icon" />
          <input
            type="text"
            className="pmc_add_input"
            value={draft}
            placeholder="自定义模型 ID"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleAddKeyDown}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="pmc_add_button"
            disabled={disabled || draft.trim() === ''}
            onClick={tryAddCustomModel}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProviderModelCatalog
