// Spark Agent 应用标识 —— 直接引用桌面端同源图标 icon.png
// （public/icon.png 由 apps/desktop/resources/icon.png 复制而来，md5 一致）。
// 用真实位图替代手绘 SVG 近似，保证官网 logo / favicon / og:image / manifest
// 与桌面端 taskbar 图标像素级一致。props 与旧版完全兼容，调用方无需改动。
export function Logo({
  size = 32,
  showBackground = true,
  title = 'Spark Agent',
  className,
}: {
  size?: number
  showBackground?: boolean
  title?: string
  className?: string
}) {
  // icon.png 本身已含暖米色圆角底；按 55/256 ≈ 21.4% 的原圆角比例裁切 img，
  // 无论 png 边缘是否透明都能呈现干净的 app-icon 形态。
  // showBackground=false 时收窄圆角，兼容历史调用签名（当前所有调用均默认 true）。
  const radius = showBackground ? size * 0.214 : size * 0.12
  return (
    <img
      src="/icon.png"
      width={size}
      height={size}
      alt={title}
      role="img"
      aria-label={title}
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        objectFit: 'cover',
        display: 'block',
      }}
      decoding="async"
      // 首屏 nav logo，避免加载闪烁
      fetchPriority="high"
    />
  )
}
