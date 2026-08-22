import { useEffect, useMemo, useState } from 'react'
import { Modal } from 'antd'
import {
  buildQuickUseGlobalPromptLibraryEntries,
  CanvasPromptLibraryPanel,
  type CanvasPromptLibraryEntry,
} from './CanvasPromptLibraryPanel'
import { resolvePromptQuickUseAction } from './canvasPromptLibraryQuickUse'
import { readGlobalPromptLibrary, type GlobalPromptLibraryState } from './canvasPromptLibraryStore'
import { canvasApi } from './canvas.api'
import { useCanvasProjects } from './canvas.store'
import type { CanvasAsset } from './canvas.types'
import './canvas-prompt-library.less'

export function CanvasPromptLibraryQuickUseModal({
  open,
  assets,
  selectedNodeCount,
  onClose,
  onApply,
}: {
  open: boolean
  assets: CanvasAsset[]
  selectedNodeCount: number
  onClose: () => void
  onApply: (entry: CanvasPromptLibraryEntry) => Promise<boolean>
}) {
  const { projects } = useCanvasProjects()
  const [library, setLibrary] = useState<GlobalPromptLibraryState | null>(null)
  const [loadedProjectAssets, setLoadedProjectAssets] = useState<CanvasAsset[][]>([])
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false

    void Promise.all(
      projects.map(async (project) => {
        try {
          return await canvasApi.openSnapshot(project.id)
        } catch {
          return null
        }
      }),
    ).then((snapshots) => {
      if (cancelled) return
      setLoadedProjectAssets(
        snapshots
          .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null)
          .map((snapshot) => snapshot.assets),
      )
    })

    return () => {
      cancelled = true
    }
  }, [open, projects])

  const projectAssets = useMemo(() => {
    const deduplicated = new Map<string, CanvasAsset>()
    for (const asset of loadedProjectAssets.flat()) {
      deduplicated.set(`${asset.projectId}:${asset.id}`, asset)
    }
    for (const asset of assets) {
      deduplicated.set(`${asset.projectId}:${asset.id}`, asset)
    }
    return [...deduplicated.values()]
  }, [assets, loadedProjectAssets])

  const globalEntries = useMemo(() => {
    if (!library) return []
    return buildQuickUseGlobalPromptLibraryEntries(library.items, projectAssets, projectNames)
  }, [library, projectAssets, projectNames])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void readGlobalPromptLibrary().then((next) => {
      if (!cancelled) setLibrary(next)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const action = resolvePromptQuickUseAction(selectedNodeCount)

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={860}
      style={{
        padding: 0,
      }}
      wrapStyle={{
        padding: 0,
      }}
      centered
      destroyOnHidden
      className="canvas-prompt-quick-use-modal"
      title={null}
    >
      <CanvasPromptLibraryPanel
        assets={assets}
        globalEntries={globalEntries}
        projectNames={projectNames}
        title="提示词库"
        subtitle="全部用户提示词"
        placeholder="搜索提示词、镜头、动作…"
        className="canvas-prompt-quick-use-panel"
        showSourceFilter
        showCategoryFilter={false}
        showSort
        limit={null}
        deduplicateProjectEntriesAgainstGlobal={false}
        getApplyLabel={() => (action === 'apply-to-selection' ? '应用' : '插入')}
        onApply={async (entry) => {
          const applied = await onApply(entry)
          if (applied) onClose()
        }}
      />
    </Modal>
  )
}
