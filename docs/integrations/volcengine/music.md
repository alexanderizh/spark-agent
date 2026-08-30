> 抓取日期: 2026-08-11 | 来源: https://www.volcengine.com/docs/6561/2550782 (音频生成HTTP) | 渠道: 火山引擎方舟 Volcengine Ark（豆包大模型语音） | 抓取方式: getDocDetail API（`https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=2550782`，返回 JSON `.Result.MDContent`）

# 豆包音频生成（自然语言音频/音效/音乐生成）

说明：火山引擎「豆包语音」产品库（LibraryID=6561）下未提供独立的"音乐生成"产品/模型，但提供了基于自然语言描述生成音频的 `seed-audio-1.0` 模型接口，支持音效、人声、配乐等通用音频生成，最长输出 120s。文档原文保留如下。


---

## 音频生成 HTTP（seed-audio-1.0）

> 文档ID: 2550782 | URL: https://www.volcengine.com/docs/6561/2550782 | 标题: 音频生成HTTP | MDContent长度: 4901

基于 HTTP 协议的非流式音频生成接口。支持上传多个参考音频或图片生成音频，并可通过自然语言描述生成所需音效、音色等，适用于有声书、配音、游戏等场景。

当前最长支持120s音频输出。

&nbsp;

<span data-label="purple">POST</span> `https://openspeech.bytedance.com/api/v3/tts/create`


<span id="FB4hcqC8"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取。

