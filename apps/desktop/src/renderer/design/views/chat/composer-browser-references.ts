/**
 * composer-browser-references — 浏览器「选择元素加入会话」的引用状态。
 *
 * 与 composer-code-references 完全同构：组件内按 draft bucket（= 会话路由）
 * 分桶存储，实现会话隔离——切换会话时引用互不串扰，随会话草稿一起清空。
 * 发送时由 ComposerV2 把引用序列化为 agent 可执行的文本块（页面 URL + CSS
 * 选择器 + 元素摘要），配合 spark_browser 工具 agent 可直接定位该元素。
 */
import { useCallback, useState } from 'react'
import type { SetStateAction } from 'react'
import type { BrowserElementReference } from '../../components/browser/elementPickerScript'

export type { BrowserElementReference }

export type ComposerBrowserReferenceMap = Record<string, BrowserElementReference[]>

export function updateComposerBrowserReferenceBucket(
  current: ComposerBrowserReferenceMap,
  bucket: string,
  next: SetStateAction<BrowserElementReference[]>,
): ComposerBrowserReferenceMap {
  const base = current[bucket] ?? []
  const resolved = typeof next === 'function' ? next(base) : next
  if (resolved === base) return current
  if (resolved.length === 0) {
    if (!(bucket in current)) return current
    const nextByBucket = { ...current }
    delete nextByBucket[bucket]
    return nextByBucket
  }
  return { ...current, [bucket]: resolved }
}

export function useComposerBrowserReferences(bucket: string): {
  browserReferences: BrowserElementReference[]
  setBrowserReferences: (next: SetStateAction<BrowserElementReference[]>) => void
} {
  const [referencesByBucket, setReferencesByBucket] = useState<ComposerBrowserReferenceMap>({})
  const browserReferences = referencesByBucket[bucket] ?? []
  const setBrowserReferences = useCallback(
    (next: SetStateAction<BrowserElementReference[]>) => {
      setReferencesByBucket((current) =>
        updateComposerBrowserReferenceBucket(current, bucket, next),
      )
    },
    [bucket],
  )
  return { browserReferences, setBrowserReferences }
}

/** chip 标签：`<tag#id.class「文本」>` 的紧凑形式。 */
export function describeBrowserElementLabel(info: {
  tag: string
  id: string | null
  classes: string[]
  text: string | null
}): string {
  let label = info.tag
  if (info.id != null && info.id !== '') label += `#${info.id}`
  else if (info.classes.length > 0) label += `.${info.classes[0]}`
  const text = info.text?.replace(/\s+/g, ' ').trim()
  if (text != null && text !== '') {
    const clipped = text.length > 16 ? `${text.slice(0, 16)}…` : text
    label += `「${clipped}」`
  }
  return label
}

/** 发送时的文本块：给 agent 的定位信息（URL + 选择器 + 元素摘要）。 */
export function formatBrowserReferenceLine(reference: BrowserElementReference): string {
  const attrs: string[] = []
  if (reference.id_attr != null && reference.id_attr !== '') attrs.push(`id="${reference.id_attr}"`)
  if (reference.classes.length > 0) attrs.push(`class="${reference.classes.join(' ')}"`)
  const text = reference.text != null && reference.text !== '' ? reference.text : ''
  const attrText = attrs.length > 0 ? ' ' + attrs.join(' ') : ''
  const lines = [
    `[浏览器元素引用] <${reference.tag}${attrText}>${text}</${reference.tag}>`,
    `选择器: ${reference.selector}`,
    `页面: ${reference.pageUrl}`,
  ]
  if (reference.href != null && reference.href !== '') lines.push(`链接: ${reference.href}`)
  return lines.join('\n')
}
