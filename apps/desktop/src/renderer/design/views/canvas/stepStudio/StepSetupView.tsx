/**
 * 步骤模式 · 第一步「设定」（步骤模式设计文档 §5.1，P4 交付）。
 *
 * 创建与管理出场资产：角色 / 场景 / 道具 / 特效。数据层完全复用 P1/P2 的
 * assetLibrary 仓储（useAssetLibrary 分页 + AssetGrid 卡片 + AssetDetailDrawer
 * 详情），新建入口为 AssetCreateModal（AI 生成 / 本地上传 / 从画布选择）。
 *
 * 状态流转（draft → confirmed）：卡片操作直接切换 metadata.attributes.confirmed
 * ——已确认资产在分镜步骤引用面板置顶（P5 消费）。存 attributes 而非独立键，
 * 与既有结构化属性读写（updateFilmAsset.attributes）同一条链路。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input, Select, message } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasAsset, CanvasSnapshot } from '../canvas.types'
import { canvasApi } from '../canvas.api'
import {
  FILM_ASSET_KIND_LABELS,
  readAssetKind,
  type CreateFilmAssetInput,
} from '../canvasFilmAssets'
import { buildFilmAssetReferencePrompt } from '../canvasWorkspaceFilm'
import { buildProductionBiblePrompt } from '../canvasPipeline'
import { CanvasOperationParameterControls } from '../CanvasOperationParameterControls'
import { CanvasTaskValidationError } from '../canvasTaskSubmissionValidation'
import { confirmCanvasTaskValidation } from '../canvasTaskValidationWarning'
import { countAssetReferences } from '../assetLibrary/assetReferences'
import {
  collectAssetGenerationStatuses,
  isAssetGenerationActive,
} from '../assetLibrary/assetGenerationStatus'
import { AssetGrid, type AssetCardAction } from '../assetLibrary/AssetGrid'
import { AssetDetailDrawer, type AssetDetailAction } from '../assetLibrary/AssetDetailDrawer'
import { useAssetLibrary, type AssetLibrarySort } from '../assetLibrary/useAssetLibrary'
import { useAssetGenerationConfig } from '../assetLibrary/useAssetGenerationConfig'
import {
  AssetCreateModal,
  SETUP_ASSET_KINDS,
  type SetupAssetKind,
} from '../assetLibrary/AssetCreateModal'
import type { CanvasMediaTaskSubmitter } from '../assetLibrary/assetCreateTypes'
import { Icons } from '../../../Icons'

export type StepSetupViewProps = Readonly<{
  projectId: string
  snapshot: CanvasSnapshot
  onCreateFilmAsset: (input: CreateFilmAssetInput) => Promise<CanvasAsset | null>
  onUploadImageAsset: (file: File) => Promise<string | null>
  onCreateMediaTask: CanvasMediaTaskSubmitter
  /** 写操作完成后刷新快照（容器层 openSnapshot） */
  refreshSnapshot: () => Promise<void>
}>

const CONFIRMED_ATTR = 'confirmed'

function readConfirmed(asset: CanvasAsset): boolean {
  const attrs = asset.metadata?.attributes
  if (!attrs || typeof attrs !== 'object') return false
  return (attrs as Record<string, unknown>)[CONFIRMED_ATTR] === 'true'
}

