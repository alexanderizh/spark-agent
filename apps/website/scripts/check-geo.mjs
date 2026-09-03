#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const siteUrl = 'https://spark.yiqibyte.com'

async function main() {
  const sitemap = await readFile(resolve(dist, 'sitemap.xml'), 'utf8')
  assert(!sitemap.includes('spark-agent.dev'), 'Sitemap 仍包含旧域名')
  assert(!sitemap.includes('/docs/search'), 'Sitemap 不应包含文档搜索页')

  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])
  assert(urls.length > 10, 'Sitemap 可索引页面数量异常')
  assert(new Set(urls).size === urls.length, 'Sitemap 存在重复 URL')

  for (const url of urls) {
    assert(url.startsWith(siteUrl), `非官方域名 URL: ${url}`)
    const path = url.slice(siteUrl.length) || '/'
    await checkPage(path, true)
  }
  await checkPage('/docs/search', false)
  await checkPage('/404', false)

  const robots = await readFile(resolve(dist, 'robots.txt'), 'utf8')
  assert(robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`), 'robots.txt Sitemap 地址错误')
  const llms = await readFile(resolve(dist, 'llms.txt'), 'utf8')
  const llmsFull = await readFile(resolve(dist, 'llms-full.txt'), 'utf8')
  assert(llms.includes(`${siteUrl}/docs`), 'llms.txt 缺少文档入口')
  assert(llmsFull.length > 10_000, 'llms-full.txt 正文过短')
  assert(!`${llms}\n${llmsFull}`.includes('spark-agent.dev'), 'LLM 抓取文件仍包含旧域名')
  console.log(`[geo-check] ok — ${urls.length} 个可索引页面 + 2 个 noindex 页面`)
}

async function checkPage(path, indexable) {
  const file =
    path === '/'
      ? resolve(dist, 'index.html')
      : path === '/404'
        ? resolve(dist, '404.html')
        : resolve(dist, path.slice(1), 'index.html')
  const html = await readFile(file, 'utf8')
  const expectedCanonical = `${siteUrl}${path === '/' ? '' : path}`
  assert(
    html.includes(`<link rel="canonical" href="${expectedCanonical}"`),
    `${path} canonical 错误`,
  )
  assert(/<title>[^<]{4,}<\/title>/.test(html), `${path} 缺少独立 title`)
  assert(/<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/.test(html), `${path} 缺少 H1`)
  assert(
    html.includes(`name="robots" content="${indexable ? 'index' : 'noindex'}, follow"`),
    `${path} robots 错误`,
  )
  assert(!html.includes('spark-agent.dev'), `${path} 仍包含旧域名`)
  const rootStart = html.indexOf('<div id="root">')
  const bodyEnd = html.lastIndexOf('</body>')
  const rootHtml =
    rootStart >= 0 && bodyEnd > rootStart
      ? html.slice(rootStart + '<div id="root">'.length, bodyEnd)
      : ''
  assert(rootHtml.replace(/<[^>]+>/g, '').trim().length > 200, `${path} 首个 HTML 正文过短`)
  const json = html.match(
    /<script type="application\/ld\+json" id="structured-data">([\s\S]*?)<\/script>/,
  )?.[1]
  assert(Boolean(json), `${path} 缺少 JSON-LD`)
  JSON.parse(json)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

main().catch((error) => {
  console.error('[geo-check]', error.message)
  process.exitCode = 1
})
