import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { shell } from 'electron'

export async function openExternalPostForm(
  action: string,
  fields: Record<string, string>,
): Promise<void> {
  const target = new URL(action)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('支付表单地址协议不安全')
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'spark-payment-'))
  const filePath = path.join(directory, 'pay.html')
  await writeFile(filePath, buildExternalPostFormHtml(target.toString(), fields), {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    await shell.openExternal(pathToFileURL(filePath).toString())
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  const cleanup = setTimeout(() => {
    void rm(directory, { recursive: true, force: true })
  }, 5 * 60 * 1000)
  cleanup.unref()
}

export function buildExternalPostFormHtml(
  action: string,
  fields: Record<string, string>,
): string {
  const target = new URL(action)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('支付表单地址协议不安全')
  }
  const nonce = randomBytes(16).toString('base64')
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; form-action ${escapeHtml(target.origin)}"><title>Spark 支付跳转</title><style>body{font-family:system-ui;padding:40px;color:#222}</style></head><body><p>正在安全跳转到支付页面…</p><form method="POST" action="${escapeHtml(target.toString())}">${inputs}<noscript><button type="submit">继续支付</button></noscript></form><script nonce="${nonce}">document.forms[0].submit()</script></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
