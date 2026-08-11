> 抓取日期: 2026-08-11 | 来源: https://www.volcengine.com/docs/6561 (豆包语音 / Doubao Voice, LibraryID=6561) | 渠道: 火山引擎方舟 Volcengine Ark（豆包大模型语音） | 抓取方式: 文档库遍历 + 关键词检索（在 ASR 大模型相关接口的参数表中提取说话人分离字段）

# 说话人分离（Speaker Diarization）

## 结论：豆包语音库未提供独立的"说话人分离"API

经过对火山引擎「豆包语音」产品库（LibraryID=6561，共 245 篇文档）的全量遍历与关键词检索（`speaker` / `diariz` / `说话人` / `分离` / `spk`），未发现独立的"说话人分离"产品或单独的 endpoint。该能力以**参数形式内嵌于语音识别大模型的相关接口**，需在调用 ASR 接口时通过请求参数开启。

文档未提及：独立的"说话人分离 / 声纹比对 / 说话人注册" REST API（豆包语音产品库 6561 内未检索到）。

## 内嵌提供说话人分离能力的接口

### 1. 录音文件识别标准版（任务提交 HTTP）

- 完整文档：见本目录 `asr-transcription.md` 中「录音文件识别标准版 - 任务提交 HTTP」（docId=2606791，URL https://www.volcengine.com/docs/6561/2606791）
- endpoint：`POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit`

相关请求参数（原文摘录）：

**enable_speaker_info** `bool`
启用说话人分离参数，默认为 `false`
开启后需指定 `ssd_version`，并将 `show_utterances` 设置为 `true`，才能获取到说话人分离结果

**ssd_version** `string`
指定说话人分离场景对应的模型版本，可选值如下：
* `200`：
   * 说话人数量建议不超过 5 人
   * 适用于**非会议场景**
   * 需将 `enable_speaker_info` 和 `show_utterances` 设置为 `true`
* `300`：
   * 使用声纹匹配能力
   * 适用于长音频会议场景，包括线上会议、录音笔、录音卡、笔记 App 等**多人说话场景**
   * 需将 `enable_speaker_info` 和 `show_utterances` 设置为 `true`

**ssd_mode** `int`
指定说话人分离模式，仅 `ssd_version: 200` 模型支持该参数。可选值如下：
* `0`: 普通模式（默认），适用于 3 分钟以内、说话人数小于 5 的短音频
* `1`: 聚类模式，适用于 3 分钟以上的长音频，如售车、售房、一对多销售等非会议场景

### 2. 单向流式语音识别 WebSocket

- 完整文档：见本目录 `asr-transcription.md` 中「单向流式语音识别 WebSocket」（docId=2628951，URL https://www.volcengine.com/docs/6561/2628951）
- endpoint：`WSS wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`

请求参数（原文摘录）：

**enable_speaker_info** `bool`
说话人分离。开启后可返回说话人信息，默认为 `false`

**ssd_version** `string`
说话人分离场景对应的模型版本。使用后，返回的内容里包含说话人，推荐搭配**豆包流式语音识别模型 2.0** 使用

**ssd_mode** `int`
指定说话人分离模式，仅 `ssd_version: 200` 模型支持该参数。可选值如下：
* `0`: 普通模式（默认），适用于 3 分钟以内、说话人数小于 5 的短音频
* `1`: 聚类模式，适用于 3 分钟以上的长音频，如售车、售房、一对多销售等非会议场景

响应字段（原文摘录）：

**speaker_id** `string`
说话人 ID。开启说话人分离 `enable_speaker_info=true` 后返回

### 3. 双向流式语音识别 WebSocket

- 完整文档：见本目录 `asr-transcription.md` 中「双向流式语音识别 WebSocket」（docId=2630027，URL https://www.volcengine.com/docs/6561/2630027）
- endpoint：`WSS wss://openspeech.bytedance.com/api/v3/sauc/bigmodel双向`

请求参数与单向流式相同（`enable_speaker_info` / `ssd_version` / `ssd_mode`），响应字段中同样包含 `speaker_id`。

### 4. 录音文件识别极速版 / 闲时版

- 极速版（docId=2608628，URL https://www.volcengine.com/docs/6561/2608628）与闲时版（docId=2608618 提交 / 2608619 查询）的 MDContent 中**未出现** `enable_speaker_info` / `ssd_version` / `ssd_mode` 字段；文档未提及是否支持说话人分离。

## 产品简介对照

豆包语音识别大模型「产品简介」（docId=1354871）中标注**自动说话人分离（中英文）** 在大模型流式识别、录音文件识别各版本中支持情况如下（原文表格摘录）：

| 能力 | 大模型流式识别 | 录音文件识别标准版 | 录音文件识别极速版 | 录音文件识别闲时版 |
|---|---|---|---|---|
| 自动说话人分离（中英文） | ✅ | ✅ | ✅ | ✅ |

注：上表为产品简介中的对照表，实际字段定义以各接口文档为准（极速版/闲时版接口文档未给出 `enable_speaker_info` 字段，可能由服务端默认开启或通过其他参数控制，文档未提及细节）。
