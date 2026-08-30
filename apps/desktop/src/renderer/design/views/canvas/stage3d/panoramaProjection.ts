import { STAGE3D_PANORAMA_ZOOM_MAX, STAGE3D_PANORAMA_ZOOM_MIN, clamp } from './stage3d.types'

export function panoramaZoomToRayScale(zoom: number): number {
  return 1 / clamp(zoom, STAGE3D_PANORAMA_ZOOM_MIN, STAGE3D_PANORAMA_ZOOM_MAX)
}
