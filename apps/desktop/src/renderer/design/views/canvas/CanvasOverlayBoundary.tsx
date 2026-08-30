import { ConfigProvider } from 'antd'
import { createContext, useContext, useState, type ReactNode } from 'react'
import styles from './CanvasOverlayBoundary.module.less'

const CanvasOverlayHostContext = createContext<HTMLElement | null>(null)

export function useCanvasOverlayHost(): HTMLElement | null {
  return useContext(CanvasOverlayHostContext)
}

/**
 * 画布专属 Portal 边界。Dropdown / Select / Popover 默认挂到该 host，避免直接进入
 * document.body 后被普通聊天、设置页的全局 Ant 覆盖命中。
 */
export function CanvasOverlayBoundary({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)

  return (
    <CanvasOverlayHostContext.Provider value={host}>
      <ConfigProvider
        getPopupContainer={(triggerNode) =>
          host ?? triggerNode?.ownerDocument.body ?? document.body
        }
      >
        <div className={className}>
          {children}
          <div ref={setHost} className={styles.host} data-canvas-overlay-host />
        </div>
      </ConfigProvider>
    </CanvasOverlayHostContext.Provider>
  )
}
