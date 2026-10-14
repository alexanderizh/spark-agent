/**
 * 整窗皮肤背景层。只在主窗口 shell 挂载一次：插画铺最底、纱层保可读性，
 * 内容面板继续用既有不透明 token，长文阅读对比度不受插画影响。
 *
 * 插画路径与遮罩浓度由本组件按明暗态内联注入（标准 CSS 属性，便于测试与
 * 调试），定位、层级与降级规则见同目录 SkinBackdrop.less。
 */
import './SkinBackdrop.less'
import { getAppSkin, type AppSkinId } from './skinRegistry'

export type SkinBackdropProps = {
  skinId: AppSkinId
  /** 已解析的明暗态（light/dark），由 shell 传入。 */
  resolvedTheme: 'light' | 'dark'
}

export function SkinBackdrop({ skinId, resolvedTheme }: SkinBackdropProps) {
  const skin = getAppSkin(skinId)
  if (skin.id === 'none') return null
  const image = resolvedTheme === 'dark' ? skin.backdrop.dark : skin.backdrop.light
  const scrim = resolvedTheme === 'dark' ? skin.scrim.dark : skin.scrim.light
  return (
    <div className="app-skin" aria-hidden="true">
      <div className="app-skin-backdrop" style={{ backgroundImage: `url(${image})` }} />
      <div className="app-skin-scrim" style={{ opacity: scrim }} />
    </div>
  )
}
