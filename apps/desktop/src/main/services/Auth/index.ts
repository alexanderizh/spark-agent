/**
 * AuthService — 对接 spark-edugen/edu-server 的登录/注册/微信扫码能力
 *
 * 目录结构：
 *   - EduServerClient.ts  HTTP 客户端（fetch + 401 refresh 重试）
 *   - TokenStore.ts       keytar 安全存储 + 内存缓存
 *   - AuthService.ts      业务编排（登录/注册/微信扫码流程）
 *   - registerAuthIpc.ts  IPC handlers 注册
 *   - types.ts            内部类型
 *
 * 设计目标：
 *   - 桌面端无需自建后端认证服务，全部走 edu-server /api/v1/*
 *   - token 持久化用 keytar（macOS Keychain / Windows Credential Manager）
 *   - access token 失效时自动用 refreshToken 续期，对渲染端透明
 *   - refreshToken 也失败时推送 `stream:auth:session-expired` 让渲染端跳登录页
 */

export {}
