import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { me } from './auth'
import { object } from './relay'

// Match the mini-program's 40-code-point limit without importing its wx storage adapter.
function normalizeDeviceAlias(value: string) {
  return Array.from(value.trim()).slice(0, 40).join('')
}

export function useDeviceAliases(token: string) {
  const [user, setUser] = useState<Awaited<ReturnType<typeof me>>>()
  const [store, setStore] = useState<{
    token: string
    key: string
    aliases: Record<string, string>
  }>()
  const current = store?.token === token ? store : undefined

  useEffect(() => {
    let active = true
    void me(token)
      .then(async (profile) => {
        if (!active) return
        setUser(profile)
        const scope = await digestStringAsync(CryptoDigestAlgorithm.SHA256, profile.account)
        const key = `sparkwork.companion.aliases.${scope}`
        const stored = await SecureStore.getItemAsync(key)
        let parsed: unknown
        try {
          parsed = stored ? JSON.parse(stored) : null
        } catch {
          // A malformed local alias map must not prevent setting new aliases.
        }
        const aliases = Object.fromEntries(
          Object.entries(object(parsed) ?? {}).flatMap(([id, value]) => {
            const alias = typeof value === 'string' ? normalizeDeviceAlias(value) : null
            return id && alias ? [[id, alias]] : []
          }),
        )
        if (active) setStore({ token, key, aliases })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [token])

  function aliasFor(id: string) {
    return current && Object.hasOwn(current.aliases, id) ? current.aliases[id] : undefined
  }

  async function saveAlias(id: string, value: string) {
    if (!current) throw new Error('备注名存储暂不可用')
    const alias = normalizeDeviceAlias(value)
    const aliases = alias ? { ...current.aliases, [id]: alias } : { ...current.aliases }
    if (!alias) delete aliases[id]
    await SecureStore.setItemAsync(current.key, JSON.stringify(aliases))
    setStore({ ...current, aliases })
  }

  return { user, ready: !!current, aliasFor, saveAlias }
}
