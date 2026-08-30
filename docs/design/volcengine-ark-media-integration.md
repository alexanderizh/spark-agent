# 火山方舟多媒体与 Files 集成说明

> 状态: 已落地 | 最后核对: 2026-08-09

## Seedance 2.5

内置模型 ID 为 `doubao-seedance-2-5-260628`，与 Seedance 2.0 共用异步内容生成接口：

- endpoint：`POST /contents/generations/tasks`，任务完成后轮询同路径的任务 ID。
- 输入：文生视频、首帧/首尾帧、多模态参考、视频编辑和视频延长。
- 参考素材上限：30 张图片、10 段视频、10 段音频，三类合计最多 50 个。
- 输出：480p/720p；比例为 21:9、16:9、4:3、1:1、3:4、9:16 或 adaptive；时长 4–30 秒或 `-1` 自动选择；格式支持 mp4/mov。
- 官方能力概览未给出 2.5 参考视频/音频的单段或合计时长上限，客户端不套用 2.0 的 15 秒限制，交由 Ark 服务端按当前账号能力校验。
- Seedance 2.0 仍保持 9/3/3、总计 15 个参考素材和 4–15 秒限制，不能套用 2.5 的参数。

模型默认切换为 2.5；账号尚未开通时，需在 Provider 配置中改用 2.0、2.0 Fast 或 2.0 Mini。模型未开通属于火山方舟账号权限问题，不应通过降级参数绕过。

## 输入文件路径

Seedance/Seedream 生成接口的 `content[]` / `image` 字段使用媒体 URL、data URL 或 `asset://` 私域素材 URI；火山 Files API 返回的 `file_id` 不能直接作为 Seedance/Seedream 生成引用，但 Files 文件对象会返回官方预签名 `download_url`，运行时会先完成一次官方解析。因此运行时遵循以下顺序：

1. 已有 HTTPS、data URL 或 `asset://` 时直接使用。
2. 本地图片、视频和音频优先通过火山 Files API 上传，等待 `active` 后使用官方预签名 `download_url`。
3. Files 上传失败时，图片和音频回退为 data URL；视频回退到已配置的公开上传器生成 HTTPS 引用，没有可用上传器则返回明确的认证/输入错误。
4. 有 `file_id` 时先调用 `GET /files/{file_id}`，必要时等待 `active`，取官方 `download_url` 后再传给生成接口；绝不把 `file_id` 伪装成 URL，也不把本地路径发送给渠道。
5. Files 解析失败时，若节点仍保留显式 URL、data URL 或本地源，按同一安全物化规则回退；没有可回退来源则返回带 file_id、HTTP 状态和官方错误的明确失败。

## Ark Files 管理

桌面端 Files 页面使用火山官方 `Files API`：

- `GET /files` 列表、`GET /files/{file_id}` 查询（含 `download_url`）、`POST /files` 上传/导入、`DELETE /files/{file_id}` 删除。
- 默认请求 `purpose=user_data`，支持本地文件、HTTP/HTTPS URL、TOS URI、过期时间和视频预处理参数。
- 处理中的文件会在页面自动轮询；“查看详情”展示官方文件对象，包含状态、TOS 位置、过期时间、预签名下载地址和预处理结果。
- 早期已保存且缺少 `mediaProvider` 的火山图片/视频 Provider，会依据官方 Ark endpoint + Seedream/Seedance 模型类型恢复为 `volcengine-ark`；仅凭 Ark hostname 的聊天 Provider 不会被误纳入 Files 页面。

Files API 资源属于当前火山项目，不能当作 Spark 画布导出附件。若要给 Seedance 生成任务提供素材，应使用上面的生成接口支持的媒体引用方式；若要在 Chat/Responses 中使用文件，则通过 Files 页面管理并等待状态为 `active`。

## 官方来源

- [Seedance 2.5 能力概览](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2607688?lang=zh)
- [创建视频生成任务](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1520757?lang=zh)
- [Files API 上传文件](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870405?lang=zh)
- [Files API 检索文件](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870406?lang=zh)
- [Files API 查询文件列表](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870407?lang=zh)
- [Files API 删除文件](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870408?lang=zh)
- [The file object](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1873424?lang=zh)
- [可信素材库与 asset:// 素材 URI](https://www.volcengine.com/docs/82379/2315856?lang=en)
