#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prerenderDir = resolve(websiteRoot, '.prerender')
const distDir = resolve(websiteRoot, 'dist')
const publicDir = resolve(websiteRoot, 'public')

async function main() {
  await rm(prerenderDir, { recursive: true, force: true })
  try {
    await run('pnpm', ['exec', 'tsc', '--noEmit'])
    await run('pnpm', [
      'exec',
      'vite',
      'build',
      '--ssr',
      'src/entry-server.tsx',
      '--outDir',
      '.prerender',
    ])

    const serverEntry = resolve(prerenderDir, 'entry-server.js')
    const server = await import(`${pathToFileURL(serverEntry).href}?t=${Date.now()}`)
    const renderedPages = Object.fromEntries(
      server.routeManifest.map((route) => [route.path, server.renderPage(route.path)]),
    )
    const discoveryFiles = server.createDiscoveryFiles(renderedPages)
    await Promise.all(
      Object.entries(discoveryFiles).map(([name, content]) =>
        writeFile(resolve(publicDir, name), content, 'utf8'),
      ),
    )

    await run('pnpm', ['exec', 'vite', 'build'])
    const template = await readFile(resolve(distDir, 'index.html'), 'utf8')
    await Promise.all(
      server.routeManifest.map(async (route) => {
        const outputPath = routeOutputPath(route.path)
        await mkdir(dirname(outputPath), { recursive: true })
        await writeFile(outputPath, injectPage(template, renderedPages[route.path]), 'utf8')
      }),
    )
    await run(process.execPath, ['scripts/check-geo.mjs'])
  } finally {
    await rm(prerenderDir, { recursive: true, force: true })
  }
}

function routeOutputPath(path) {
  if (path === '/') return resolve(distDir, 'index.html')
  if (path === '/404') return resolve(distDir, '404.html')
  return resolve(distDir, path.slice(1), 'index.html')
}

function injectPage(template, page) {
  const canonical = page.canonical
  const jsonLd = JSON.stringify(page.jsonLd).replace(/</g, '\\u003c')
  const head = [
    `    <meta name="keywords" content="${escapeAttribute(page.seo.keywords.join(', '))}" />`,
    `    <meta name="robots" content="${escapeAttribute(page.seo.robots ?? 'index, follow')}" />`,
    `    <link rel="canonical" href="${escapeAttribute(canonical)}" />`,
    `    <meta property="og:title" content="${escapeAttribute(page.seo.title)}" />`,
    `    <meta property="og:description" content="${escapeAttribute(page.seo.description)}" />`,
    '    <meta property="og:type" content="website" />',
    `    <meta property="og:url" content="${escapeAttribute(canonical)}" />`,
    '    <meta name="twitter:card" content="summary_large_image" />',
    `    <script type="application/ld+json" id="structured-data">${jsonLd}</script>`,
  ].join('\n')

  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeText(page.seo.title)}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${escapeAttribute(page.seo.description)}" />`,
    )
    .replace('  </head>', `${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${page.html}</div>`)
}

function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, '&quot;')
}

function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: websiteRoot, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`))
    })
  })
}

main().catch((error) => {
  console.error('[website-build]', error)
  process.exitCode = 1
})
