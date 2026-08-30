import { useEffect, useState } from 'react'

/**
 * Provider 更新时递增版本号，供已打开的会话/画布选择器重新加载可用模型。
 */
export function useProviderConfigVersion(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope === 'provider') setVersion((current) => current + 1)
      }) ?? (() => {})
    )
  }, [])

  return version
}
