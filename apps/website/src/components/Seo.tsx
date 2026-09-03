import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { absoluteUrl, defaultSeo, PageSeo, softwareJsonLd } from '../lib/seo'

export interface SeoPayload {
  seo: PageSeo
  jsonLd: object
}

const SeoCollectorContext = createContext<((payload: SeoPayload) => void) | null>(null)

export function SeoCollectorProvider({
  children,
  collect,
}: {
  children: ReactNode
  collect: (payload: SeoPayload) => void
}) {
  return <SeoCollectorContext.Provider value={collect}>{children}</SeoCollectorContext.Provider>
}

export function Seo({ seo = defaultSeo, jsonLd }: { seo?: PageSeo; jsonLd?: object }) {
  const collect = useContext(SeoCollectorContext)
  const payload = { seo, jsonLd: jsonLd ?? softwareJsonLd() }

  // SSR/SSG 时由 provider 同步收集本页 head；客户端没有 collector，不产生额外工作。
  collect?.(payload)

  useEffect(() => {
    document.title = seo.title
    setMeta('description', seo.description)
    setMeta('keywords', seo.keywords.join(', '))
    setMeta('robots', seo.robots ?? 'index, follow')
    setMeta('og:title', seo.title, 'property')
    setMeta('og:description', seo.description, 'property')
    setMeta('og:type', 'website', 'property')
    setMeta('og:url', absoluteUrl(seo.path), 'property')
    setMeta('twitter:card', 'summary_large_image')
    setLink('canonical', absoluteUrl(seo.path))
    setJsonLd(payload.jsonLd)
  }, [seo, jsonLd])
  return null
}

function setMeta(name: string, content: string, attr = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, name)
    document.head.appendChild(el)
  }
  el.content = content
}
function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}
function setJsonLd(data: object) {
  let el = document.getElementById('structured-data') as HTMLScriptElement | null
  if (!el) {
    el = document.createElement('script')
    el.type = 'application/ld+json'
    el.id = 'structured-data'
    document.head.appendChild(el)
  }
  el.text = JSON.stringify(data)
}
