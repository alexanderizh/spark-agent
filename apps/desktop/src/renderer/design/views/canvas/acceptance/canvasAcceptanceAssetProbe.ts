import type { CanvasAsset } from '../canvas.types'
import type { CanvasAcceptanceAssertion } from './canvasAcceptanceEvidence'
import type { CanvasAcceptanceTargetKind } from './canvasAcceptanceTypes'

export type CanvasAcceptanceAssetProbe = {
  assetId: string
  expectedKind: CanvasAcceptanceTargetKind
  actualKind: CanvasAsset['type']
  mimeType: string | null
  location: string | null
  extension: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  sizeBytes: number | null
  issues: string[]
}

export function probeCanvasAcceptanceAssets(
  expectedKind: CanvasAcceptanceTargetKind,
  assets: readonly CanvasAsset[],
): { probes: CanvasAcceptanceAssetProbe[]; assertions: CanvasAcceptanceAssertion[] } {
  if (expectedKind === 'text') return { probes: [], assertions: [] }
  const probes = assets.map((asset) => probeAsset(expectedKind, asset))
  if (probes.length === 0) {
    return {
      probes,
      assertions: [failed('media.probe.asset_presence', '没有可探测的媒体资产')],
    }
  }
  const assertions: CanvasAcceptanceAssertion[] = []
  for (const probe of probes) {
    const prefix = `media.probe.${probe.assetId}`
    assertions.push(
      checked(
        `${prefix}.kind`,
        probe.actualKind === expectedKind,
        `资产类型 ${probe.actualKind}，期望 ${expectedKind}`,
      ),
      checked(`${prefix}.location`, Boolean(probe.location), '资产文件路径或 URL 可追溯'),
    )
    if (probe.mimeType) {
      assertions.push(
        checked(
          `${prefix}.mime`,
          probe.mimeType.toLowerCase().startsWith(`${expectedKind}/`),
          `MIME ${probe.mimeType}`,
        ),
      )
    } else {
      assertions.push(warned(`${prefix}.mime`, '资产缺少 MIME，暂时无法校验编码类型'))
    }
    if (probe.mimeType && probe.extension) {
      const expectedExtensions = extensionsForMime(probe.mimeType)
      if (expectedExtensions.length > 0) {
        assertions.push(
          checked(
            `${prefix}.extension`,
            expectedExtensions.includes(probe.extension),
            `文件扩展名 .${probe.extension} 与 MIME ${probe.mimeType}`,
          ),
        )
      }
    } else if (probe.location && !probe.extension) {
      assertions.push(warned(`${prefix}.extension`, '资产路径缺少可识别的文件扩展名'))
    }
    if (expectedKind === 'image') {
      assertions.push(
        probe.width != null && probe.height != null
          ? checked(
              `${prefix}.dimensions`,
              probe.width > 0 && probe.height > 0,
              `图像尺寸 ${probe.width}×${probe.height}`,
            )
          : warned(`${prefix}.dimensions`, '资产缺少图像宽高元数据'),
      )
    }
    if (expectedKind === 'audio' || expectedKind === 'video') {
      assertions.push(
        probe.durationMs != null
          ? checked(`${prefix}.duration`, probe.durationMs > 0, `媒体时长 ${probe.durationMs}ms`)
          : warned(`${prefix}.duration`, '资产缺少媒体时长元数据'),
      )
    }
    assertions.push(
      probe.sizeBytes != null
        ? checked(`${prefix}.size`, probe.sizeBytes > 0, `文件大小 ${probe.sizeBytes} bytes`)
        : warned(`${prefix}.size`, '资产缺少文件大小元数据'),
    )
  }
  return { probes, assertions }
}

function probeAsset(
  expectedKind: CanvasAcceptanceTargetKind,
  asset: CanvasAsset,
): CanvasAcceptanceAssetProbe {
  const issues: string[] = []
  const location = asset.storageKey?.trim() || asset.url?.trim() || null
  const extension = location ? extensionFromLocation(location) : null
  if (asset.type !== expectedKind) issues.push(`kind_mismatch:${asset.type}`)
  if (!location) issues.push('location_missing')
  if (!asset.mimeType) issues.push('mime_missing')
  else if (!asset.mimeType.toLowerCase().startsWith(`${expectedKind}/`)) {
    issues.push(`mime_mismatch:${asset.mimeType}`)
  }
  if (expectedKind === 'image' && (asset.width == null || asset.height == null)) {
    issues.push('dimensions_missing')
  }
  if (
    (expectedKind === 'audio' || expectedKind === 'video') &&
    asset.durationMs == null
  ) {
    issues.push('duration_missing')
  }
  if (asset.sizeBytes == null) issues.push('size_missing')
  return {
    assetId: asset.id,
    expectedKind,
    actualKind: asset.type,
    mimeType: asset.mimeType ?? null,
    location,
    extension,
    width: asset.width ?? null,
    height: asset.height ?? null,
    durationMs: asset.durationMs ?? null,
    sizeBytes: asset.sizeBytes ?? null,
    issues,
  }
}

function extensionFromLocation(location: string): string | null {
  const path = location.split(/[?#]/)[0] ?? location
  const match = path.match(/\.([a-zA-Z0-9]{2,8})$/)
  return match?.[1]?.toLowerCase() ?? null
}

function extensionsForMime(mimeType: string): string[] {
  const normalized = mimeType.toLowerCase().split(';')[0]?.trim()
  const extensions: Record<string, string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'image/gif': ['gif'],
    'video/mp4': ['mp4', 'm4v'],
    'video/webm': ['webm'],
    'video/quicktime': ['mov'],
    'audio/mpeg': ['mp3'],
    'audio/mp4': ['m4a', 'mp4'],
    'audio/wav': ['wav'],
    'audio/x-wav': ['wav'],
    'audio/webm': ['webm'],
    'audio/ogg': ['ogg', 'oga'],
  }
  return normalized ? extensions[normalized] ?? [] : []
}

function checked(id: string, passed: boolean, message: string): CanvasAcceptanceAssertion {
  return { id, status: passed ? 'passed' : 'failed', message }
}

function failed(id: string, message: string): CanvasAcceptanceAssertion {
  return { id, status: 'failed', message }
}

function warned(id: string, message: string): CanvasAcceptanceAssertion {
  return { id, status: 'warned', message }
}
