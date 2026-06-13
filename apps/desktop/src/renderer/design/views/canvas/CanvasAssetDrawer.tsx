import { useMemo, useState } from 'react'
import { Drawer, Empty, List, Tag } from '@arco-design/web-react'
import { SparkSearchInput, SparkSelect } from '../../components/FormControls'
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
    <Drawer title="项目资产" visible={open} onCancel={onClose} width={420} footer={null}>
      <div className="canvas-asset-drawer-toolbar">
        <SparkSearchInput
          value={query}
          onChange={setQuery}
          placeholder="搜索资产、prompt、来源..."
          className="canvas-asset-search"
        />
        <SparkSelect
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as AssetFilter)}
          width={132}
        >
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="text">文本</option>
          <option value="prompt">Prompt</option>
          <option value="file">文件</option>
        </SparkSelect>
      </div>

      {filteredAssets.length === 0 ? (
        <Empty description={assets.length === 0 ? '暂无资产' : '没有匹配的资产'} />
      ) : (
        <List
          className="canvas-asset-list"
          dataSource={filteredAssets}
          render={(asset) => (
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
                    <Tag size="small" color="gray" bordered>
                      {asset.type}
                    </Tag>
                    <Tag size="small" color="arcoblue" bordered>
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