export function StepSetupView({
  projectId,
  snapshot,
  onCreateFilmAsset,
  onUploadImageAsset,
  onCreateMediaTask,
  refreshSnapshot,
}: StepSetupViewProps) {
  const [kind, setKind] = useState<SetupAssetKind>('character')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null)
  const [renderKey, setRenderKey] = useState(0)

  // 生成配置（模型 + 画幅/分辨率参数）顶层共享：新建弹窗与详情抽屉同一份，
  // 用户在任一处选定的模型/参数在另一处保持一致（R3）
  const generation = useAssetGenerationConfig('text_to_image')

  // snapshot 引用变化 → 列表重载（跳过首次，模式同 ProjectAssetLibrary）
  const [dataRevision, setDataRevision] = useState(0)
  const firstSnapshotRef = useRef(true)
  useEffect(() => {
    if (firstSnapshotRef.current) {
      firstSnapshotRef.current = false
      return
    }
    setDataRevision((tick) => tick + 1)
  }, [snapshot])

  const library = useAssetLibrary(projectId, {
    kind,
    pageSize: 60,
    revision: dataRevision,
  })

  // 活动画板：AI 生成任务的落点（项目活动画板优先，缺省第一块）
  const activeBoardId = useMemo(() => {
    const boards = snapshot.boards ?? []
    const metaBoardId = snapshot.project.metadata?.activeBoardId
    const fromMeta =
      typeof metaBoardId === 'string' && boards.some((board) => board.id === metaBoardId)
        ? metaBoardId
        : null
    return fromMeta ?? boards[0]?.id ?? ''
  }, [snapshot])

  const usageCounts = useMemo(() => countAssetReferences(snapshot.nodes), [snapshot.nodes])

  // 各资产最近一次生成任务状态（从快照节点反查，流式任务更新随 snapshot 传导）
  const generationStatuses = useMemo(
    () => collectAssetGenerationStatuses(snapshot.nodes),
    [snapshot.nodes],
  )
  const generatingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [assetId, status] of generationStatuses) {
      if (isAssetGenerationActive(status)) ids.add(assetId)
    }
    return ids
  }, [generationStatuses])
  const detailGenerationStatus = detailAssetId
    ? (generationStatuses.get(detailAssetId) ?? undefined)
    : undefined
  const detailGenerating = isAssetGenerationActive(detailGenerationStatus)

  // 各分类数量（卡片 Tab 角标）
  const kindCounts = useMemo(() => {
    const counts = new Map<SetupAssetKind, number>()
    for (const asset of snapshot.assets) {
      const assetKind = readAssetKind(asset)
      if (
        assetKind === 'character' ||
        assetKind === 'scene' ||
        assetKind === 'prop' ||
        assetKind === 'effect'
      ) {
        counts.set(assetKind, (counts.get(assetKind) ?? 0) + 1)
      }
    }
    return counts
  }, [snapshot.assets])

  const detailAsset = useMemo(
    () =>
      detailAssetId ? (snapshot.assets.find((item) => item.id === detailAssetId) ?? null) : null,
    [detailAssetId, snapshot.assets],
  )

  const toggleFavorite = useCallback(
    async (asset: CanvasAsset) => {
      const next = asset.metadata?.favorite !== true
      try {
        await canvasApi.setFilmAssetFavorite(projectId, asset.id, next)
        setRenderKey((key) => key + 1)
        await refreshSnapshot()
      } catch (error) {
        message.error(`操作失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [projectId, refreshSnapshot],
  )

  const toggleConfirmed = useCallback(
    async (asset: CanvasAsset) => {
      const next = !readConfirmed(asset)
      const attrs = { ...((asset.metadata?.attributes as Record<string, string>) ?? {}) }
      if (next) attrs[CONFIRMED_ATTR] = 'true'
      else delete attrs[CONFIRMED_ATTR]
      try {
        await canvasApi.updateFilmAsset(projectId, asset.id, { attributes: attrs })
        await refreshSnapshot()
      } catch (error) {
        message.error(`操作失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [projectId, refreshSnapshot],
  )

  const removeAsset = useCallback(
    async (asset: CanvasAsset) => {
      try {
        await canvasApi.batchDeleteFilmAssets(projectId, [asset.id], { hardDelete: false })
        if (detailAssetId === asset.id) setDetailAssetId(null)
        message.success(`已删除「${asset.title ?? '未命名'}」（源文件保留）`)
        await refreshSnapshot()
      } catch (error) {
        message.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [projectId, refreshSnapshot, detailAssetId],
  )

  const cardActions = useMemo<AssetCardAction[]>(
    () => [
      {
        key: 'confirm',
        icon: <Icons.Check size={14} />,
        label: '切换确认设定',
        onClick: (asset) => void toggleConfirmed(asset),
      },
      {
        key: 'favorite',
        icon: <Icons.Star size={14} />,
        label: '收藏',
        onClick: (asset) => void toggleFavorite(asset),
      },
      {
        key: 'delete',
        icon: <Icons.Trash size={14} />,
        label: '删除',
        danger: true,
        onClick: (asset) => void removeAsset(asset),
      },
    ],
    [toggleConfirmed, toggleFavorite, removeAsset],
  )

  const detailActions = useMemo<AssetDetailAction[]>(
    () => [
      {
        key: 'confirm',
        label: '切换确认状态',
        icon: <Icons.Check size={14} />,
        onClick: (asset) => void toggleConfirmed(asset),
      },
      {
        key: 'delete',
        label: '删除资产',
        icon: <Icons.Trash size={14} />,
        danger: true,
        onClick: (asset) => void removeAsset(asset),
      },
    ],
    [toggleConfirmed, removeAsset],
  )

  /** 抽屉内「生成设定图」：带当前模型与参数发起，契约告警走确认重提（对齐画布模式） */
  const submitDrawerGenerate = useCallback(
    async (asset: CanvasAsset) => {
      if (!activeBoardId) {
        message.warning('画板信息缺失，无法发起生成')
        return
      }
      const submitTask = async (skipValidation: boolean) => {
        await onCreateMediaTask(
          {
            boardId: activeBoardId,
            operation: 'text_to_image',
            prompt: buildFilmAssetReferencePrompt(
              asset,
              buildProductionBiblePrompt(snapshot.project.metadata),
            ),
            taskTitle: `生成设定图 · ${asset.title ?? '未命名'}`,
            outputTitle: asset.title ?? '未命名',
            ...generation.buildSubmitConfig(),
            ...(skipValidation ? { skipParameterValidation: true } : {}),
          },
          { filmOutput: { assetId: asset.id, referenceKind: 'concept' } },
        )
      }
      try {
        try {
          await submitTask(false)
        } catch (error) {
          if (error instanceof CanvasTaskValidationError) {
            const { confirmed } = await confirmCanvasTaskValidation(error.issues)
            if (!confirmed) return
            await submitTask(true)
          } else {
            throw error
          }
        }
        generation.rememberPreferences()
        message.success('已发起设定图生成，下方可查看任务进度')
      } catch (error) {
        message.error(
          `设定图任务提交失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
    [activeBoardId, onCreateMediaTask, snapshot.project.metadata, generation],
  )

  // 抽屉生成配置区：模型 + 参数（与新建弹窗共享 generation）+ 发起按钮。
  // 生成中禁用并发起重发，由任务状态区块回显进度。
  const drawerGenerator = useMemo(() => {
    if (!detailAsset) return null
    return (
      <div className="asset-library-gen-config">
        <div className="asset-library-gen-config-head">
          <span>生成设定图</span>
          <span className="asset-library-gen-config-hint">按当前模型与参数生成参考图</span>
        </div>
        <CanvasOperationParameterControls
          variant="panel"
          models={generation.models}
          modelValue={generation.modelKey}
          modelLoading={generation.modelLoading}
          disabled={detailGenerating}
          showModelPicker
          allowEmptyModel
          emptyModelLabel="沿用平台默认模型"
          fields={generation.fields}
          values={generation.paramDraft}
          onModelChange={generation.onModelChange}
          onParameterChange={generation.onParameterChange}
        />
        <Button
          type="primary"
          size="small"
          icon={<Icons.Image size={14} />}
          loading={detailGenerating}
          disabled={detailGenerating}
          onClick={() => void submitDrawerGenerate(detailAsset)}
        >
          {detailGenerating ? '生成中…' : '生成设定图'}
        </Button>
      </div>
    )
  }, [detailAsset, generation, detailGenerating, submitDrawerGenerate])

  return (
    <div className="step-setup-view">
      <div className="step-setup-toolbar">
        <div className="step-setup-kinds" role="tablist" aria-label="资产分类">
          {SETUP_ASSET_KINDS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={kind === item}
              className={`step-setup-kind-tab${kind === item ? ' is-active' : ''}`}
              onClick={() => setKind(item)}
            >
              <span className={`asset-library-kind-dot kind-${item}`} />
              {FILM_ASSET_KIND_LABELS[item]}
              <span className="step-setup-kind-count">{kindCounts.get(item) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="step-setup-toolbar-actions">
          <Input.Search
            className="step-setup-search"
            placeholder={`搜索${FILM_ASSET_KIND_LABELS[kind]}…`}
            allowClear
            value={library.keyword}
            onChange={(event) => library.setKeyword(event.target.value)}
          />
          <Select<AssetLibrarySort>
            value={library.sortBy}
            size="small"
            onChange={library.setSortBy}
            options={[
              { value: 'updated', label: '最近更新' },
              { value: 'created', label: '创建时间' },
              { value: 'title', label: '名称' },
              { value: 'usage', label: '引用数' },
            ]}
          />
          <Button
            type="primary"
            icon={<Icons.Plus size={14} />}
            onClick={() => setCreateOpen(true)}
          >
            新建{FILM_ASSET_KIND_LABELS[kind]}
          </Button>
        </div>
      </div>

      <div className="step-setup-grid" key={renderKey}>
        <AssetGrid
          items={library.items}
          loading={library.loading}
          hasMore={library.hasMore}
          onLoadMore={library.loadMore}
          emptyText={`还没有${FILM_ASSET_KIND_LABELS[kind]}资产，点击右上角「新建」开始创建`}
          onCardClick={(asset) => setDetailAssetId(asset.id)}
          usageCounts={usageCounts}
          generatingIds={generatingIds}
          cardActions={cardActions}
        />
      </div>

      <AssetCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        defaultKind={kind}
        boardId={activeBoardId}
        projectMetadata={snapshot.project.metadata}
        onCreateFilmAsset={onCreateFilmAsset}
        onUploadImageAsset={onUploadImageAsset}
        onCreateMediaTask={onCreateMediaTask}
        generationController={generation}
        onMutated={() => void refreshSnapshot()}
      />

      {detailAsset ? (
        <AssetDetailDrawer
          asset={detailAsset}
          usageCount={usageCounts.get(detailAsset.id) ?? 0}
          onClose={() => setDetailAssetId(null)}
          actions={detailActions}
          generationStatus={detailGenerationStatus}
          generator={drawerGenerator}
        />
      ) : null}
    </div>
  )
}
