import { PROVIDER_PROMOS } from '@spark/protocol'
import { Icons } from '../Icons'
import './ProviderPromoBanner.less'

/**
 * Provider 推广小横幅 — 新手引导模型配置页与渠道管理页共用的轻量提示条。
 * 文案、推荐链接全部来自 provider-promo.ts 单一配置源，运营更换推荐时只改配置，不改组件。
 * 设计约束：小体积简短提示（单行、12px），不做大面积横幅。
 *
 * onSelectPreset：传入时横幅追加「一键使用」按钮（点击选中推广渠道预设，如引导页
 * 直接切到 OrcaRouter）；未传（如渠道管理页列表横幅）则只保留注册跳转入口。
 */
export function ProviderPromoBanner({
  className,
  onSelectPreset,
}: {
  className?: string
  onSelectPreset?: (presetId: string) => void
}) {
  if (PROVIDER_PROMOS.length === 0) return null
  return (
    <div className={className ? `ppb_group ${className}` : 'ppb_group'}>
      {PROVIDER_PROMOS.map((promo) => (
        <div className="ppb_banner" key={promo.id}>
          <span className="ppb_text">{promo.bannerText}</span>
          {onSelectPreset && (
            <button
              type="button"
              className="ppb_cta ppb_cta_button"
              onClick={() => onSelectPreset(promo.primaryPresetId)}
              title={`切换到 ${promo.primaryPresetId}`}
            >
              {promo.selectCta}
            </button>
          )}
          <a
            className="ppb_cta"
            href={promo.registerUrl}
            target="_blank"
            rel="noreferrer"
            title={promo.registerUrl}
          >
            {promo.bannerCta}
            <Icons.ExternalLink size={11} />
          </a>
        </div>
      ))}
    </div>
  )
}
