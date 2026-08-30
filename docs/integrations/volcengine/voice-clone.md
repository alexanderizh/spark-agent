> 抓取日期: 2026-08-11 | 来源: https://www.volcengine.com/docs/6561 (豆包语音 / Doubao Voice, LibraryID=6561) | 渠道: 火山引擎方舟 Volcengine Ark（豆包大模型语音） | 抓取方式: getDocDetail API（`https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=<docId>`，返回 JSON `.Result.MDContent`）

# 豆包声音复刻 / 音色设计 / 音色管理（Voice Clone & Voice Design & Voice Management）

本文档汇总火山引擎「豆包语音」产品库下"声音复刻"相关 API 与说明，原文逐段保留。所有参数名/枚举/endpoint 均来自官方原文。

文档树（来源：https://www.volcengine.com/docs/6561/2550872 「声音复刻」分组）：
- 声音复刻 产品简介 → docId 133350
- 音色训练 HTTP → docId 2534906
- 音色查询 HTTP → docId 2535742
- 音色升级 HTTP → docId 2535751
- 音色设计 HTTP → docId 2277844
- 音色管理 HTTP → docId 2235883
- 错误码查询 → docId 2534853


---

## 声音复刻 - 产品简介

> 文档ID: 133350 | URL: https://www.volcengine.com/docs/6561/133350 | 标题: 产品简介 | MDContent长度: 979

<span id="产品说明"></span>
# **产品说明**

火山引擎大模型声音复刻是使用全新自研语音大模型算法打造的高效化的轻量级音色定制方案。用户在开放环境中，只需录制**5s**数据，即可**即时**完成对用户音色、说话风格、口音和声学环境音的复刻。

<span id="产品优势"></span>
# 产品优势


* **秒级训练音频**：仅需在开放环境下录制最短**5s音频**即可快速复刻，录制成本极低。

* **秒级训练时长**：音频上传成功后，**秒级别完成模型复刻**，几乎无等待时延，可立即调用合成试听。

* **低成本调优**：如果上传的训练音频效果不满意，可以更换音频再次训练，每个音色可支持用户上传训练10次。

* **高度还原**：高度还原真人音色特点、说话风格、口音和声学环境，2.0版本对于高表现力声音，如口音、特色音色等，还原度进一步提升。

* **跨语种迁移**：录制一个语种的声音，可支持中文、英文、日语、西班牙语（墨西哥口音）、葡萄牙语（巴西口音）、印尼语多个语种的合成，让声音轻松说外语。

* **技术领先**：全新大模型技术，\*\*使用全新自研算法，提供高品质的复刻能力，效果行业领先。


<span id="应用场景"></span>
# **应用场景**


* **视频配音**：复刻特色声音，如IP、搞怪等特色化声音，为创作带来更多元更高效的方式，激发创作灵感。

* **数字人驱动**：配合数字人形象定制，实现形象+声音完整的个性化形象定制能力。

* **语音助手**：复刻独具特色的品牌人机交互音色，例如家人朋友等，作为手机助手、导航语音、游戏趣味语音等，为用户提供独特的交互体验。

* **在线教育**：复制老师音色，可以减少老师重复性，标准化讲解的工作，提升授课效能，降低老师长时间授课带来的咽喉损害。

* **有声阅读**：快速复刻家人朋友的声音，用声音来实现“分身术”，随时随地给予用户亲切、温暖的阅读陪伴，为用户打造定制化的听书体验。


<span id="产品体验"></span>
## 产品体验