[新版控制台](https://console.volcengine.com/speech/new?_vtm_=a106466.b106468.0_0.0_0.0.844_7636990835414320667)使用 `X-Api-Key` 单头鉴权，[旧版控制台](https://console.volcengine.com/speech/app)使用 `X-Api-App-Id` + `X-Api-Access-Key` 双头鉴权，参考示例详见：[旧版控制台鉴权参考示例](https://www.volcengine.com/docs/6561/2534847?lang=zh)。

注意：旧版控制台后续会下线，建议尽快切换到[新版控制台](https://console.volcengine.com/speech/new?_vtm_=a106466.b106468.0_0.0_0.0.844_7636990835414320667)获取 API Key。



**X\-Api\-Request\-Id ** `string` 

客户端请求追踪ID。建议传入您内部系统的 `TraceID`或者使用`UUID`生成，用于跨系统关联。




<span id="sFZZSkH5"></span>
### 请求体


**model ** `string` <span data-api-tag="require|1xsfFA">必选</span>

模型版本标识，当前支持模型如下：


* **`seed-audio-1.0`** 

   * 支持 `中文` `英文` `日语` `韩语` `墨西哥-西班牙语` `西班牙语` `德语` `法语` `巴西-葡萄牙语` `泰语` `越南语` `马来语` `菲律宾语` `意大利语` `俄语` `荷兰语` `波兰语` `土耳其语`

   * 支持时间轴控制能力，支持通过`text_prompt`使用自然语言描述控制生成音频的总时长、人声说话的具体时间



**text_prompt ** `string` <span data-api-tag="require|1xsfFA">必选</span>

用于合成音频的 Prompt或者待合成的文本内容，最大支持3000字符。

当前支持以下生成模式：


* **纯文本生成**：按 `text_prompt` 中的提示词生成音频。

* **参考音频生成**：可通过 `@音频N` 引用 `references` 中对应位置的音频参考资源；编号按上传顺序从 1 开始，即第一段参考音频为 `@音频1`，第二段为 `@音频2`，以此类推。

* **参考图片生成**：使用图片参考时，`text_prompt`可只传入待合成的文本内容。


支持语种：

> 参考 `model` 参数描述的支持语种信息



**references ** `object list`

参考资源列表，根据传入内容自动匹配生成模式：


* **纯文本生成**：不传参考资源，按 `text_prompt` 中的提示词生成音频。

* **参考音频生成**：传入音频参考，结合参考音频和 `text_prompt` 中的提示词生成音频，其中音频支持通过音色ID指定。

* **参考图片生成**：传入图片参考，按 `text_prompt` 中的合成文本生成音频。


注意：


* 音频的排列顺序与 Prompt 中 `@音频N` 的编号对应，即第一条音频为 `@音频1`，以此类推。

* 最多支持三条参考音频，参考音频每条最长支持30秒，大小不超过10 MB，参考音频格式：`wav`/`mp3`/`pcm`/`ogg_opus`。

* 仅支持一张参考图片，大小不超过10 MB，参考图片格式：`jpeg`/`png`/`webp`。

* 参考资源支持以下形式组合

   * 纯文本生成

   * 文本 + 图片

   * 文本 + 音频



**speaker ** `string`

音色ID，可使用["豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544?lang=zh)或者声音复刻音色。

**注意**：`speaker`、 `audio_data`、`audio_url` 参数互斥，仅需填写其中一个。



**audio_data** `string`

参考音频 Base64 编码。

**注意**：`speaker`、 `audio_data`、`audio_url` 参数互斥，仅需填写其中一个。



**audio_url** `string`

参考音频 URL，引用远端音频时填写。

**注意**：`speaker`、 `audio_data`、`audio_url` 参数互斥，仅需填写其中一个。



**image_data** `string`

参考图片 Base64 编码。

**注意**：


* 该参数与`image_url`互斥，仅需填写其中一个。

* 图片参考不能与音频参考混用，即`image_data` 参数不能与`audio_data` 或`audio_url` 或 `speaker`同时使用。



**image_url** `string`

参考图片URL。

**注意**：


* 该参数与`image_data`互斥，仅需填写其中一个。

* 图片参考不能与音频参考混用，即`image_url` 参数不能与`audio_data` 或`audio_url` 或 `speaker`同时使用。




**audio_config** `object`

输出音频配置。


**format ** `string`

输出音频格式格式。

可选值：`wav`/`mp3`/`pcm`/`ogg_opus`

默认值： `wav`



**sample_rate** `int`

输出采样率。

默认值： `40000`

可选值：[`8000`,`16000`,`24000`,`32000`,`44100`,`48000`]。



**speech_rate** `int`

语速，取值越大，语速越快。

取值范围：[`-50`,`100`]

`100`代表2.0倍速，`-50`代表0.5倍速，默认为`0`，默认不调整语速。



**loudness_rate** `int`

音量，取值越大，音量越大。

取值范围：[`-50`,`100`]

`100`代表2.0倍音量，`-50`代表0.5倍音量，默认为`0`，默认不调整音量。



**pitch_rate** `int`

音调，取值越大，音调越高

取值范围：[`-12`,`12`]

默认为`0`，默认不调整音调。



**enable_subtitle** `bool`

是否开启字幕服务，开启后，返回字级别的时间戳

可选值：`true`, `false`

默认值：`false`




**watermark** `object`

水印配置，不传时默认不添加。


**aigc_watermark** `bool`

显式水印开关，在合成结尾增加音频节奏标识，默认值： `False`。



**aigc_metadata ** `object`

隐式水印，在合成音频 header 加入元数据，不传时默认不添加。


**enable** `bool`

是否启用隐式水印

默认值： `False`。



**content_producer** `string`

合成服务提供者的名称或编码。



**produce_id** `string`

内容制作编号。



**content_propagator** `string`

内容传播服务提供者的名称或编码。



**propagate_id** `string`

内容传播编号。






<span id="F652Nkyz"></span>
### 响应头


**X\-Tt\-Logid ** `string`

服务端返回的 `Logid`，用于在咨询或者反馈时定位问题。




<span id="a3OkyUqJ"></span>
### 响应体


**code ** `int`

错误状态码。

如需了解更多状态码的具体含义，可查阅[错误码查询文档](https://www.volcengine.com/docs/6561/2534853?lang=zh#2u2ql30k)。



**message ** `string`

错误状态详情。

如需了解更多状态详情的具体含义，可查阅[错误码查询文档](https://www.volcengine.com/docs/6561/2534853?lang=zh#2u2ql30k)。



**audio ** `string`

合成音频数据，Base64 编码。



**duration ** `float`

处理后音频时长（秒），变速/后处理时可能跟 `original_duration` 不同，计费以 `original_duration` 为准。



**original_duration ** `float`

模型输出原始音频时长（秒），也是计费使用的时长，上限为120s。



**url ** `string`

带过期时间的音频地址，有效期2小时。



**subtitle ** `object`

音频字幕信息，只有audio_config.enable_subtitle 为true 时才有值


**text ** `string`

音频对应的字幕文本



**sentences ** `object list`

子句字幕信息


**start_time ** `int`

该句起始时间，距离音频开始的毫秒偏移值。



**end_time ** `int`

该句结束时间，距离音频开始的毫秒偏移值。



**text ** `string` ** ** 

该句的完整文本。



**words ** `object list`

词粒度


**start_time ** `int`

该 token 起始时间，距离音频开始的毫秒偏移值。



**end_time ** `int`

该 token 结束时间，距离音频开始的毫秒偏移值。



**text ** `string` ** ** 

该 token 的文本内容。







