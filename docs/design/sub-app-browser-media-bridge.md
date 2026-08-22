# 子应用内置浏览器媒体桥接设计

> 状态: 已落地 | 最后核对: 2026-08-22

## 目标

让声明了 `browser` 权限的 SparkWork 子应用使用宿主受控浏览器打开页面、检查媒体候选并下载媒体文件。默认优先使用本机 Chrome/Edge 的独立持久化配置，系统浏览器不可用时回退到内置浏览器；子应用不直接接触 Electron、文件系统或浏览器会话。

## 调用链

```text
sparkApp.browser.*
  → iframe postMessage
  → SubAppBridgeHost 权限/参数校验
  → renderer window.spark.invoke
  → main IPC
  → SubAppBrowserService
  → SystemBrowserService / InternalBrowserService
```

宿主提供以下子应用专用 IPC 通道：

- `browser:sub-app-open`
- `browser:sub-app-inspect-media`
- `browser:sub-app-download`
- `browser:sub-app-close`
- `browser:sub-app-open-download`
- `browser:sub-app-open-download-folder`

## 子应用 API

manifest 必须声明：

```json
{ "permissions": ["browser"] }
```

推荐调用顺序：

```js
const opened = await sparkApp.browser.open(url, {
  profileId: 'video-downloader-main',
  reuse: true,
  backend: 'system',
})
const inspection = await sparkApp.browser.inspectMedia(opened.windowId)
const candidate = inspection.candidates.find((item) => item.kind === 'mp4')
if (candidate) {
  const downloaded = await sparkApp.browser.download(opened.windowId, candidate.url, 'video.mp4')
  await sparkApp.browser.close(opened.windowId)
  await sparkApp.browser.openDownload(downloaded.path)
}
```

`inspectMedia` 同时检查页面真实的 `video` / `source` 节点和宿主记录的网络媒体请求。网络请求按页面导航周期清理，并利用 Electron 的 `resourceType: media` 与响应 MIME 类型识别无 `.mp4` 后缀的媒体地址。`download` 只接受当前页面最近一次检查确认的 `http(s)` 地址，并使用该页面所属 profile 的会话下载。

`backend` 可取 `system`、`internal` 或 `auto`。`system`/`auto` 使用 Playwright 启动本机 Chrome/Edge 的独立可见窗口，配置目录位于 SparkWork 用户数据目录下的 `browser-profiles/<profileId>`，用于长期保留登录态但不接管用户日常浏览器 profile；`auto` 或默认模式在系统浏览器缺失/启动失败时回退内置浏览器。系统浏览器下载使用同一浏览器上下文的 cookies、Referer 与 User-Agent 请求保存到系统 Downloads 目录。

`close` 用于任务成功后关闭独立浏览器窗口。`openDownload` 只允许打开系统 Downloads 目录下的文件，`openDownloadFolder` 只打开系统 Downloads 目录；两者均由主进程做路径边界校验，子应用不能打开任意本地路径。验证、登录或播放期间应用可以保留窗口，供用户手动介入。

## 边界

- `browser.openUrl` 仍用于系统外部浏览器打开普通链接；媒体抓取必须使用 `browser.open`。
- 子应用不能通过 API 访问 Electron 或本地文件系统；浏览器会话由宿主 profile 管理。
- 运行中的旧 SparkWork 构建不会因为子应用源码更新而自动获得该能力，必须使用包含上述宿主桥接代码的桌面构建。