请点击链接进入 声音复刻大模型 [能力体验](https://www.volcengine.com/product/voicecloning)






---

## 音色训练 HTTP

> 文档ID: 2534906 | URL: https://www.volcengine.com/docs/6561/2534906 | 标题: 音色训练HTTP | MDContent长度: 5035

上传语音样本，训练自定义语音音色，用于语音合成。

&nbsp;

<span data-label="purple">POST</span>`https://openspeech.bytedance.com/api/v3/tts/voice_clone`

以下请求头主要为[新版控制台](https://console.volcengine.com/speech/new?_vtm_=a106466.b106468.0_0.0_0.0.844_7636990835414320667)鉴权参考示例，若使用[旧版控制台](https://console.volcengine.com/speech/app)，鉴权参考示例详见：[旧版控制台鉴权参考示例](https://www.volcengine.com/docs/6561/2534847?lang=zh)。<mark>旧版控制台后续会逐步下线，建议尽快切换至</mark>[新版控制台](https://console.volcengine.com/speech/new?_vtm_=a106466.b106468.0_0.0_0.0.844_7636990835414320667)<mark>使用。</mark>


<span id="oyvg03nq"></span>
### 请求头


**Content\-Type ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

固定值："application/json"



**X\-Api\-Key ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|M22Sxg">必选</span>

标识客户端请求ID，uuid随机字符串



&nbsp;


<span id="QtgDzszh"></span>
### 请求体


**speaker_id**`string` <span data-api-tag="require|uo2J0a">必选</span>

唯一音色代号，[speaker_id获取参考](https://www.volcengine.com/docs/6561/1167802?lang=zh&_vtm_=a106466.b106468.0_0.0_0.0.902_7636990835414320667#api%E8%B0%83%E7%94%A8%E5%8F%82%E6%95%B0%E8%8E%B7%E5%8F%96)。



**custom_speaker_id**`string` 

**含义**：自定义音色代号（仅支持后付费音色，关于后付费音色下单及说明详见：[《声音复刻下单及使用指南》](https://www.volcengine.com/docs/6561/1167802?lang=zh&_vtm_=a106466.b106468.0_0.0_0.0.970_7636990835414320667)）。

**<mark>注意</mark>**<mark>：首次调用合成接口即视为 “转正” 并</mark>**<mark>收取音色槽位费</mark>**<mark>，请务必在确认试听效果满意后再进行正式合成！</mark>

<span id="3OOuXUnS"></span>
### 一、 参数调用格式

使用自定义音色时，speaker_id 必须传固定值，实际自定义名称写在 custom_speaker_id 中：

```JSON
{
"speaker_id": "custom_speaker_id",   // 必须为固定值
"custom_speaker_id": "custom_zh_xxx" // 客户自定义的音色代号
}
```


<span id="Q4eq3xNa"></span>
### 二、 命名规范


* **字符与长度**：8 ~ 256 个字符，仅支持数字、大小写字母、中划线 \-、下划线 _。

* **首尾限制**：**必须以英文字母开头**；首位和末位不可为 \- 或 _。

* **唯一性**：同 accountID 维度下不可与已有 ID 重复。

* **官方防冲突**：不可与官方精品音色重名。系统会自动拦截特定的官方前缀（如 S_、MIX_）或后缀（如 _tob、_streaming）的名称。

   * 如果你的命名在[正则表达式验证网站](https://regex101.com/)匹配以下正则表达式，将被系统拦截（表示与官方音色冲突或格式不符）：


```Go
`^((?i:S_|ICL_|MIX_|DiT_|BV)|[a-z]{2}_|(?i:(wvae|moon|mercury|venus|earth|mars|jupiter|saturn|uranus|neptune|pluto|umm)_)).*|.*_(?i:bigtts|bigtts_cc|tob|cs_tob|streaming)$|^[^a-zA-Z]|.*[-_]$|^.{0,7}$|^.{257,}$|.*[^a-zA-Z0-9_-].*`
```


<span id="FCals6vl"></span>
### 三、 生命周期与计费说明

详细计费政策参见[《声音复刻下单及使用指南》](https://www.volcengine.com/docs/6561/1167802?lang=zh&_vtm_=a106466.b106468.0_0.0_0.0.970_7636990835414320667)



**audio ** `object` ** ** <span data-api-tag="require|PWufDx">必选</span>

音频格式支持：wav、mp3、ogg、m4a、aac、pcm，<mark>其中pcm仅支持24k，单通道</mark>

目前限制文件上传最大10MB


**data ** `string` ** ** <span data-api-tag="require|A9avVV">必选</span>

进制音频字节，需对二进制音频进行base64编码



**format ** `string` ** ** <span data-api-tag="require|A9avVV">必选</span>

<mark>音频格式，pcm、m4a必传</mark>，mp3、ogg、m4a、aac等其他格式可以不指定




**text**`string` 

参考文本，可让用户按照该文本念诵，服务会对比音频与该文本的差异，若差异过大会复刻失败并返回45001109 WERError。



**language** `int`

支持以下语种：

音频内容需要和语种一致


* cn = 0：中文（默认）

* en = 1：英文

* ja = 2：日语

* es = 3：西班牙语

* id = 4：印尼语

* pt = 5：葡萄牙语

* de = 6:  德语

* fr = 7: 法语

* ko = 8：韩语

* it = 9: 意大利语

* th = 10: 泰语

* vi = 11: 越南语

* ru = 12: 俄语

* fil = 13: 菲律宾语

* ms = 14: 马来语

* ar = 15: 阿拉伯语

* mx = 16: 墨西哥西班牙语

* pt\-br = 17: 巴西葡萄牙语

* pl = 19：波兰语

* tr = 20：土耳其语

* sv = 21：瑞典语


**豆包端到端实时语音模型**，支持以下语种：


* cn = 0：中文（默认）

* en = 1：英文



**extra_params ** `object` ** ** 


**demo_text** `string`

试听文本，长度在4和300字之间，如果指定了语种需要传入对应语种的文本，否则会合成失败。

**注意事项：** demo_text 文本越长，注册耗时越长，建议合理控制文本长度。



**enable_audio_denoise ** `bool`

是否开启降噪（默认False）。开启降噪可能会对声音细节有一定影响，**音频样本噪声较大的情况下建议开启降噪**，音频样本质量较好的情况下建议关闭降噪。



**disable_volume_normalization ** `bool`

是否关闭音量归一化（默认值为 false）。开启音量归一化，合成时是相对统一的音量，如果关闭音量归一化，合成出来的音量会和 prompt 更接近，和 prompt音频相似度也会更高。




<span id="BRifM1P1"></span>
# 响应


<span id="2phtbtYG"></span>
### 响应


**X\-Tt\-Logid ** `string`

服务端返回的 logid，用于在咨询或者反馈时定位问题



**code** `int`

请求状态码。请求失败时，HTTP 状态码不为 200，详情请参见[错误码参考文档](https://www.volcengine.com/docs/6561/2534853?lang=zh#ad7BnUTK)。



**message ** `string`

请求状态信息。训练失败时，会返回对应的失败说明，详情请参见[错误码参考文档](https://www.volcengine.com/docs/6561/2534853?lang=zh#ad7BnUTK)。



**available_training_times** `int`

该speaker_id剩余训练次数



**create_time ** `int`

创建时间



**language ** `int`

以下为语种对应的枚举值


* cn = 0：中文（默认）

* en = 1：英文

* ja = 2：日语

* es = 3：西班牙语

* id = 4：印尼语

* pt = 5：葡萄牙语

* de = 6:  德语

* fr = 7: 法语

* ko = 8：韩语

* it = 9: 意大利语

* th = 10: 泰语

* vi = 11: 越南语

* ru = 12: 俄语

* fil = 13: 菲律宾语

* ms = 14: 马来语

* ar = 15: 阿拉伯语

* mx = 16: 墨西哥西班牙语

* pt\-br = 17: 巴西葡萄牙语

* pl = 19：波兰语

* tr = 20：土耳其语

* sv = 21：瑞典语



**speaker_id ** `string`

唯一音色代号



**status ** `int`

训练状态，状态为2或4时都可以调用TTS语音合成接口。


* NotFound = 0

* Training = 1

* Success = 2

* Failed = 3

* Active = 4



**speaker_status**`object list`


**model_type ** `int`

复刻 2.0：`model_type = 5` 



**demo_audio ** `string`

试听音频。Success状态时返回，一小时有效，若需要，请下载后使用









---

## 音色查询 HTTP

> 文档ID: 2535742 | URL: https://www.volcengine.com/docs/6561/2535742 | 标题: 音色查询HTTP | MDContent长度: 2768

查询已训练音色的状态。

&nbsp;

<span data-label="purple">POST</span>`https://openspeech.bytedance.com/api/v3/tts/get_voice`

以下请求头主要为[新版控制台](https://console.volcengine.com/speech/new?_vtm_=a106466.b106468.0_0.0_0.0.844_7636990835414320667)鉴权参考示例，若使用[旧版控制台](https://console.volcengine.com/speech/app)，鉴权参考示例详见：[旧版控制台鉴权参考示例](https://www.volcengine.com/docs/6561/2534847?lang=zh)。<mark>旧版控制台后续会逐步下线，建议尽快切换至</mark>[新版控制台](https://console.volcengine.com/speech/new?_vtm_=a106466.b106468.0_0.0_0.0.844_7636990835414320667)<mark>使用。</mark>


<span id="vsY5GiPG"></span>
### 请求头


**Content\-Type ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

固定值："application/json"



**X\-Api\-Key ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|M22Sxg">必选</span>

标识客户端请求ID，uuid随机字符串



&nbsp;


<span id="JCP4OcxU"></span>
### 请求体


**speaker_id**`string` <span data-api-tag="require|uo2J0a">必选</span>

唯一音色代号，[speaker_id获取参考](https://www.volcengine.com/docs/6561/1167802?lang=zh&_vtm_=a106466.b106468.0_0.0_0.0.902_7636990835414320667#api%E8%B0%83%E7%94%A8%E5%8F%82%E6%95%B0%E8%8E%B7%E5%8F%96)。



**custom_speaker_id**`string` 

**含义**：自定义音色代号（仅支持后付费音色，关于后付费音色下单几说明详见：[《声音复刻下单及使用指南》](https://www.volcengine.com/docs/6561/1167802?lang=zh&_vtm_=a106466.b106468.0_0.0_0.0.970_7636990835414320667)）。

后付费声音复刻示例：

```JSON
{
"speaker_id": "custom_speaker_id", // 固定值
"custom_speaker_id": "custom_zh_xxx" // 训练接口中自定义的音色代号
}
```




<span id="9YkuGgDj"></span>
# 响应


<span id="2phtbtYG"></span>
### 响应


**X\-Tt\-Logid ** `string`

服务端返回的 logid，用于在咨询或者反馈时定位问题



**code** `int`

请求状态码。请求失败时，HTTP 状态码不为 200，详情请参见[错误码参考文档](https://www.volcengine.com/docs/6561/2534853?lang=zh#ad7BnUTK)。



**message ** `string`

请求状态信息。训练失败时，会返回对应的失败说明，详情请参见[错误码参考文档](https://www.volcengine.com/docs/6561/2534853?lang=zh#ad7BnUTK)。



**available_training_times** `int`

该speaker_id剩余训练次数



**create_time ** `int`

创建时间



**language ** `int`

以下为语种对应的枚举值


* cn = 0：中文（默认）

* en = 1：英文

* ja = 2：日语

* es = 3：西班牙语

* id = 4：印尼语

* pt = 5：葡萄牙语

* de = 6:  德语

* fr = 7: 法语

* ko = 8：韩语

* it = 9: 意大利语

* th = 10: 泰语

* vi = 11: 越南语

* ru = 12: 俄语

* fil = 13: 菲律宾语

* ms = 14: 马来语

* ar = 15: 阿拉伯语

* mx = 16: 墨西哥西班牙语

* pt\-br = 17: 巴西葡萄牙语

* pl = 19：波兰语

* tr = 20：土耳其语

* sv = 21：瑞典语



**speaker_id ** `string`

唯一音色代号



**status ** `int`

训练状态，状态为2或4时都可以调用TTS语音合成接口。


* NotFound = 0

* Training = 1

* Success = 2

* Failed = 3

* Active = 4



**speaker_status**`object list`


**model_type ** `int`

复刻 2.0：`model_type = 5` 



**demo_audio ** `string`

试听音频。Success状态时返回，一小时有效，若需要，请下载后使用




&nbsp;

&nbsp;






---

## 音色升级 HTTP

> 文档ID: 2535751 | URL: https://www.volcengine.com/docs/6561/2535751 | 标题: 音色升级HTTP | MDContent长度: 2945

通过[音色复刻 V1 训练接口](https://www.volcengine.com/docs/6561/1305191?lang=zh)生成的克隆音色，仅可绑定单个模型产品。升级至**音色复刻 V3**后，该音色可在音色复刻 1.0、2.0 等多个产品中通用。

本接口用于完成从 V1 版本到 V3 版本的升级操作，<mark>若已使用V3版本音色训练接口则无需再使用该接口进行升级。</mark>

&nbsp;

<span data-label="purple">POST</span>`https://openspeech.bytedance.com/api/v3/tts/upgrade_voice`

以下请求头主要为[新版控制台](https://console.volcengine.com/speech/new?_vtm_=a106466.b106468.0_0.0_0.0.844_7636990835414320667)鉴权参考示例，若使用[旧版控制台](https://console.volcengine.com/speech/app)，鉴权参考示例详见：[旧版控制台鉴权参考示例](https://www.volcengine.com/docs/6561/2534847?lang=zh)。<mark>旧版控制台后续会逐步下线，建议尽快切换至</mark>[新版控制台](https://console.volcengine.com/speech/new?_vtm_=a106466.b106468.0_0.0_0.0.844_7636990835414320667)<mark>使用。</mark>


<span id="vsY5GiPG"></span>
### 请求头


**Content\-Type ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

固定值："application/json"



**X\-Api\-Key ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|M22Sxg">必选</span>

标识客户端请求ID，uuid随机字符串



&nbsp;


<span id="UDdNVdqZ"></span>
### 请求体


**speaker_id**`string` <span data-api-tag="require|uo2J0a">必选</span>

唯一音色代号，[speaker_id获取参考](https://www.volcengine.com/docs/6561/1167802?lang=zh&_vtm_=a106466.b106468.0_0.0_0.0.902_7636990835414320667#api%E8%B0%83%E7%94%A8%E5%8F%82%E6%95%B0%E8%8E%B7%E5%8F%96)。



**custom_speaker_id**`string` 

**含义**：自定义音色代号（仅支持后付费音色，关于后付费音色下单几说明详见：[《声音复刻下单及使用指南》](https://www.volcengine.com/docs/6561/1167802?lang=zh&_vtm_=a106466.b106468.0_0.0_0.0.970_7636990835414320667)）。

后付费声音复刻示例：

```JSON
{
"speaker_id": "custom_speaker_id", // 固定值
"custom_speaker_id": "custom_zh_xxx" // 训练接口中自定义的音色代号
}
```






<span id="ODlXw79R"></span>
# 响应


<span id="2phtbtYG"></span>
### 响应


**X\-Tt\-Logid ** `string`

服务端返回的 logid，用于在咨询或者反馈时定位问题



**code** `int`

请求状态码。请求失败时，HTTP 状态码不为 200，详情请参见[错误码参考文档](https://www.volcengine.com/docs/6561/2534853?lang=zh#ad7BnUTK)。



**message ** `string`

请求状态信息。训练失败时，会返回对应的失败说明，详情请参见[错误码参考文档](https://www.volcengine.com/docs/6561/2534853?lang=zh#ad7BnUTK)。



**available_training_times** `int`

该speaker_id剩余训练次数



**create_time ** `int`

创建时间



**language ** `int`

以下为语种对应的枚举值


* cn = 0 中文（默认）

* en = 1 英文

* ja = 2 日语

* es = 3 西班牙语

* id = 4 印尼语

* pt = 5 葡萄牙语

* de = 6 德语

* fr = 7 法语

* ko = 8 韩语

* it = 9：意大利语

* th = 10: 泰语

* vi = 11: 越南语

* ru = 12: 俄语

* fil = 13: 菲律宾语

* ms = 14: 马来语

* ar = 15: 阿拉伯语

* mx = 16: 墨西哥西班牙语

* pt\-br = 17: 巴西葡萄牙语

* pl = 19：波兰语

* tr = 20：土耳其语

* sv = 21：瑞典语



**speaker_id ** `string`

唯一音色代号



**status ** `int`

训练状态，状态为2或4时都可以调用TTS语音合成接口。


* NotFound = 0

* Training = 1

* Success = 2

* Failed = 3

* Active = 4



**speaker_status**`object list`


**model_type ** `int`

复刻 2.0：`model_type = 5` 



**demo_audio ** `string`

试听音频。Success状态时返回，一小时有效，若需要，请下载后使用









---

## 音色设计 HTTP

> 文档ID: 2277844 | URL: https://www.volcengine.com/docs/6561/2277844 | 标题: 音色设计HTTP | MDContent长度: 72863

<span id="e65bb1d9"></span>
## 请求路径


* 服务使用的请求路径：`https://openspeech.bytedance.com/api/v3/tts/voice_design`


<span id="a5640d43"></span>
## 建连&鉴权


* HTTP 请求头（Request Header 中）添加以下信息


使用[新版控制台](https://console.volcengine.com/speech/new)时，推荐采用以下更简化的鉴权方式。


|**Key** |**说明** |**参数类型** |**是否必须** |**Value 示例** |
|---|---|---|---|---|
|Content\-Type |固定值 |string |必须 |"application/json" |
|X\-Api\-Key |使用火山引擎控制台获取的API Key，可参考 [控制台API Key管理](https://www.volcengine.com/docs/6561/2119699?lang=zh#ew1HctnP) |string |必须 |"your\-api\-key" |
|X\-Api\-Request\-Id |标识客户端请求ID，uuid随机字符串 |string |必须 |"67ee89ba\-7050\-4c04\-a3d7\-ac61a63499b3" |


```Python
headers = {
    "Content-Type": "application/json",
    "X-Api-Key": "your-api-key",
    "X-Api-Request-Id": "67ee89ba-7050-4c04-a3d7-ac61a63499b3",
}
```


若使用[旧版控制台](https://console.volcengine.com/speech/app)，鉴权方式如下。建议尽快切换至新版，以体验更便捷的鉴权流程。


|**Key** |**说明** |**参数类型** |**是否必须** |**Value 示例** |
|---|---|---|---|---|
|Content\-Type |固定值 |string |必须 |"application/json" |
|X\-Api\-App\-Key |使用火山引擎控制台获取的APP ID，可参考 [控制台使用FAQ-Q1](https://www.volcengine.com/docs/6561/196768#q1%EF%BC%9A%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%8F%96%E5%88%B0%E4%BB%A5%E4%B8%8B%E5%8F%82%E6%95%B0appid%EF%BC%8Ccluster%EF%BC%8Ctoken%EF%BC%8Cauthorization-type%EF%BC%8Csecret-key-%EF%BC%9F)（旧版控制台使用，新版控制台只需要X\-Api\-Key即可） |string |必须 |"123456789" |
|X\-Api\-Access\-Key |使用火山引擎控制台获取的Access Token，可参考 [控制台使用FAQ-Q1](https://www.volcengine.com/docs/6561/196768#q1%EF%BC%9A%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%8F%96%E5%88%B0%E4%BB%A5%E4%B8%8B%E5%8F%82%E6%95%B0appid%EF%BC%8Ccluster%EF%BC%8Ctoken%EF%BC%8Cauthorization-type%EF%BC%8Csecret-key-%EF%BC%9F)（旧版控制台使用，新版控制台只需要X\-Api\-Key即可） |string |必须 |"your\-access\-key" |
|X\-Api\-Request\-Id |标识客户端请求ID，uuid随机字符串 |string |必须 |"67ee89ba\-7050\-4c04\-a3d7\-ac61a63499b3" |


```Python
headers = {
    "Content-Type": "application/json",
    "X-Api-App-Key": "123456789",
    "X-Api-Access-Key": "your-access-key",
    "X-Api-Request-Id": "67ee89ba-7050-4c04-a3d7-ac61a63499b3",
}
```



* 在HTTP请求成功后，会返回这些 Response header



|Key |说明 |Value 示例 |
|---|---|---|
|X\-Tt\-Logid |服务端返回的 logid，建议用户获取和打印方便定位问题 |202407261553070FACFE6D19421815D605 |


<span id="fe82ad89"></span>
## **请求参数**


|参数名称 |层级 |类型 |是否必须 |备注 |
|---|---|---|---|---|
|speaker_id |1 |string |必须 |唯一音色代号，[控制台购买](https://www.volcengine.com/docs/6561/1167802?lang=zh) |
|text |1 |string |必须 |试听文本，限制 300 字 |
|prompt |1 |object |必须 |提示词，下层级的 text_prompt 和 image_prompt 不能同时为空。同时存在的时候 image_prompt 有更高优先级生效。 |
|prompt.text_prompt |2 |string |否 |文本提示词，类似“女性，语速中等偏快，语调低沉有力”，限制 200 字 |
|prompt.image_prompt |2 |object |否 |图片提示，下面image_url 和 image_bytes 二选一，大小限制：10M |
|prompt.image_prompt.image_url |3 |string |否 |图片提示，这里可以填写可下载的图片 url 地址 |
|prompt.image_prompt.image_bytes |3 |string |否 |图片提示，这里可以传图片的 base64 编码之后的结果 (同时存在优先级高) |
|language |1 |int |否 |以下为语种对应的枚举值<br><br><br>* cn = 0 中文（默认）<br><br>* en = 1 英文 |


<span id="73af01ac"></span>
## **请求示例**

```JSON
{
  "prompt": {
    "text_prompt": "女性，语速中等偏快，语调低沉有力",
    "image_prompt": {
      "image_bytes": "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",
      "image_url": "http://test.com/VoiceDesignPrompt_1772094127562.png"
    }
  },
  "text": "夜色渐浓，城市的灯火次第亮起，每个人都在为自己的生活奔波，从未停歇。",
  "speaker_id": "S_*******",
}
```


<span id="aa9feaa4"></span>
## 返回参数


|参数名称 |层级 |参数类型 |是否必须 |备注 |
|---|---|---|---|---|
|code |1 |int |可选 |失败时候HTTP返回非200，该字段返回详细错误码 |
|message |1 |string |可选 |失败时候HTTP返回非200，该字段返回详细错误信息 |
|available_training_times |1 |int |可选 |剩余可设计次数 |
|create_time |1 |int |可选 |创建时间 |
|language |1 |int |可选 |以下为语种对应的枚举值<br><br><br>* cn = 0 中文（默认）<br><br>* en = 1 英文 |
|speaker_id |1 |string |可选 |唯一音色代号 |
|status |1 |int |可选 |训练状态，状态为2或4时都可以调用tts<br><br><br>* NotFound = 0<br><br>* Training = 1<br><br>* Success = 2<br><br>* Failed = 3<br><br>* Active = 4 |
|demo_audio |1 |string |可选 |Success状态时返回，一小时有效，若需要，请下载后使用 |


<span id="007f246f"></span>
## 返回示例

```JSON
{
  "available_training_times": 15,
  "create_time": 1772026663000,
  "language": 0,
  "speaker_id": "S_*******",
  "demo_audio": "https://lf6-lab-speech-tt-sign.bytespeech.com/tos-cn-o-14155/o0ftE0YFM8eECAX78jC3AHopgAijApN6uMBCAi?x-expires=1773912669&x-signature=g7ui2EQVJ0PShNKC%2BArg%2Bf7ZdoQ%3D",
  "status": 2
}
```


<span id="41a84ff0"></span>
## 错误码

您在调用API接口过程中，如果服务端返回结果报错，则表示操作失败。您可以通过返回结果中的错误码快速地定位问题，并根据对应的解决方案尝试修改代码或者反馈给终端用户加以解决。


|**参数名称** |**层级** |**参数类型** |**是否必须** |**备注** |
|---|---|---|---|---|
|code |1 |int |可选 |训练失败时候HTTP返回非200，该字段返回详细错误码 |
|message |1 |string |可选 |训练失败时候HTTP返回非200，该字段返回详细错误信息 |



|**错误码分类** |**错误码表示** |
|---|---|
|服务端报错 |8位错误码，以5开头，例如：50001201 |
|客户操作错误导致的服务端报错 |8位错误码，以4开头，例如：40001101 |



|错误码code |状态信息message |原因 |解决方案 |
|---|---|---|---|
|45001001 |请求参数有误 |参数缺失/格式不对/不符合约束 |按接口校验规则修正参数；补齐必填字段；检查枚举值 |
|45001123 |达到设计次数上限 |超过音色设计次数限制 |更换为还有设计次数的 speaker_id |
|55001308 |音色设计失败 |下游失败/超时/返回异常 |服务异常、可能需要重试 |


<span id="c85d7220"></span>
## 调用示例

使用[新版控制台](https://console.volcengine.com/speech/new)时，推荐采用以下更简化的鉴权方式。ApiKey 的调用方式：

```JSON
curl -X POST "https://openspeech.bytedance.com/api/v3/tts/voice_design" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: api-key" \
  -H "X-Api-Request-Id: $(uuidgen)" \
  -d '{
    "prompt": {
      "text_prompt": "女性，语速中等偏快，语调低沉有力"
    },
    "text": "夜色渐浓，城市的灯火次第亮起，每个人都在为自己的生活奔波，从未停歇。",
    "speaker_id": "S_*********"
  }'
```


若使用[旧版控制台](https://console.volcengine.com/speech/app)，鉴权方式如下。建议尽快切换至新版，以体验更便捷的鉴权流程。Appid + AccessKey 的调用方式：

```JSON
curl -X POST "https://openspeech.bytedance.com/api/v3/tts/voice_design" \
  -H "Content-Type: application/json" \
  -H "X-Api-Access-Key: access-key" \
  -H "X-Api-App-Key: appid" \
  -H "X-Api-Request-Id: $(uuidgen)" \
  -d '{
    "prompt": {
      "text_prompt": "女性，语速中等偏快，语调低沉有力"
    },
    "text": "夜色渐浓，城市的灯火次第亮起，每个人都在为自己的生活奔波，从未停歇。",
    "speaker_id": "S_*********"
  }'
```


<span id="ebe763c8"></span>
# 大模型语音合成接口

音色训练成功后，您需要调用大模型语音合成 V3 版本接口，才能使用该音色将指定文本合成为音频。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">V3 版本的大模型语音合成接口通过 <code>X-Api-Resource-Id</code> 参数来选择不同的版本效果：</div>



* <div data-tips="true" data-tips-type="warning"><code>seed-icl-1.0</code> / <code>seed-icl-1.0-concurr</code>：对应声音复刻 ICL 1.0 版本效果</div>


* <div data-tips="true" data-tips-type="warning"><code>seed-icl-2.0</code>：对应声音复刻 ICL 2.0 版本效果</div>



<div data-tips="true" data-tips-type="warning">同时，<code>X-Api-Resource-Id</code> 也决定了计费方式：</div>



* <div data-tips="true" data-tips-type="warning"><code>seed-icl-1.0</code>：对应计费商品为“声音复刻 ICL 1.0 字符版”</div>


* <div data-tips="true" data-tips-type="warning"><code>seed-icl-1.0-concurr</code>：对应计费商品为“声音复刻 ICL 1.0 并发版”</div>


* <div data-tips="true" data-tips-type="warning"><code>seed-icl-2.0</code>：对应计费商品为“声音复刻 ICL 2.0 字符版”</div>




|**接口** |**推荐场景** |**接口功能** |**文档链接** |
|---|---|---|---|
|`wss://openspeech.bytedance.com/api/v3/tts/bidirection` |WebSocket协议，实时交互场景，支持文本实时流式输入，流式输出音频。 |语音合成、**声音复刻**、混音 |[V3 WebSocket双向流式文档](https://www.volcengine.com/docs/6561/1329505) |
|`wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream` |WebSocket协议，一次性输入合成文本，流式输出音频。 |语音合成、**声音复刻**、混音 |[V3 WebSocket单向流式文档](https://www.volcengine.com/docs/6561/1719100) |
|`https://openspeech.bytedance.com/api/v3/tts/unidirectional` |HTTP Chunked协议，一次性输入全部合成文本，流式输出音频。 |语音合成、**声音复刻**、混音 |[V3 HTTP Chunked单向流式文档](https://www.volcengine.com/docs/6561/1598757?lang=zh#_2-http-chunked%E6%A0%BC%E5%BC%8F%E6%8E%A5%E5%8F%A3%E8%AF%B4%E6%98%8E) |
|`https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse` |HTTP SSE协议，一次性输入全部合成文本，流式输出音频。 |语音合成、**声音复刻**、混音 |[V3 Server Sent Events（SSE）单向流式文档](https://www.volcengine.com/docs/6561/1598757?lang=zh#_3-sse%E6%A0%BC%E5%BC%8F%E6%8E%A5%E5%8F%A3%E8%AF%B4%E6%98%8E) |







---

## 音色管理 HTTP

> 文档ID: 2235883 | URL: https://www.volcengine.com/docs/6561/2235883 | 标题: 音色管理HTTP | MDContent长度: 9475

<span id="62f0ae93"></span>
# 音色管理接口

<span id="cda74ea0"></span>
## API接入说明

<span id="2e989347"></span>
### 访问鉴权


1. 鉴权方式说明 [公共参数--API签名调用指南-火山引擎 (volcengine.com)](https://www.volcengine.com/docs/6369/67268)


线上请求地址域名 open.volcengineapi.com


2. 固定公共参数


```Plain
Region = "cn-north-1"
Service = "speech_saas_prod"
Version = "2023-11-07"
解释
```



3. AKSK获取 [访问控制-火山引擎 (volcengine.com)](https://console.volcengine.com/iam/keymanage)


说明：[Access Key（密钥）管理--API访问密钥（Access Key）-火山引擎 (volcengine.com)](https://www.volcengine.com/docs/6291/65568)


4. 调用方式

   1. SDK [SDK概览--API签名调用指南-火山引擎 (volcengine.com)](https://www.volcengine.com/docs/6369/156029)

   2. 直接签名后调用


结合文档内api说明调用 `ListMegaTTSTrainStatus` （ListMegaTTSTrainStatus已下线，demo中action直接替换为BatchListMegaTTSTrainStatus即可）的例子(\*其他语言和使用sdk调用的方式请参考火山鉴权源码[说明](https://www.volcengine.com/docs/6369/185600) 一)


3. 示例代码：


<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9f981eea343847aaac7fb1b011ba8d86~tplv-goo7wpa0wc-image.image" name="sign.go">sign.go</Attachment>


&nbsp;

<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/24071af48c6049f28f6b60e3239da6f2~tplv-goo7wpa0wc-image.image" name="sign.py">sign.py</Attachment>


&nbsp;

<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a467b4e10dc44767a9226f09fa3f6ecf~tplv-goo7wpa0wc-image.image" name="sign.java">sign.java</Attachment>


&nbsp;

<span id="15d26d16"></span>
### 错误码


1. 非 **2xx** 开头的HTTP返回状态码被可以认为是**错误**

2. 错误的HTTP返回结构体如下


```JSON
{
    "ResponseMetadata": 
    {
        "RequestId": "20220214145719010211209131054BC103", // header中的X-Top-Request-Id参数
        "Action": "ListMegaTTSTrainStatus",
        "Version": "2023-11-07",
        "Service": "{Service}",// header中的X-Top-Service参数
        "Region": "{Region}", // header中的X-Top-Region参数
        "Error": 
        {
            "Code": "InternalError.NotCaptured",
            "Message": "xxx"
        }
    }
}
```



3.  **"ResponseMetadata.Error.Code"**  客户端可以依照这个字段判断错误种类，已知种类和含义如下



|Code |Description |
|---|---|
|OperationDenied.InvalidSpeakerID |账号或AppID无权限操作或无法操作SpeakerID列表中的一个或多个实例 |
|OperationDenied.InvalidParameter |请求体字段不合法（缺失必填字段、类型错误等） |
|InternalError.NotCaptured |未知的服务内部错误 |


<span id="243e99e6"></span>
## API列表

<span id="a8755e5b"></span>
### 分页查询SpeakerID状态 `BatchListMegaTTSTrainStatus`

<span id="99293c5f"></span>
#### 接口说明

查询已购买的音色状态；支持使用token和声明页数两种分页方式；其中，


* 分页token在最后一页为空

* 分页token采用私有密钥进行加密

* 分页接口为新接口，不影响已有接口行为


<span id="1008d9c9"></span>
#### **请求方式**

`POST`

<span id="4c708b2a"></span>
#### 请求参数


|Parameter |Type |Must |Argument type |Description |
|---|---|---|---|---|
|Content\-Type | |Y |header |固定字符串: application/json; charset=utf\-8 |
|Action |string |Y |query |BatchListMegaTTSTrainStatus |
|Version |string |Y |query |2023\-11\-07 |
|AppID |string |Y |body |AppID |
|SpeakerIDs |[]string |N |body |SpeakerID的列表，传空为返回指定APPID下的全部SpeakerID |
|State |string |N |body |音色状态，支持取值：Unknown、Training、Success、Active、Expired、Reclaimed<br><br>详见附录：State状态枚举值 |
|PageNumber |int |N |body |页数, 需大于0, 默认为1 |
|PageSize |int |N |body |每页条数, 必须在范围[1, 100]内, 默认为10 |
|NextToken |string |N |body |上次请求返回的字符串; 如果不为空的话, 将覆盖PageNumber及PageSize的值 |
|MaxResults |int |N |body |与NextToken相配合控制返回结果的最大数量; 如果不为空则必须在范围[1, 100]内, 默认为10 |
|OrderTimeStart |int64 |N |body |下单时间检索上边界毫秒级时间戳，受实例交付速度影响，可能比支付完成的时间晚 |
|OrderTimeEnd |int64 |N |body |下单时间检索下边界毫秒级时间戳，受实例交付速度影响，可能比支付完成的时间晚 |
|ExpireTimeStart |int64 |N |body |实例到期时间的检索上边界毫秒级时间戳 |
|ExpireTimeEnd |int64 |N |body |实例到期时间的检索下边界毫秒级时间戳 |


<span id="07ec8372"></span>
#### 返回数据

```JSON
{
    "ResponseMetadata": 
    {
        "RequestId": "20220214145719010211209131054BC103", // header中的X-Top-Request-Id参数
        "Action": "BatchListMegaTTSTrainStatus",
        "Version": "2023-11-07",
        "Service": "{Service}",// header中的X-Top-Service参数
        "Region": "{Region}" // header中的X-Top-Region参数},
        "Result":
        {
            "AppID": "xxx",
            "TotalCount": 2, // speakerIDs总数量
            "NextToken": "", // NextToken字符串，可发送请求后面的结果; 如果没有更多结果将为空
            "PageNumber": 1, // 使用分页参数时的当前页数
            "PageSize": 2, // 使用分页参数时当前页包含的条数
            "Statuses": 
            [
                {
                    "CreateTime": 1700727790000, // unix epoch格式的创建时间，单位ms
                    "DemoAudio": "https://example.com", // http demo链接
                    "InstanceNO": "Model_storage_meUQ8YtIPm", // 火山引擎实例Number
                    "IsActivable": true, // 是否可激活
                    "SpeakerID": "S_VYBmqB0A", // speakerID
                    "State": "Success", // speakerID的状态
                    "Version": "V1" // speakerID已训练过的次数
                    "ExpireTime": 1964793599000, // 到期时间
                    "OrderTime": 1701771990000, // 下单时间
                    "Alias": "", // 别名，和控制台同步
                    "AvailableTrainingTimes": 10, // 剩余训练次数
                    "ModelTypeDetails":[
                          {
                                 "ModelType": 1, // ModelType
                                 "DemoAudio": "https://example.com", 
                                 "IclSpeakerId": "icl_123456", 
                                 "ResourceID": "seed-icl-1.0"
                          }
                    ]                 
                    
                },
                {
                    "SpeakerID": "S_VYBmqB0B", // speakerID
                    "State": "Unknown", // speakerID的状态
                    "Version": "V1" // speakerID已训练过的次数
                }
            ]
        }
}
```


<span id="7c43fc32"></span>
### 音色下单`OrderAccessResourcePacks`

<span id="7461c273"></span>
#### 接口说明

一步下单音色并支付订单，前置条件：


* **AppID已经开通声音复刻**

* **账户里面有足够的余额（或代金券），可以自动支付该订单**

* **频率限制：2分钟内最多下单2000个音色**


<span id="1c84b987"></span>
#### **请求方式**

`POST`

<span id="b4eac64b"></span>
#### 请求参数


|Parameter |Type |Must |Argument type |Description |
|---|---|---|---|---|
|Content\-Type | |Y |header |固定字符串: application/json; charset=utf\-8 |
|Action |string |Y |query |OrderAccessResourcePacks |
|Version |string |Y |query |2023\-11\-07 |
|AppID |int |Y |body |AppID |
|ResourceID |string |Y |body |平台的服务类型资源标识，必填：<br><br>volc.megatts.voiceclone |
|Code |string |Y |body |平台的计费项标识，必填且唯一：<br><br>Model_storage 声音复刻 |
|Times |int |Y |body |下单单个音色的时长，单位为月 |
|Quantity |int |Y |body |下单音色的个数，如100，即为购买100个音色 |
|AutoUseCoupon |bool |N |body |是否自动使用代金券 |
|CouponID |string |N |body |代金券ID，通过[代金券管理](https://www.volcengine.com/docs/6269/67339)获取 |
|ResourceTag |object |N |body |项目&标签账单配置 |
|ResourceTag.CustomTags |map[string]string |N |body |标签，通过[标签管理](https://www.volcengine.com/docs/6649/189381)获取 |
|ResourceTag.ProjectName |string |N |body |项目名称，通过[项目管理](https://www.volcengine.com/docs/6649/94336)获取 |


<span id="db02ef6d"></span>
#### 请求示例

```JSON
{
    "AppID": 100000000,
    "ResourceID": "volc.megatts.voiceclone",
    "Code": "Model_storage",
    "Times": 12,
    "Quantity": 2000
}
```


<span id="27634009"></span>
#### 返回数据

```JSON
{
    "ResponseMetadata": 
    {
        "RequestId": "20220214145719010211209131054BC103", // header中的X-Top-Request-Id参数
        "Action": "OrderAccessResourcePacks",
        "Version": "2023-11-07",
        "Service": "{Service}",// header中的X-Top-Service参数
        "Region": "{Region}" // header中的X-Top-Region参数},
        "Result":
        {
            "OrderIDs": 
            [
                "Order20010000000000000001" // 购买成功返回的订单号ID
            ]
        }
}
```


<span id="3a657453"></span>
### 音色续费`RenewAccessResourcePacks`

<span id="7b5015fb"></span>
#### 接口说明

一步续费音色并支付订单，前置条件：


* **账户里面有足够的余额（或代金券），可以自动支付该订单**

* **频率限制：2分钟内最多续费2000个音色**


<span id="45184772"></span>
#### **请求方式**

`POST`

<span id="f2c357dd"></span>
#### 请求参数


|Parameter |Type |Must |Argument type |Description |
|---|---|---|---|---|
|Content\-Type | |Y |header |固定字符串: application/json; charset=utf\-8 |
|Action |string |Y |query |`RenewAccessResourcePacks` |
|Version |string |Y |query |2023\-11\-07 |
|Times |int |Y |body |续费音色的时长，单位为月 |
|SpeakerIDs |[]string |N |body |要续费的SpeakerID的列表，可以通过`BatchListMegaTTSTrainStatus`接口过滤获取 |
|AutoUseCoupon |bool |N |body |是否自动使用代金券 |
|CouponID |string |N |body |代金券ID，通过[代金券管理](https://www.volcengine.com/docs/6269/67339)获取 |


<span id="1b2c0e9f"></span>
#### 返回数据

```JSON
{
    "ResponseMetadata": 
    {
        "RequestId": "20220214145719010211209131054BC103", // header中的X-Top-Request-Id参数
        "Action": "OrderAccessResourcePacks",
        "Version": "2023-11-07",
        "Service": "{Service}",// header中的X-Top-Service参数
        "Region": "{Region}" // header中的X-Top-Region参数},
        "Result":
        {
            "OrderIDs": 
            [
                "Order20010000000000000001" // 购买成功返回的订单号ID
            ]
        }
}
```


<span id="c2b77147"></span>
### 附录

<span id="cc0d2106"></span>
#### State状态枚举值


|State |Description |
|---|---|
|Unknown |SpeakerID尚未进行训练 |
|Training |声音复刻训练中（长时间处于复刻中状态请联系火山引擎技术人员） |
|Success |声音复刻训练成功，可以进行TTS合成 |
|Active |已激活（无法再次训练） |
|Expired |火山控制台实例已过期或账号欠费 |
|Reclaimed |火山控制台实例已回收 |


<span id="7e757ed2"></span>
#### 常见错误枚举值


|Error |Description |
|---|---|
|InvalidParameter |请求参数错误 |
|Forbidden.InvalidService |未开通声音复刻 |
|Forbidden.ErrAccountNotPermission |账号没有权限 |
|Forbidden.LimitedTradingFrequency |下单限流错误 |
|InvalidParameter.AppID |AppID错误或者无效 |
|NotFound.ResourcePack |音色（或资源包）不存在 |
|InvalidParameter.InstanceNumber |无效的音色（或实例） |







---

## 错误码查询

> 文档ID: 2534853 | URL: https://www.volcengine.com/docs/6561/2534853 | 标题: 错误码查询 | MDContent长度: 5899

本文档汇总语音合成接口常见错误码及对应解决方案，帮助开发者快速排查并解决调用问题。


|**参数名称** |**层级** |**参数类型** |**是否必须** |**备注** |
|---|---|---|---|---|
|code |1 |int |可选 |失败时候HTTP返回非200，该字段返回详细错误码 |
|message |1 |string |可选 |失败时候HTTP返回非200，该字段返回详细错误信息 |



|**错误码分类** |**错误码表示** |
|---|---|
|服务端报错 |8位错误码，以5开头，例如：50001201 |
|客户操作错误导致的服务端报错 |8位错误码，以4开头，例如：40001101 |


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="tip">如需反馈问题，请提供响应中的Logid，以便我们排查与定位问题。</div>


<span id="2u2ql30k"></span>
# 音频生成HTTP接口错误码


|**Http 状态码** |**错误码code** |**状态信息message** |**原因** |**解决方案** |
|---|---|---|---|---|
| 400<br><br> |45001001<br><br> |{"code":45001001,"message":"text_prompt length 3961 exceeds maximum of 2048"} |参数校验失败 |检查输入参数合法性 |
||45001115 |{"code":45001115,"message":"speaker S_hmW3732T1x not found in speaker_map, speaker_audio, or mega_info"} |参考音色不存在 |检查音色是否在允许范围内 |
||45001116 |{"code":45001116,"message":"text_prompt length 3961 exceeds maximum of 2048"} |prompt 文本长度超限 |检查输入参数合法性 |
||45001117 |{"code":45001117,"message":"audio reference duration 99.68s exceeds maximum of 30.00s"} |参考音频时长超限 |检查参考音频长度 |
||45001125<br><br> |{"code":45001125,"message":"demo text audit failed"} <br><br> |文本审核失败 |检查输入的文本 |
||45001104 |{"code":45001104,"message":"code:1104, message:sensitive voiceprint detected"} |声纹检测失败 |检查参考音频的合法性 |
||45001127 |{"code":45001127,"message":"code:1127, message:audio risk audit %s: chunk %d rejected (%s)"} |音频审核失败 |检查参考音频的合法性 |
||45001130 |{"code":45001130,"message":"prompt image audit reject"} |图片审核失败 |检查参考图片的合法性 |
||45001131<br><br> |{"code":45001131,"message":"download audio error from xxxxxxx"} |参考音频下载失败 |检查参音频的地址 |
||45001132 |{"code":45001132,"message":"download image error from xxxxxxx "} |参考图片下载失败 |检查参考图片的地址 |
| 500 |55001309 |{"code":55001309,"message":"downstream error: code=50000102, text=UpstreamRequestFailed:ServerError:process caption request 0 failed: sami error: codes=50000000, desc=ServerError:AudioCaptionInvokeFailed:sami error: codes=50000000, desc=ServerError:BigASROneShotFailedCode:1010"} |合成失败，内部错误 |重试 |
||55001310 |{"code":55001310,"message":"code:1310, message:audio risk audit %s: chunk %d rejected (%s)"} |合成失败，合成音频没有通过安审 |重试 |
||55001311 |{"code":45001311,"message":"code:1311, message:sensitive voiceprint detected"} |合成失败，合成音频没有通过声纹检查 |重试 |


&nbsp;

<span id="xdshdNm4"></span>
#  单向流式语音合成HTTP接口、单向流式语音合成WebSocket错误码


|**错误码code** |**状态信息message** |**原因** |**解决方案** |
|---|---|---|---|
|45000000<br><br> |payload unmarshal: marshal ws msg body to JSON failed: unmarshal request |Payload 反序列化错误 |请使用正确的payload json格式 |
||quota exceeded for types: concurrency<br><br> |超并发，一般是请求并发数超过限制 |如有增加并发需求可至前往[控制台](https://console.volcengine.com/speech/new/purchase?projectName=default)增购并发 |
||single request size too large |请求的payload过大 |请缩小请求体后重试 |
|45000001<br><br> |[Invalid argument] EmptyRequest |`req_params`字段不存在<br><br> |请传递`req_params`字段请求 |
||[Invalid argument] speaker not found<br><br> |参数错误，例如：req_params.speaker not found |请检查参数，并且修改后重新请求 |
||[Invalid argument] InvalidModel<br><br> |非法的`model`参数<br><br> |`model`参数仅针对声音复刻2.0生效，并且枚举值为`seed-tts-2.0-standard`和`seed-tts-2.0-expressive`，详见官网API参考说明 |
||[Invalid argument] InvalidDialect<br><br> |非法的`explicit_dialect`参数<br><br> |详见官网API参考说明 |
|45002000 |TTS invalid speaker |`Speaker`参数为空 |请输入音色ID，音色ID可从[控制台>音色库](https://console.volcengine.com/speech/new/voices?projectName=default)获取 |
|45002001 |No readable text!<br><br> |没有可读文本<br><br> |请检查文本，并且修改后重新请求 |
|55000000 |服务端内部error |服务端通用错误 |请稍后重试 |
||Request timeout: connect downstream service timeout<br><br> |网关连接下游 TTS 服务超时，通常为下游服务暂时不可用或网络抖动 |请稍后重试；若持续超时请联系技术支持确认服务状态 |
||Request timeout: synthesis processing timeout<br><br> |下游 TTS 合成处理超时，通常由于文本过长或服务负载较高<br><br> |请缩短单次请求的文本长度后重试，或错峰调用 |
||Request timeout: client send timeout<br><br> |WebSocket 连接上客户端长时间未发送数据，触发空闲超时断开 |请确保客户端按时发送数据帧或保持心跳；检查网络连通性 |
|55000000 |resource ID is mismatched with speaker related resource |该`resourceId`下没有该`speaker`配置 |照以下步骤进行排查：<br><br><br>1. 检查服务是否未开通，若未开通，请开通服务；<br><br>2. 检查音色ID是否拼写正确，若错误请修改至正确的音色ID；<br><br>3. 对于声音复刻场景，检查复刻的音色是否过期。若过期请续期；<br><br>4. 检查该音色是否没有权限； |


<span id="ad7BnUTK"></span>
# 声音复刻HTTP接口错误码


|**错误码code** |**状态信息message** |**原因** |**解决方案** |
|---|---|---|---|
|45001001 |请求参数有误 |参数缺失/格式不对/不符合约束 |按接口校验规则修正参数；补齐必填字段；检查枚举值 |
|45001101 |音频上传失败 |客户端上传到服务端失败/超时/网络问题 |重试上传；检查网络与超时；确认音频格式与大小满足限制 |
|45001102 |ASR转写失败 |ASR 服务失败/超时/音频质量差导致无法转写 |重试；确认音频可识别（清晰、人声占比高）；必要时更换音频 |
|45001104 |声纹检测未通过 |触发敏感声纹/黑名单/相似度过高 |更换音频或更换说话人；避免使用敏感或疑似复刻目标音色的素材 |
|45001105 |获取音频数据失败 |音频数据解码失败/下载失败/数据为空（如 base64 解码失败） |确认音频字段不为空；base64 是否合法；若是 URL 确认可访问；必要时重新上传 |
|45001107 |SpeakerID未找到 |speaker_id 不存在/已被删除 |确认 speaker_id 正确；先查询列表；如已删除则重新创建 |
|45001108 |音频转码失败 |输入音频格式不支持/数据损坏/转码工具失败 |确认音频格式与采样率；提供可解码音频；重试或更换音频 |
|45001109 |wer检测错误 |WER 检测服务异常/输入不符合要求 |重试；检查prompt音频和提供的prompt文本是否对应 |
|45001110 |音色删除失败 |删除流程失败/服务端异常/资源不存在 |重试；确认 speaker_id 存在 |
|45001112 |SNR检测错误 |SNR 检测服务异常 |重试；更换音频（更高信噪比）；检查音频采样率/格式 |
|45001113 |降噪失败 |降噪服务异常/参数不支持/音频不适配 |重试；关闭降噪参数或换模型；更换音频 |
|45001114 |音频质量较差 |音频质量差/背景噪声大/人声过弱 |建议更换音频 |
|45001122 |asr未检测到人声 |音频无人声/人声过弱/噪声过大 |更换含清晰人声的音频；提高人声占比；减少背景噪声 |
|45001123 |达到上传次数上限 |超过音色训练次数限制 |更换为还有训练次数的 speaker_id |
|45001124 |asr文本审核拒绝 |ASR 识别文本触发审核策略 |更换音频内容；避免敏感内容；必要时走白名单/审核申诉流程 |
|45001125 |demo文本审核拒绝 |demo 文本触发审核策略 |修改 demo 文本；避免敏感词；按合规要求调整 |
|45001126 |demo文本长度错误 |demo 文本太短/太长/超出限制 |按长度限制调整文本；去掉多余字符或补充内容 |
|45001127 |prompt音频审核拒绝 |prompt 音频触发审核策略 |更换音频；避免敏感内容/违规素材；确保音频来源合规 |
|45001128 |prompt音频文本审核拒绝 |prompt 音频对应文本/识别结果触发审核 |更换音频或文本；避免敏感内容；必要时走白名单 |
|55001301 |数据库查询失败 |DB 不可用/超时 |服务异常、可能需要重试 |
|55001302 |数据库插入失败 |DB 不可用/超时 |服务异常、可能需要重试 |
|55001303 |数据库更新失败 |DB 不可用/超时 |服务异常、可能需要重试 |
|55001304 |数据库删除失败 |DB 不可用/超时 |服务异常、可能需要重试 |
|55001305 |TOS上传失败 |对象存储不可用/超时 |服务异常、可能需要重试 |
|55001306 |TOS下载失败 |对象存储不可用/超时 |服务异常、可能需要重试 |
|55001307 |音色克隆失败 |voice clone 下游失败/超时/返回异常 |服务异常、可能需要重试 |





