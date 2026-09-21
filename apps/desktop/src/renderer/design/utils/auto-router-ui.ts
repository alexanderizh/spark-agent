import type { ProviderProfile } from '@spark/protocol'

/**
 * 兼容垫片：旧 Auto Router（伪 provider）已下线，provider 列表不再包含
 * 需要隐藏的动态合成行，本过滤退化为恒等函数。
 *
 * 注意：SettingsView.tsx 仍有调用点处于并行改动工作树中，此文件暂时保留；
 * 该并行改动合并后，连同全部 filterProvidersForVisibleUi 调用点一并删除。
 */
export function filterProvidersForVisibleUi<T extends ProviderProfile>(
  providers: readonly T[],
): T[] {
  return [...providers]
}
