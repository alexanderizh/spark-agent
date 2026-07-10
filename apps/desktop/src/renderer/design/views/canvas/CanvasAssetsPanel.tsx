import { useMemo, useState } from 'react'
import { Tag, Tooltip, message } from 'antd'
import { Button, SearchBar as LobeSearchBar, Select as LobeSelect } from '@lobehub/ui'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasAsset, CanvasAssetSource, CanvasAssetType } from './canvas.types'

type AssetTypeFilter = 'all' | CanvasAssetType
type AssetSourceFilter = 'all' | CanvasAssetSource
export type CanvasDownloadResource = Pick<
  CanvasAsset,
  'id' | 'type' | 'title' | 'mimeType' | 'storageKey' | 'url' | 'thumbnailUrl' | 'contentText'
>

/**
 * 左侧工作台「资产」tab（文档 §7.2 / §7.3）。
 *
 * 偏轻量：搜索 + 类型/来源筛选 + 一键插入当前视口中心 + 定位引用节点 + 下载。
 * 与「资产管理」面板的区别：这里是快速插入工作流，不做批量/多选/治理。
 */
export function CanvasAssetsPanel({
  assets,
  referencedAssetIds,
  onInsertAsset,
  onLocateAsset,
  onDownloadAsset,
}: {
  assets: CanvasAsset[]
  /** 被任一节点引用的资产 id 集合（用于「定位来源节点」是否可用） */
  referencedAssetIds: Set<string>
  onInsertAsset: (assetId: string) => void
  onLocateAsset: (assetId: string) => void
  onDownloadAsset: (asset: CanvasAsset) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<AssetSourceFilter>('all')

  const filteredAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return assets
      .filter((asset) => {
        if (typeFilter !== 'all' && asset.type !== typeFilter) return false
        if (sourceFilter !== 'all' && asset.source !== sourceFilter) return false
        if (!keyword) return true
        return [asset.title, asset.contentText, asset.mimeType, asset.source]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword))
      })
      .sort((a, b) => {
        // 最近生成 / 最近上传靠前：按 updatedAt 倒序
        return b.updatedAt.localeCompare(a.updatedAt)
      })
  }, [assets, query, typeFilter, sourceFilter])

  return (
    <div className="canvas-assets-panel">
      <div className="canvas-assets-panel-filters">
        <LobeSearchBar
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索资产..."
          className="canvas-assets-search"
        />
        <div className="canvas-assets-filter-row">
          <LobeSelect
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as AssetTypeFilter)}
            style={{ flex: 1 }}
            options={[
              { label: '全部类型', value: 'all' },
              { label: '图片', value: 'image' },
              { label: '视频', value: 'video' },
              { label: '音频', value: 'audio' },
              { label: '文本', value: 'text' },
              { label: 'Prompt', value: 'prompt' },
              { label: '文件', value: 'file' },
            ]}
          />
          <LobeSelect
            value={sourceFilter}
            onChange={(value) => setSourceFilter(value as AssetSourceFilter)}
            style={{ flex: 1 }}
            options={[
              { label: '全部来源', value: 'all' },
              { label: '上传', value: 'upload' },
              { label: 'AI 生成', value: 'ai_generated' },
              { label: 'AI 编辑', value: 'ai_edited' },
              { label: '导入', value: 'imported' },
              { label: '手动', value: 'manual' },
            ]}
          />
        </div>
      </div>

      {filteredAssets.length === 0 ? (
        <div className="canvas-assets-empty">暂无可插入的资产</div>
      ) : (
        <div className="canvas-assets-list">
          {filteredAssets.map((asset) => {
            const isReferenced = referencedAssetIds.has(asset.id)
            return (
              <div key={asset.id} className="canvas-asset-mini">
                <div className="canvas-asset-mini-thumb">
                  <AssetThumbnail asset={asset} />
                </div>
                <div className="canvas-asset-mini-main">
                  <div className="canvas-asset-mini-title" title={asset.title ?? asset.type}>
                    {asset.title ?? asset.type}
                  </div>
                  <div className="canvas-asset-mini-meta">
                    <Tag color="default" bordered>
                      {asset.type}
                    </Tag>
                    <Tag color="blue" bordered>
                      {asset.source}
                    </Tag>
                  </div>
                </div>
                <div className="canvas-asset-mini-actions">
                  <Tooltip title="插入到当前视口中心">
                    <Button
                      size="small"
                      type="primary"
                      icon={<Icons.Plus size={13} />}
                      onClick={() => onInsertAsset(asset.id)}
                    />
                  </Tooltip>
                  <Tooltip title={isReferenced ? '定位引用节点' : '暂无节点引用'}>
                    <Button
                      size="small"
                      type="text"
                      disabled={!isReferenced}
                      icon={<Icons.Layers size={13} />}
                      onClick={() => onLocateAsset(asset.id)}
                    />
                  </Tooltip>
                  <Tooltip title="下载资产">
                    <Button
                      size="small"
                      type="text"
                      icon={<Icons.Download size={13} />}
                      onClick={() => void onDownloadAsset(asset)}
                    />
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 资产下载 helper：供 AssetsPanel / AssetManagerPanel 共用 */
export async function downloadCanvasResource(resource: CanvasDownloadResource): Promise<void> {
  const sourceUrl = resource.url ?? resource.thumbnailUrl ?? undefined
  const normalizedUrl = sourceUrl ? normalizeEduAssetUrl(sourceUrl) : undefined
  const isAbsolutePath =
    typeof resource.storageKey === 'string' &&
    (resource.storageKey.startsWith('/') || /^[A-Za-z]:[\\/]/.test(resource.storageKey))
  const canDownload = Boolean(
    resource.url || resource.thumbnailUrl || resource.contentText || isAbsolutePath,
  )
  if (!canDownload) {
    message.warning('该资产没有可下载内容')
    return
  }
  try {
    const storagePath = isAbsolutePath ? (resource.storageKey as string) : undefined
    const result = await window.spark.invoke('canvas:asset:download', {
      ...(storagePath ? { sourcePath: storagePath } : {}),
      ...(normalizedUrl ? { sourceUrl: normalizedUrl } : {}),
      ...(resource.contentText != null ? { contentText: resource.contentText } : {}),
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      type: resource.type,
      suggestedFileName: resource.title?.trim() || `canvas-${resource.type}-${resource.id}`,
    })
    if (result.saved) {
      message.success(result.savedPath ? `资产已下载到 ${result.savedPath}` : '资产已下载')
    } else if (result.error) {
      message.error(`下载失败：${result.error}`)
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '下载资产失败')
  }
}

/** 资产下载 helper：供 AssetsPanel / AssetManagerPanel 共用 */
export async function downloadAsset(asset: CanvasAsset): Promise<void> {
  await downloadCanvasResource(asset)
}

/**
 * 把单个资产解析为批量下载所需的 payload（与 downloadCanvasResource 同款逻辑）。
 * 没有可下载内容的资产返回 null，由调用方跳过。
 */
function toBatchDownloadItem(resource: CanvasDownloadResource): {
  sourcePath?: string
  sourceUrl?: string
  contentText?: string
  mimeType?: string | null
  type?: CanvasDownloadResource['type']
  suggestedFileName?: string
} | null {
  const sourceUrl = resource.url ?? resource.thumbnailUrl ?? undefined
  const normalizedUrl = sourceUrl ? normalizeEduAssetUrl(sourceUrl) : undefined
  const isAbsolutePath =
    typeof resource.storageKey === 'string' &&
    (resource.storageKey.startsWith('/') || /^[A-Za-z]:[\\/]/.test(resource.storageKey))
  const canDownload = Boolean(
    resource.url || resource.thumbnailUrl || resource.contentText || isAbsolutePath,
  )
  if (!canDownload) return null
  const storagePath = isAbsolutePath ? (resource.storageKey as string) : undefined
  return {
    ...(storagePath ? { sourcePath: storagePath } : {}),
    ...(normalizedUrl ? { sourceUrl: normalizedUrl } : {}),
    ...(resource.contentText != null ? { contentText: resource.contentText } : {}),
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    type: resource.type,
    suggestedFileName: resource.title?.trim() || `canvas-${resource.type}-${resource.id}`,
  }
}

/**
 * 批量下载：只弹一次目录选择对话框，把所有资产一次性写入该目录。
 * （之前逐个 downloadAsset 会每个资产弹一次保存对话框，体验极差。）
 * @returns 实际成功下载的数量
 */
export async function downloadCanvasResourceBatch(
  resources: CanvasDownloadResource[],
): Promise<number> {
  const items: NonNullable<ReturnType<typeof toBatchDownloadItem>>[] = []
  for (const resource of resources) {
    const item = toBatchDownloadItem(resource)
    if (item) items.push(item)
  }
  if (items.length === 0) {
    message.warning('所选资产均无可下载内容')
    return 0
  }
  try {
    const result = await window.spark.invoke('canvas:asset:download-batch', { items })
    if (result.canceled) return 0
    if (result.failed > 0) {
      message.warning(
        `已下载 ${result.succeeded} 个，${result.failed} 个失败${
          result.targetDirectory ? `（保存到 ${result.targetDirectory}）` : ''
        }`,
      )
    } else {
      message.success(
        `已下载 ${result.succeeded} 个资产${result.targetDirectory ? `到 ${result.targetDirectory}` : ''}`,
      )
    }
    return result.succeeded
  } catch (error) {
    message.error(error instanceof Error ? error.message : '批量下载资产失败')
    return 0
  }
}
