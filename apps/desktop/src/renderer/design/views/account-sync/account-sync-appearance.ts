import { applySyncedAppearanceLocally } from '../../hooks/useAppearance'

/** 本地实时应用所需的外观补丁字段（与主进程写入 SQLite 的同步结果同源） */
export type LocalAppearancePatch = Parameters<typeof applySyncedAppearanceLocally>[0]

/**
 * 从同步结果的外观记录中提取可本地应用的字段。
 * 设置页「立即同步」与用户菜单「账号同步」共用，保证两处行为一致。
 */
export function pickLocalAppearance(value: Record<string, unknown>): LocalAppearancePatch {
  const patch: LocalAppearancePatch = {}
  if (typeof value.font === 'string') patch.font = value.font
  if (
    typeof value.fontSize === 'number' &&
    Number.isFinite(value.fontSize) &&
    value.fontSize >= 10 &&
    value.fontSize <= 20
  ) {
    patch.fontSize = value.fontSize
  }
  if (typeof value.uiZoom === 'number' && Number.isFinite(value.uiZoom)) {
    patch.uiZoom = value.uiZoom
  }
  for (const field of [
    'codeLigature',
    'backdropBlur',
    'autoCollapseTools',
    'inlineTokenCount',
    'syntaxHighlight',
  ] as const) {
    if (typeof value[field] === 'boolean') patch[field] = value[field]
  }
  if (
    value.windowCorners === 'sharp' ||
    value.windowCorners === 'soft' ||
    value.windowCorners === 'round'
  ) {
    patch.windowCorners = value.windowCorners
  }
  if (value.timestampFormat === 'rel' || value.timestampFormat === 'abs') {
    patch.timestampFormat = value.timestampFormat
  }
  return patch
}
