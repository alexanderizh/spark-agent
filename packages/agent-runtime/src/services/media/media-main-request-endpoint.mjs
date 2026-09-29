/**
 * media-main-request-endpoint.mjs — 渠道「完整 URL」的主调用地址解析（纯 JS）。
 *
 * spark_media MCP 子进程无法复用 TS 版 provider profile，因此这里保留一份与
 * `media-router.service.ts` 中 `fullUrlMainEndpoint()` / 主调用改写同语义的实现：
 *
 *   - 开关关闭（缺省）：返回调用方按 baseUrl 派生的地址，行为完全不变；
 *   - 开关打开：返回用户所填的 baseUrl 原文，主调用不再做任何路径拼接。
 *
 * 只用于**主调用**（生成/提交）。上传、下载、异步轮询、取件等从属请求继续按
 * baseUrl 派生——异步任务型渠道开启后可能轮询失效，「模型渠道」表单已给出提示。
 */

export function resolveMainRequestUrl(config, defaultUrl) {
  if (config?.apiEndpointFullUrl !== true) return defaultUrl
  const configured = String(config.baseUrl || '').trim()
  return configured || defaultUrl
}
