import { useEffect } from 'react'
import { absoluteUrl, defaultSeo, PageSeo, softwareJsonLd } from '../lib/seo'

export function Seo({ seo = defaultSeo, jsonLd }: { seo?: PageSeo; jsonLd?: object }) {
  useEffect(() => {
    document.title = seo.title
    setMeta('description', seo.description)
    setMeta('keywords', seo.keywords.join(', '))
    setMeta('og:title', seo.title, 'property')
    setMeta('og:description', seo.description, 'property')
    setMeta('og:type', 'website', 'property')
    setMeta('og:url', absoluteUrl(seo.path), 'property')
    setMeta('twitter:card', 'summary_large_image')
    setLink('canonical', absoluteUrl(seo.path))
    setJsonLd(jsonLd ?? softwareJsonLd())
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
