export function providerFilesErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/401|api key|auth/i.test(message)) return 'xAI API Key 无效或未配置，请在当前 Provider 中检查凭据。'
  if (/403|forbidden|permission/i.test(message)) return 'xAI API Key 没有 Files 权限，请检查团队和密钥权限范围。'
  if (/429|rate.?limit/i.test(message)) return 'xAI Files 请求过于频繁，请稍后重试。现有列表已保留。'
  return `xAI Files 请求失败：${message}`
}
