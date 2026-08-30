import { Slider } from 'antd'
import {
  STAGE3D_PANORAMA_ZOOM_MAX,
  STAGE3D_PANORAMA_ZOOM_MIN,
  STAGE3D_SCENE_SCALE_MAX,
  STAGE3D_SCENE_SCALE_MIN,
  clamp,
  getStage3DSceneControlFields,
  type Stage3DData,
} from './stage3d.types'

type SceneControlsProps = {
  draft: Stage3DData
  setDraft: React.Dispatch<React.SetStateAction<Stage3DData>>
}

function fovToFocalLength(fov: number): number {
  return Math.round(24 / (2 * Math.tan((fov * Math.PI) / 360)))
}

export function SceneControls({ draft, setDraft }: SceneControlsProps) {
  const fields = getStage3DSceneControlFields(draft.backdrop.mode)
  const hasField = (field: (typeof fields)[number]) => fields.includes(field)

  return (
    <>
      <div className="stage3d-section-title">场景控制</div>
      <div className="stage3d-scene-controls">
        {hasField('panoramaZoom') && (
          <label className="stage3d-field">
            <span>背景远近 {(draft.backdrop.panoramaZoom ?? 1).toFixed(2)}x</span>
            <Slider
              min={STAGE3D_PANORAMA_ZOOM_MIN}
              max={STAGE3D_PANORAMA_ZOOM_MAX}
              step={0.05}
              value={draft.backdrop.panoramaZoom ?? 1}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  backdrop: { ...current.backdrop, panoramaZoom: value },
                }))
              }
            />
            <span className="stage3d-field-hint">只改变全景背景：0.5x 拉远，2.0x 拉近。</span>
          </label>
        )}

        {hasField('backdropDistance') && (
          <label className="stage3d-field">
            <span>背板距离 {(draft.backdrop.backdropDistance ?? 8).toFixed(0)}m</span>
            <Slider
              min={3}
              max={30}
              value={draft.backdrop.backdropDistance ?? 8}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  backdrop: { ...current.backdrop, backdropDistance: value },
                }))
              }
            />
          </label>
        )}

        <label className="stage3d-field">
          <span>人物与道具 {(draft.sceneScale ?? 1).toFixed(2)}x</span>
          <Slider
            min={STAGE3D_SCENE_SCALE_MIN}
            max={STAGE3D_SCENE_SCALE_MAX}
            step={0.05}
            value={draft.sceneScale ?? 1}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                sceneScale: clamp(value, STAGE3D_SCENE_SCALE_MIN, STAGE3D_SCENE_SCALE_MAX),
              }))
            }
          />
          <span className="stage3d-field-hint">只改变人物和道具比例，不改变背景。</span>
        </label>

        <label className="stage3d-field">
          <span>
            镜头焦段 ≈{fovToFocalLength(draft.camera.fov)}mm · 视角 {Math.round(draft.camera.fov)}°
          </span>
          <Slider
            min={12}
            max={90}
            value={draft.camera.fov}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                camera: { ...current.camera, fov: value },
              }))
            }
          />
          <span className="stage3d-field-hint">长焦压缩空间，广角增强纵深。</span>
        </label>
      </div>
    </>
  )
}
