import { useMemo, useState } from 'react'
import { Drawer, Tag } from '@lobehub/ui'
import { Empty, List } from 'antd'
import { SearchBar as LobeSearchBar, Select as LobeSelect } from '@lobehub/ui'
import type { CanvasAsset, CanvasAssetType } from './canvas.types'

type AssetFilter = 'all' | CanvasAssetType

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

  return (
    <Drawer title="项目资产" open={open} onClose={onClose} width={420} footer={null}>
      <div className="canvas-asset-drawer-toolbar">
        <LobeSearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索资产、prompt、来源..."
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
                    <img src={asset.thumbnailUrl ?? asset.url ?? ''} alt="" />
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
              </div>
            </List.Item>
          )}
        />
      )}
    </Drawer>
  )
}
