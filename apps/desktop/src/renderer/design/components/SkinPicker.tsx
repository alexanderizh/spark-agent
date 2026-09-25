/**
 * 设置-外观「皮肤」选择器。卡片顺序即注册表顺序，预览面用插画缩略图。
 *
 * 本组件不持有状态：选中值与变更回调由外观设置传入，实际持久化走
 * AppContext 的 applyTweak('appSkin', id)，避免两处各存一份真相。
 */
import './SkinPicker.less'
import { APP_SKINS, type AppSkinId } from '../skins/skinRegistry'

export type SkinPickerProps = {
  value: AppSkinId
  onChange: (id: AppSkinId) => void
}

export function SkinPicker({ value, onChange }: SkinPickerProps) {
  return (
    <div className="skin-picker" role="group" aria-label="应用皮肤">
      {APP_SKINS.map((skin) => (
        <button
          key={skin.id}
          type="button"
          className="skin-picker-card"
          aria-pressed={skin.id === value}
          onClick={() => onChange(skin.id)}
        >
          <span
            className={`skin-picker-thumb skin-picker-thumb-${skin.id}`}
            style={
              skin.backdrop.light ? { backgroundImage: `url(${skin.backdrop.light})` } : undefined
            }
          />
          <span className="skin-picker-name">{skin.name}</span>
          <span className="skin-picker-desc">{skin.description}</span>
        </button>
      ))}
    </div>
  )
}
