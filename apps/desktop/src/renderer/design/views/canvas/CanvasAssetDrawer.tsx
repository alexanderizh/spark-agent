import { useMemo, useState } from 'react'
import { Button, Drawer, Tag } from '@lobehub/ui'
import { Empty, List, Tooltip, message } from 'antd'
import { SearchBar as LobeSearchBar, Select as LobeSelect } from '@lobehub/ui'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import type { CanvasAsset, CanvasAssetType } from './canvas.types'

type AssetFilter = 'all' | CanvasAssetType

function isAbsolutePath(value: string | null | undefined): value is string {
  return typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value))
}

function assetSourceUrl(asset: CanvasAsset): string | undefined {
  const url = asset.url ?? asset.thumbnailUrl ?? undefined
  return url ? normalizeEduAssetUrl(url) : undefined
}

function assetFileName(asset: CanvasAsset): string {
  const title = asset.title?.trim()
  if (title) return title
  const source = asset.url ?? asset.storageKey ?? asset.thumbnailUrl ?? ''
  const basename = source.split(/[?#]/)[0]?.split(/[\\/]/).filter(Boolean).pop()
  return basename || `canvas-${asset.type}-${asset.id}`
}

function canDownloadAsset(asset: CanvasAsset): boolean {
  return Boolean(
    asset.url || asset.thumbnailUrl || asset.contentText || isAbsolutePath(asset.storageKey),
  )
}

export function CanvasAssetDrawer({
  open,
  assets,
  onClose,
}: {
  open: boolean
  assets: CanvasAsset[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<AssetFilter>('all')
  const [downloadingAssetId, setDownloadingAssetId] = useState<string | null>(null)

  const filteredAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return assets.filter((asset) => {
      if (typeFilter !== 'all' && asset.type !== typeFilter) return false
      if (!keyword) return true
      return [asset.title, asset.contentText, asset.mimeType, asset.source]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
  }, [assets, query, typeFilter])

  const handleDownload = async (asset: CanvasAsset): Promise<void> => {
    if (!canDownloadAsset(asset)) {
      message.warning('该资产没有可下载内容')
      return
    }
    setDownloadingAssetId(asset.id)
    try {
      const sourceUrl = assetSourceUrl(asset)
      const result = await window.spark.invoke('canvas:asset:download', {
        ...(isAbsolutePath(asset.storageKey) ? { sourcePath: asset.storageKey } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(asset.contentText != null ? { contentText: asset.contentText } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
        type: asset.type,
        suggestedFileName: assetFileName(asset),
      })
      if (result.saved) {
        message.success(result.savedPath ? `资产已下载到 ${result.savedPath}` : '资产已下载')
      } else if (result.error) {
        message.error(`下载失败：${result.error}`)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '下载资产失败')
    } finally {
      setDownloadingAssetId(null)
    }
  }

  return (
    <Drawer title="项目资产" open={open} onClose={onClose} width={420} footer={null}>
      <div className="canvas-asset-drawer-toolbar">
        <LobeSearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索资产、文本、来源..."
          className="canvas-asset-search"
        />
        <LobeSelect
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as AssetFilter)}
          style={{ width: 132 }}
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
      </div>

      {filteredAssets.length === 0 ? (
        <Empty description={assets.length === 0 ? '暂无资产' : '没有匹配的资产'} />
      ) : (
        <List
          className="canvas-asset-list"
          dataSource={filteredAssets}
          renderItem={(asset) => (
            <List.Item key={asset.id}>
              <div className="canvas-asset-item">
                <div className="canvas-asset-thumb">
                  {asset.thumbnailUrl || asset.url ? (
                    <img src={normalizeEduAssetUrl(asset.thumbnailUrl ?? asset.url ?? '')} alt="" />
                  ) : (
                    asset.type.slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="canvas-asset-main">
                  <div className="canvas-asset-title">{asset.title ?? asset.type}</div>
                  {asset.contentText && (
                    <div className="canvas-asset-content">{asset.contentText}</div>
                  )}
                  <div className="canvas-asset-meta">
                    <Tag color="default" bordered>
                      {asset.type}
                    </Tag>
                    <Tag color="blue" bordered>
                      {asset.source}
                    </Tag>
                  </div>
                </div>
                <div className="canvas-asset-actions">
                  <Tooltip title="下载资产">
                    <Button
                      size="small"
                      icon={<Icons.Download size={14} />}
                      disabled={!canDownloadAsset(asset)}
                      loading={downloadingAssetId === asset.id}
                      onClick={() => void handleDownload(asset)}
                    />
                  </Tooltip>
                </div>
              </div>
            </List.Item>
          )}
        />
      )}
    </Drawer>
  )
}
