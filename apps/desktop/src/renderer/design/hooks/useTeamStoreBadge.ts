/**
 * useTeamStoreBadge — 侧栏「团队商店」可更新角标
 *
 * 聚合五类团队资产的 remote-newer 数量（工作流/助手/应用信封三通道 + 技能 + MCP）。
 * 未配置团队注册中心时恒为 0；90s 轮询 + 窗口聚焦刷新；失败静默保持上次值。
 * 独立小模块：App 侧栏静态引入而不拖入整个商店视图（商店视图保持 lazy 分包）。
 */
import { useEffect, useState } from 'react'
import { useIpcInvoke } from './useIpc'

/** 聚焦触发的最小刷新间隔：每次 refresh 是 6 个 IPC（5 个走团队注册中心网络），
 * 频繁 alt-tab 不应每次都打满；30s 内的聚焦复用上次结果（90s 轮询仍是保底节奏）。 */
const FOCUS_REFRESH_MIN_INTERVAL_MS = 30_000

export function useTeamStoreBadge(): number {
  const { invoke: getConfig } = useIpcInvoke('team-registry:config-get')
  const { invoke: listAssetUpdates } = useIpcInvoke('team-registry:list-asset-updates')
  const { invoke: listSkillUpdates } = useIpcInvoke('team-registry:list-updates')
  const { invoke: listMcpUpdates } = useIpcInvoke('team-registry:list-mcp-updates')
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    let busy = false
    let lastRefreshAt = 0
    const refresh = async (trigger: 'mount' | 'poll' | 'focus') => {
      if (busy) return
      if (trigger === 'focus' && Date.now() - lastRefreshAt < FOCUS_REFRESH_MIN_INTERVAL_MS) return
      busy = true
      try {
        const cfg = await getConfig({})
        if (!alive) return
        if (!cfg.snapshot.configured) {
          setCount(0)
          return
        }
        const [uwf, uag, uap, usk, umc] = await Promise.allSettled([
          listAssetUpdates({ assetType: 'workflow' }),
          listAssetUpdates({ assetType: 'agent' }),
          listAssetUpdates({ assetType: 'app' }),
          listSkillUpdates({}),
          listMcpUpdates({}),
        ])
        if (!alive) return
        const n = (r: PromiseSettledResult<{ updates: Array<{ state: string }> }>): number =>
          r.status === 'fulfilled'
            ? r.value.updates.filter((u) => u.state === 'remote-newer').length
            : 0
        setCount(n(uwf) + n(uag) + n(uap) + n(usk) + n(umc))
      } catch {
        // 角标是增强信息：失败保持上次值
      } finally {
        busy = false
        lastRefreshAt = Date.now()
      }
    }
    void refresh('mount')
    const timer = window.setInterval(() => void refresh('poll'), 90_000)
    const onFocus = () => void refresh('focus')
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [getConfig, listAssetUpdates, listSkillUpdates, listMcpUpdates])

  return count
}
