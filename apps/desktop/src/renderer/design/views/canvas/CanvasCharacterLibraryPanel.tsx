import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@lobehub/ui'
import { Empty, Tag } from 'antd'
import { Icons } from '../../Icons'
import { CanvasCharacterSubviewPreview } from './CanvasCharacterSubviewPreview'
import { CanvasCharacterSubviewEditor } from './CanvasCharacterSubviewEditor'
import {
  CHARACTER_SUBVIEW_KIND_LABELS,
  readCharacterSubviews,
  resolveCharacterSourceImageAsset,
  type FilmCharacterSubview,
} from './canvasCharacterLibrary'
import { readAssetKind } from './canvasFilmAssets'
import type { CanvasAsset, CanvasSnapshot } from './canvas.types'

export function CanvasCharacterLibraryPanel({
  open,
  onClose,
  snapshot,
  onInsertCharacterImage,
  onApplyCharacterSubview,
  onUpdateCharacterSubviews,
}: {
  open: boolean
  onClose: () => void
  snapshot: CanvasSnapshot
  onInsertCharacterImage: (assetId: string) => Promise<void>
  onApplyCharacterSubview: (
    characterAsset: CanvasAsset,
    sourceImageAsset: CanvasAsset,
    subview: FilmCharacterSubview,
  ) => Promise<void>
  onUpdateCharacterSubviews: (assetId: string, subviews: FilmCharacterSubview[]) => Promise<void>
}) {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [selectedSubviewId, setSelectedSubviewId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const characterEntries = useMemo(
    () =>
      snapshot.assets
        .filter((asset) => readAssetKind(asset) === 'character')
        .map((asset) => ({
          asset,
          previewAsset: resolveCharacterSourceImageAsset(asset, snapshot.assets, {
            nodes: snapshot.nodes,
            tasks: snapshot.tasks,
          }),
        }))
        .sort((a, b) => {
          const aUpdatedAt = a.previewAsset?.updatedAt ?? a.asset.updatedAt
          const bUpdatedAt = b.previewAsset?.updatedAt ?? b.asset.updatedAt
          return bUpdatedAt.localeCompare(aUpdatedAt)
        }),
    [snapshot.assets, snapshot.nodes, snapshot.tasks],
  )
  const characterAssets = useMemo(() => {
    return characterEntries.filter((entry) => entry.previewAsset).map((entry) => entry.asset)
  }, [characterEntries])
  const characterPreviewAssetById = useMemo(
    () =>
      new Map(
        characterEntries.map((entry) => [entry.asset.id, entry.previewAsset ?? null] as const),
      ),
    [characterEntries],
  )
  const activeCharacterId =
    selectedCharacterId && characterAssets.some((asset) => asset.id === selectedCharacterId)
      ? selectedCharacterId
      : (characterAssets[0]?.id ?? null)
  const selectedCharacter =
    characterAssets.find((asset) => asset.id === activeCharacterId) ?? characterAssets[0] ?? null
  const sourceImageAsset =
    (selectedCharacter ? characterPreviewAssetById.get(selectedCharacter.id) : null) ?? null
  const subviews = useMemo(
    () => readCharacterSubviews(selectedCharacter?.metadata),
    [selectedCharacter?.metadata],
  )
  const activeSubviewId =
    selectedSubviewId && subviews.some((item) => item.id === selectedSubviewId)
      ? selectedSubviewId
      : null
  const selectedSubview =
    (activeSubviewId ? subviews.find((item) => item.id === activeSubviewId) : null) ?? null
  const showSubviewOverview = Boolean(sourceImageAsset && subviews.length > 0 && !selectedSubview)

  if (!open) return null

  const handleApply = async () => {
    if (!selectedCharacter || !sourceImageAsset) return
    setSubmitting(true)
    try {
      if (selectedSubview) {
        await onApplyCharacterSubview(selectedCharacter, sourceImageAsset, selectedSubview)
      } else {
        await onInsertCharacterImage(sourceImageAsset.id)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <>
      <div
        className="canvas-character-library-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <section
          className="canvas-bottom-floating-panel canvas-character-library-panel"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="canvas-bottom-floating-head">
            <div>
              <strong className="canvas-character-library-title">
                <Icons.Users size={16} />
                角色库
              </strong>
              <span>聚合查看角色设定图卡、细节子视图，并将角色图快速应用到画布。</span>
            </div>
            <Button
              size="middle"
              type="text"
              icon={<Icons.X size={14} />}
              aria-label="关闭角色库"
              onClick={onClose}
            />
          </div>

          {characterAssets.length === 0 ? (
            <div className="canvas-character-library-empty">
              <Empty description="当前项目还没有角色设定图卡" />
            </div>
          ) : (
            <div className="canvas-character-library">
              <div className={`canvas-character-library-hero${showSubviewOverview ? ' has-overview' : ''}`}>
                <div className="canvas-character-library-preview-card">
                  {showSubviewOverview ? (
                    <div className="canvas-character-library-overview">
                      {subviews.map((subview) => (
                        <button
                          key={subview.id}
                          type="button"
                          className={`canvas-character-library-overview-item kind-${subview.kind}`}
                          onClick={() => setSelectedSubviewId(subview.id)}
                        >
                          <div className="canvas-character-library-overview-thumb">
                            <CanvasCharacterSubviewPreview
                              asset={sourceImageAsset}
                              subview={subview}
                              alt={subview.label}
                            />
                          </div>
                          <div className="canvas-character-library-overview-meta">
                            <strong>{subview.label}</strong>
                            <span>{CHARACTER_SUBVIEW_KIND_LABELS[subview.kind]}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <CanvasCharacterSubviewPreview
                      asset={sourceImageAsset}
                      subview={selectedSubview}
                      alt={selectedSubview?.label ?? selectedCharacter?.title ?? '角色预览'}
                      className="canvas-character-library-preview-media"
                    />
                  )}
                </div>

                <div className="canvas-character-library-detail">
                  <div className="canvas-character-library-detail-head">
                    <div>
                      <h3>{selectedCharacter?.title ?? '未命名角色'}</h3>
                      <p>{selectedCharacter?.contentText?.trim() || '暂无角色描述'}</p>
                    </div>
                  </div>

                  <div className="canvas-character-library-detail-meta">
                    <Tag bordered color={sourceImageAsset ? 'blue' : 'default'}>
                      {sourceImageAsset ? '已关联角色设定图卡' : '缺少设定图卡'}
                    </Tag>
                    <Tag bordered color="default">
                      仅显示图片角色卡
                    </Tag>
                    <Tag bordered color={subviews.length > 0 ? 'gold' : 'default'}>
                      子视图 {subviews.length}
                    </Tag>
                    {selectedSubview ? (
                      <Tag bordered color="magenta">
                        当前视图：{CHARACTER_SUBVIEW_KIND_LABELS[selectedSubview.kind]}
                      </Tag>
                    ) : subviews.length > 0 ? (
                      <Tag bordered color="cyan">
                        当前视图：全部视图
                      </Tag>
                    ) : null}
                  </div>

                  <div className="canvas-character-library-subviews">
                    {subviews.length === 0 ? (
                      <div className="canvas-character-library-subviews-empty">
                        还没有角色子视图
                      </div>
                    ) : (
                      subviews.map((subview) => (
                        <button
                          key={subview.id}
                          type="button"
                          className={`canvas-character-library-subview-card${subview.id === selectedSubview?.id ? ' is-active' : ''}`}
                          onClick={() => setSelectedSubviewId(subview.id)}
                        >
                          <div className="canvas-character-library-subview-thumb">
                            <CanvasCharacterSubviewPreview
                              asset={sourceImageAsset}
                              subview={subview}
                              alt={subview.label}
                            />
                          </div>
                          <div className="canvas-character-library-subview-info">
                            <strong>{subview.label}</strong>
                            <span>{CHARACTER_SUBVIEW_KIND_LABELS[subview.kind]}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="canvas-character-library-detail-actions">
                    <Button
                      size="middle"
                      onClick={() => setEditorOpen(true)}
                      disabled={!selectedCharacter || !sourceImageAsset}
                    >
                      提取子视图
                    </Button>
                    <Button
                      size="middle"
                      type="primary"
                      loading={submitting}
                      onClick={() => void handleApply()}
                      disabled={!selectedCharacter || !sourceImageAsset}
                    >
                      {selectedSubview ? '应用子视图到画布' : '应用角色卡到画布'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="canvas-character-library-strip">
                {characterAssets.map((asset) => {
                  const imageAsset = characterPreviewAssetById.get(asset.id) ?? null
                  const active = asset.id === selectedCharacter?.id
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      className={`canvas-character-library-card${active ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedCharacterId(asset.id)
                        setSelectedSubviewId(null)
                      }}
                    >
                      <div className="canvas-character-library-card-thumb">
                        <CanvasCharacterSubviewPreview
                          asset={imageAsset}
                          alt={asset.title ?? '角色'}
                        />
                      </div>
                      <div className="canvas-character-library-card-text">
                        <strong>{asset.title ?? '未命名角色'}</strong>
                        <span>{readCharacterSubviews(asset.metadata).length} 个子视图</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      </div>

      <CanvasCharacterSubviewEditor
        key={`${selectedCharacter?.id ?? 'none'}:${subviews.map((item) => item.id).join(',')}:${editorOpen ? 'open' : 'closed'}`}
        open={editorOpen}
        ownerAsset={selectedCharacter}
        sourceImageAsset={sourceImageAsset}
        initialSubviews={subviews}
        onClose={() => setEditorOpen(false)}
        onInsertSubview={async (subview) => {
          if (!selectedCharacter || !sourceImageAsset) return
          await onApplyCharacterSubview(selectedCharacter, sourceImageAsset, subview)
        }}
        onSave={async (nextSubviews) => {
          if (!selectedCharacter) return
          await onUpdateCharacterSubviews(selectedCharacter.id, nextSubviews)
          setSelectedSubviewId(null)
        }}
        zIndex={1600}
      />
    </>,
    document.body,
  )
}
