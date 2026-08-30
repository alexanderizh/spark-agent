> 抓取日期: 2026-08-11 | 来源: https://www.volcengine.com/docs/6561 (豆包语音 / Doubao Voice, LibraryID=6561) | 渠道: 火山引擎方舟 Volcengine Ark（豆包大模型语音） | 抓取方式: getDocDetail API（`https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=<docId>`，无需鉴权，返回 JSON `.Result.MDContent` 即 markdown 原文）

# 豆包语音合成大模型（Doubao Text-To-Speech）

本文档汇总火山引擎「豆包语音」产品库（LibraryID=6561）下"语音合成大模型"全部 API 与说明，原文逐段保留。所有参数名/枚举/endpoint 均来自官方原文，未做改写。

文档树（来源：https://www.volcengine.com/docs/6561/1257536 「语音合成大模型」分组）：
- 产品简介 → docId 1257543
- 模型列表 → docId 2499930
- 同步语音合成（分组节点，正文为空）→ docId 2550870
- 单向流式语音合成 HTTP → docId 2528925
- 单向流式语音合成 WebSocket → docId 2534913
- 双向流式语音合成 WebSocket → docId 2532486
- 异步长文本语音合成（分组节点，正文为空）→ docId 2550871
- 异步长文本接口文档（旧版/详细）→ docId 1829010
- SSML 标记语言 → docId 1330194
- 语音指令与标签（豆包语音合成2.0能力介绍）→ docId 1871062


---

## 产品简介

> 文档ID: 1257543 | URL: https://www.volcengine.com/docs/6561/1257543 | 标题: 产品简介 | MDContent长度: 2559

<span id="产品说明"></span>
## 产品说明

依托新一代大模型能力，火山语音模型能够根据上下文，智能预测文本的情绪、语调等信息，并生成超自然、高保真、个性化的语音，以满足不同用户的个性化需求。相较于传统语音合成技术，大语音模型在口语**自然度、连贯性、拟人度、音质、韵律、气口、情感、语气词表达**等各方面为客户带来更生动、更具情感表现力的听觉体验。

<span id="产品优势"></span>
## 产品优势


* **自动情感理解和演绎：** 依托新一代语音大模型能力，语音模型可以根据上下文，智能预测文本情绪、语调等信息，并进行自然演绎；

* **高自然度：** 在口语自然度、连贯性、拟人度、音质、韵律、气口、情感、语气词表达等各方面，可以带来更生动、更具情感表现力的听觉体验；

* **个性化：** 可提供多种风格的超自然音色，包括趣味口音、角色扮演等类型，并且支持**超强混音能力**，用户可以将不同声音自由组合，生成新的声音，以满足不同用户的个性化需求，适配趣味聊天、视频剪辑、有声阅读等多个场景。


<span id="4be47712"></span>
## 功能特性


|功能 |大模型语音合成 |传统语音合成 |
|---|---|---|
|音色数量 |325。[音色列表--豆包语音-火山引擎](https://www.volcengine.com/docs/6561/1257544) |84。 [音色列表--豆包语音-火山引擎](https://www.volcengine.com/docs/6561/97465) |
|算法效果 |自然度、音质、韵律、气口、情感、<br><br>语气词表达接近真人的表达 |合成效果流畅自然、发音清晰。 |
|支持语种 |* 语种：中文、英文、日文、西班牙<br><br>* 方言口音：台普、北京、广州普、四川、河南、山东普、长沙 |* 语种：中、英、日、葡萄牙、西班牙、泰、越南、印尼<br><br>* 方言口音：东北、西安、上海、广西普、台普、粤语、天津、川渝、郑州、湖南普、长沙 |
|SSML |* 输出单向流式/非流式接口：支持，[SSML标记语言--豆包语音-火山引擎](https://www.volcengine.com/docs/6561/1330194)<br><br>* 输入输出双向流式接口：不支持，大模型实时吐字场景无法预知文本，不适用<br><br>* ["豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544) 暂不支持<br><br>* 豆包声音复刻模型2.0（icl 2.0）的音色暂不支持 |支持，[SSML标记语言--豆包语音-火山引擎](https://www.volcengine.com/docs/6561/1330194) |
|接入方案 |* 输出单向流式/非流式接口：流式&非流式API、在线SDK [大模型语音合成API--豆包语音-火山引擎](https://www.volcengine.com/docs/6561/1257584)<br><br>* 输入输出双向流式接口：API [大模型语音合成双向流式API--豆包语音-火山引擎](https://www.volcengine.com/docs/6561/1329505) |* 流式&非流式API<br><br>* 离线SDK |
|部署方案 |公共云 |公共云、离线sdk |
|数据需求低 |* 可实现一种声音说中英，不受限于发音人语言能力<br><br>* 只需要单语种数据，无需针对不同语种分别录音 |无跨语种迁移能力 |
|延迟 |* 输出单向流式/非流式接口：流式调用首包耗时在600ms左右；非流式调用实时率RTF约为0.5；支持流式逐字级别输出，用户体感延迟低。<br><br>* 输入输出双向流式接口：**支持流式逐字级别输入级输出**，进一步降低基于大模型的语音交互时延，用户体感延迟低 |* 流式调用首包耗时在300ms左右<br><br>* 非流式调用实时率RTF约为0.1\-0.3<br><br>* 支持流式逐字级别输出，用户体感延迟低 |
|合成音频采样率 |* 输出单向流式/非流式接口：支持24K、16k、8k<br><br>* 输入输出双向流式接口：支持48K、24K、16k、8k |支持24K、16k、8k，不支持48K |
|语音输出音频格式 |* 输出单向流式/非流式接口：pcm / ogg_opus / mp3，默认为 pcm。注意：wav 不支持流式<br><br>* 输入输出双向流式接口：pcm / ogg_opus / mp3，默认为 pcm。 |支持pcm/wav/mp3/opus格式 |
|其他功能 |* 输出单向流式/非流式接口：支持语速调整<br><br>* 输入输出双向流式接口：支持字级别时间戳、语速调整、音调调整、markdown、公式播报，Latex能力 [TTS大模型音色Latex能力支持说明](https://bytedance.larkoffice.com/docx/ZjFidvxSZov7TYxuUbzctpPonqe) |支持音素级别时间戳、语速调整、音调调整、音高调整 |


<span id="应用场景"></span>
## 应用场景


|**应用场景** |**场景描述** |
|---|---|
|聊天陪伴 |用于豆包等同等类型聊天陪伴场景，通过文本预测控制音色的重音、停顿，赋予音色多样的语气，提供超自然拟真人的交互体验 |
|有声书合成 |在自然播报的基础上，实现笑声、哭腔等副语言现象建模能力，让AI演绎更加真实生动 |
|音视频配音 |打造多维场景音色矩阵，覆盖视频趣味剪辑、专业创作、广告营销、新闻播报、电商带货等，为各类场景提供适配性强、国民认知度高的音色 |
|数字人播报 |高拟人度表现，与数字人虚拟形象做好口型驱动配合 |
|语音客服 |用于智能客服场景，自然的TTS播报可以有类真人客服的表现 |







---

## 模型列表

> 文档ID: 2499930 | URL: https://www.volcengine.com/docs/6561/2499930 | 标题: 模型列表 | MDContent长度: 17346

本文档汇总火山语音各产品线的可用模型及其支持的功能与参数，便于您在调用接口前确认所选模型的能力边界

<span id="EHAuokQj"></span>
## 音频创作

豆包音频生成模型 1.0 (Seed\-Audio 1.0) 是业内首个可通过单条 Prompt 直接生成影视级音频的模型，支持文本、音频等多模态输入，显著降低声音创作门槛，兼顾高表现力与全要素覆盖。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">如果对某个参考音频较为满意，可使用声音复刻大模型将其训练为专属音色。此后调用时只需传入固定的 Speaker ID，无需每次重复上传同一参考音频。</div>


&nbsp;

豆包音频生成模型1.0（简称Seed Audio 1.0）的相关功能说明如下


|**功能** |**Seed Audio 1.0** |
|---|---|
|**支持语种** |中文、英文<br><br>> 可演绎方言口音，但不支持纯方言输出 |
|**参考生成限制** |* 文本<br><br>   * prompt输入限制3k字符<br><br>   * 在 prompt 中，单次用于合成人声的文本建议控制在 400 字符以内；若待合成文本过长，模型可能会在有限时长内加快语速以完成请求<br><br>* 图片：单次支持输入1张图片，支持base64编码或URL传入<br><br>* 音频：最多支持上传3条参考音频 |
|**接入方案** |非流式http接口 |
|**音频时长** |最长2min |
|**音频格式** |wav / mp3 / pcm / ogg_opus |
|**采样率** |8K,16K,24K,48K |
|**SSML** |❌ |
|**AI生成标识** |✅ |


<span id="vl9kzeFF"></span>
## 语音合成

**豆包语音合成大模型**

基于新一代语音大模型，可将文本转化为自然流畅、富有表现力的高质量语音，广泛适用于智能助手、有声内容、数字人播报、智能客服等多种业务场景。

&nbsp;

**豆包声音复刻大模型**

基于少量参考音频即可完成目标音色的复刻，生成贴近原声的合成音频，适用于个性化音色定制、品牌专属音色等场景。当前主要包含以下模型版本:


* **豆包声音复刻大模型 ** `seed-icl-2.0` **：** 支持调用声音复刻接口生成的专属音色进行音频合成


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">使用豆包声音复刻大模型（ICL）前，需先通过声音复刻接口完成目标音色的训练</div>


&nbsp;

豆包语音合成大模型2.0（简称TTS2.0）、豆包声音复刻大模型（简称ICL 2.0）的功能差异对比如下


|**模型名称** |**TTS 2.0** |**ICL 2.0** |
|---|---|---|
|**适用音色** |[豆包语音合成大模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8) |可使用声音复刻接口训练的音色 |
|**SSML** |仅支持<phoneme\>标签 |仅支持<phoneme\>标签 |
|**时间戳**<br><br>> `"enable_subtitle":True` |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_c8aca8eda799091da362ca37dc86bd2e.png) </span> |
|**语音指令**<br><br>> `"context_texts":[]` |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |
|**AIGC生成标识** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**Latex公式朗读** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |


&nbsp;

**模型支持语种**


|**语种** |**TTS 2.0** |**icl2.0** |
|---|---|---|
|中(zh) |支持 |支持 |
|英(en) |支持 |支持 |
|日(ja) |支持 |支持 |
|韩(ko) |支持 |支持 |
|墨西哥西语(mx) |支持 |支持 |
|巴西葡萄牙语(pt\-BR)  |支持 |支持 |
|印尼(id) |支持 |支持 |
|马来语（ms） |支持 |支持 |
|泰语（th） |支持 |支持 |
|越南语（vi） |支持 |支持 |
|菲律宾语（fil) |支持 |支持 |
|德语(de) |支持 |支持 |
|法语（fr） |支持 |支持 |
|西班牙西语（es） |支持 |支持 |
|俄罗斯语（ru） |支持 |支持 |
|阿拉伯(ar) |支持 |支持 |
|葡萄牙葡语（pt） | |支持 |


<span id="5eOQrdu8"></span>
## 语音识别

**豆包流式语音识别模型**

豆包流式语音识别模型基于大模型能力，可将音频实时转写为文本，实现 "边说边出字" 的交互体验。模型提供两种调用模式以适配不同业务场景


* **双向流式**：在说话过程中可逐字输出识别结果，并随着语义完整度持续修正，适用于实时会议字幕、直播字幕、智能外呼等需要即时呈现文字的场景。

* **流式输入**：在说完一句话后输出该句的完整识别结果，适用于智能体对话、语音消息转写、语音输入法等以句子为单位处理语音的场景。


按计费方式划分，模型提供以下两个版本：


* **小时版 ** `volc.seedasr.sauc.duration`：按实际语音识别时长计费，支持“资源包预付费”和“按调用后付费”两种计费模式，详见[计费说明](https://www.volcengine.com/docs/6561/1359370?lang=zh)

* **并发版 ** `volc.seedasr.sauc.concurrent`：按并发数包月付费，不再收取时长费用 ；需在[控制台](https://console.volcengine.com/speech/new/purchase?ResourceID=volc.seedasr.sauc.duration&projectName=default)预付费购买并发资源，购买后在并发额度内不限时长使用。


&nbsp;

**豆包录音文件识别模型**

支持将音频文件（ **≤5小时**）转写成文本数据，内置自动标点、语义顺滑、数字规整、智能分句等功能，可按需自由组合，适用于非实时的语音识别场景。

豆包录音文件识别模型提供三个版本，可根据对识别时效与成本的不同要求选择


|**模型版本** |<div style="text-align: center"><br><strong>豆包录音文件识别标准版</strong></div><br><br><br><div style="text-align: center"><br><code>volc.seedasr.auc</code></div><br> |<div style="text-align: center"><br><strong>豆包录音文件识别极速版</strong></div><br><br><br><div style="text-align: center"><br><code>volc.bigasr.auc_turbo</code></div><br> |<div style="text-align: center"><br><strong>豆包录音文件识别闲时版</strong></div><br><br><br><div style="text-align: center"><br><strong><code>volc.bigasr.auc_idle</code></strong></div><br> |
|---|---|---|---|
|**基本介绍** |上传录音文后，通过查询接口获得结果 |上传录音文件后快速返回结果，无需查询 |利用闲时算力识别，成本更低 |
|**返回时间** |适中，3h内返回 |极速，30min音频10s返回 |较慢，24h内返回 |
|**音频时长** |<5h |<2 |<5h |
|**文件大小** |<512MB |<100MB |<512MB |
|**音频格式** |raw / wav / mp3 / ogg |wav / mp3 / ogg |raw / wav / mp3 / ogg |


三个版本在功能支持上略有差异，对比如下:


|**功能项** |<div style="text-align: center"><br><strong>豆包流式语音识别模型2.0</strong></div><br> ||<div style="text-align: center"><br><strong>豆包录音文件识别模型2.0</strong></div><br> |||
|---|---|---|---|---|---|
|**接入方式** |**双向流式** |**流式输入** |**标准版** |**极速版** |**闲时版** |
|**支持语种** |中英文 |中英文、方言、小语种 |中英文、方言、小语种 |中英文、方言、小语种 |中英文、方言、小语种 |
|**热词** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**正则替换词** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**敏感词过滤** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**智能分句** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**字/词时间戳** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**上下文** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**语义顺滑**<br><br>> `"enable_ddc":True`<br><br>> 目前仅支持中英文 |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**文本归一化**<br><br>> `"enable_itn":True`<br><br>> 开启后：“一九七零年”\-\>“1970年 |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**双声道识别** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**输出语音停顿、分句、分词信息** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**性别检测** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**语种检测** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**情绪检测** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**Function Call**<br><br>> 支持音乐、地图领域的推荐词辅助识别 |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span><br><br> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |
|**说话人分离** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |


&nbsp;

<span id="MRw2wxTm"></span>
## 实时语音

豆包端到端实时语音大模型是一款超拟人、低时延的实时语音交互模型，采用端到端架构直接处理语音输入与输出，在保证自然拟人表达的同时显著降低交互延迟，主要用于实现语音对话交互能力。模型支持**中文**和**英文**两大语种，目前提供以下两个版本:

**S2S\-Omni版本（S2S\-O版本）** ：面向通用语音交互的端到端低时延模型，引入合规授权曲库，支持唱歌等富媒体表达，适用于闲聊陪伴、智能客服、车载交互等多种场景

**S2S\-Strong Character版本**：面向角色扮演与情感陪伴的强人格模型，内置完善的角色控制指令体系，输出文本可携带角色相关的动作与表情描述，适用于虚拟陪伴、互动剧情、IP 角色对话等场景


|**功能** |**O2.0版本** |**SC2.0版本** |
|---|---|---|
|**精品音色**<br><br>> 包含音色：vv、xiaohe、yunzhou、xiaotian |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |
|**System Prompt配置** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**复刻音色**<br><br>> 支持声音复刻v3接口克隆的音色 |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**唱歌** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5b65f36c2a362602747d3fe37cc29895.png) </span> |
|**联网搜索** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**热词** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**正则替换词** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |
|**AIGC内容标识** |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2204755b0a4036d4cab75d9a562fefdd.png) </span> |


&nbsp;






---

## 同步语音合成（分组节点）

> 文档ID: 2550870 | URL: https://www.volcengine.com/docs/6561/2550870 | 标题:  | MDContent长度: 0

> 该文档为分组节点（容器），无独立正文；其子文档已分别在本文件其他段落中收录。


---

## 单向流式语音合成 HTTP

> 文档ID: 2528925 | URL: https://www.volcengine.com/docs/6561/2528925 | 标题: 单向流式语音合成HTTP | MDContent长度: 5833

基于 HTTP Chunked 协议的单向流式合成接口，一次性输入文本，流式返回音频，支持中、英、日、西等多语种及多种方言口音。

&nbsp;

<span data-label="purple">POST</span> `https://openspeech.bytedance.com/api/v3/tts/unidirectional`


<span id="FB4hcqC8"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|M22Sxg">必选</span>

请求的模型版本，可选值：


* `seed-tts-2.0`:豆包语音合成大模型2.0，支持使用[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)

* `seed-icl-2.0`:豆包声音复刻大模型2.0，支持使用声音复刻接口克隆的音色，具体音色详见[控制台>音色库](https://console.volcengine.com/speech/new/voices?projectName=default)



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|M22Sxg">必选</span>

标识客户端请求ID，uuid随机字符串



**X\-Control\-Require\-Usage\-Tokens\-Return ** `string`

若设置为`*`，会返回计费的字符数




<span id="sFZZSkH5"></span>
### 请求体


**req_params ** `object` <span data-api-tag="require|SL5CNq">必选</span>


**text ** `string` <span data-api-tag="require|uo2J0a">必选</span>

待合成的输入文本



**model** `string`

具体模型版本，当`speaker`参数为复刻音色时使用，默认值：


* `seed-tts-2.0-standard`

   * 不支持使用语音指令`context_texts`



**speaker** `string` <span data-api-tag="require|dQHTIf">必选</span>

音色 ID，可从[控制台 > 音色库](https://console.volcengine.com/speech/new/voices?projectName=default)获取



**ssml** `string`

SSML 标记文本，启用后按 SSML 规则解析 `text`


* 目前仅中英文音色支持ssml，音色详见：[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)

* 不能同时设置`disable_markdown_filter` 为`true` 


详见：[SSML标记语言](https://www.volcengine.com/docs/6561/1330194?lang=zh)



**audio_params** `object` <span data-api-tag="require|TpaG6z">必选</span>

音频参数


**format** `string`

音频格式，支持 `mp3` / `pcm` / `ogg_opus` / `wav`

默认值：`mp3`

注意：流式场景推荐使用`pcm`，不建议使用`wav`



**sample_rate** `int`

音频采样率，单位 Hz，可选值：

[`8000`,`16000`,`22050`,`24000`,`32000`,`44100`,`48000`]


&nbsp;


**bit_rate** `int`

音频比特率，单位 bps，默认范围[`64000`,`160000`]

注意：该参数仅对 `mp3` 格式的音频生效



**speech_rate** `int`

语速，取值范围 [`-50`, `100`]，其中，取值`100`代表2.0倍速，`-50`代表0.5倍速



**loudness_rate** `int`

音量，取值范围 [`-50`, `100`]，其中，取值`100`代表2.0倍音量，`-50`代表0.5倍音量



**enable_subtitle** `bool`

是否开启字幕服务，开启后，返回字级别的时间戳

可选值：`true`, `false`

默认值：`false`

&nbsp;

注意：


* 仅豆包语音合成大模型2.0支持该参数

* 目前该参数仅支持中文、英文




**additions** `string` 


**max_length_to_filter_parenthesis ** `int`

是否过滤括号内的部分，0为不过滤，100为过滤



**silence_duration** `int`

在文本末尾增加静音时长，单位 ms

范围：[`0`,`30000`]

默认值：`0`



**disable_markdown_filter** `bool`

是否开启 Markdown解析过滤

`true`：开启过滤，会解析并去除 Markdown 语法。例如" \*\*你好\*\* "朗读为 "你好"

`false`：关闭过滤，保留原始字符。例如 " \*\*你好\*\* " 朗读为 "星星你好星星"

默认值：`false`



**disable_emoji_filter** `bool`

是否开启Emoji解析过滤

可选值：`true`, `false`

默认值：`false`



**enable_latex_tn** `bool`

是否启用 Latex文本朗读能力

可选值：`true`, `false`

默认值：`false`



**latex_parser** `string`

是否启用更强的Latex文本朗读能力

可选值：`v2`

注意：


* 该参数适用于教育场景，启用该参数后，时延会增加

* 开启该参数时，需将`disable_markdown_filter`设置为`true`



**explicit_language** `string`

显式指定朗读语种。开启后，仅朗读指定语种的文本，其他语种的内容会被跳过或合成失败，取值如下


* `zh-cn`：中文为主，支持中英混读

* `en`：仅朗读英语

* `ja`：仅朗读日语

* `es-mx`：仅朗读墨西哥语

* `id`：仅朗读印度尼西亚语

* `pt-br`：仅朗读巴西葡萄牙语

* `pt`：仅朗读葡萄牙语

* `ko`：仅朗读韩语

* `it`：仅意大利语

* `de`：仅德语

* `fr`：仅法语

* `th`：仅泰语

* `vi`：仅越南语

* `ru`：仅俄语

* `fil`：仅菲律宾语

* `ms`：仅马来语

* `ar`：仅阿拉伯语

* `pl`：仅波兰语

* `tr`：仅土耳其语

* `sv`：仅瑞典语


注意：启用该参数后，输入文本须包含指定语种的内容，否则请求将无法正常返回



**explicit_dialect** `string`

指定方言。


* `beijing`：北京话

* `dongbei`：东北话

* `henan`：河南话

* `shaanxi`：陕西话

* `shanghai`：上海话

* `sichuan`：四川话

* `tianjin`：天津话

* `yue`：粤语


注意：使用该参数时，`speaker`需要设置支持方言的音色，详见[音色列表](https://www.volcengine.com/docs/6561/1257544?lang=zh)



**aigc_watermark** `bool`

AIGC生成标识。开启后，会在音频合成结尾添加节奏标识

默认值：`false`



**aigc_metadata** `object`

在合成音频中添加meta水印，支持音频格式 `mp3` / `wav` / `ogg_opus`


**enable ** `bool`

是否启用meta隐式水印

默认值：`false`



**content_producer ** `string`

合成服务提供者的名称或编码



**produce_id ** `string`

内容制作编号



**content_propagator ** `string`

内容传播服务提供者的名称或编码



**propagate_id ** `string`

内容传播编号






**cache_config** `object`

缓存相关配置


**text_type ** `int`

文本类型标识。需和`use_cache`一起使用，需要开启缓存时取`0`



**use_cache ** `bool`

是否启用缓存。需和`text_type`一起使用，需要开启缓存时传`true`




**post_process** `object`


**pitch ** `int`

音调，取值范围`[-12,12]`




**context_texts** `array`

语音指令。

注意：


* 当`speaker`参数设置为[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)时，可直接使用语音指令

* 当`speaker`参数设置为复刻音色时，暂不支持；

* 该字段文本不参与计费


示例：

```Python
"context_texts":[ "你可以用特别特别痛心的语气说话吗?"]
```




**section_id ** `string`

段落标识，用于跨包语义保持。

注意：该参数支持[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)、豆包声音复刻大模型2.0音色



**tone_fidelity ** **`bool`**

是否开启还原模式，开启后模型将尽可能还原送入的训练的prompt音频音色和说话风格（情感、韵律、口音等）

默认值：`false`

**注意：仅适用于**豆包声音复刻大模型2.0音色，**仅支持**合成和训练音频同语种的文本 **，不支持**跨语种合成 **，不支持**双向流合成接口








<span id="a3OkyUqJ"></span>
### 响应


**X\-Tt\-Logid ** `string`

服务端返回的 logid，用于在咨询或者反馈时定位问题



**code ** `int`

状态码



**message ** `string`

状态详情



**data ** `string`

合成音频数据，base64编码



**sentence ** `object`


**phonemes ** `object`

音素相关时间戳



**text ** `string`

合成音频文本



**words ** `object`

字级别时间戳


**confidence ** `float`

时间戳置信度，范围 0~1



**startTime ** `float`

开始时间（秒）



**endTime ** `float`

结束时间（秒）



**word ** `string`

字





**usage ** `object`

本次请求的资源消耗统计


**text_words ** `int`

本次请求计费的文本字数（含标点）







---

## 单向流式语音合成 WebSocket

> 文档ID: 2534913 | URL: https://www.volcengine.com/docs/6561/2534913 | 标题: 单向流式语音合成WebSocket | MDContent长度: 6881

基于 WebSocket 协议的单向流式合成接口，一次性输入文本，流式返回音频，支持中、英、日、西等多语种及多种方言口音。

&nbsp;

**运行依赖文件**


<Tabs>
<Tab zoneid="nOgZsuTCMB" title="Python">
<TabTitle>Python</TabTitle>

<Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_42a6c874fbeda2e99b2795bce84fa30d.zip" name="websocket unidirectional.zip">websocket unidirectional.zip</Attachment>



</Tab>
<Tab zoneid="KIDesE9Pmo" title="Java">
<TabTitle>Java</TabTitle>

<Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_321ac6b07f43505fd41e2997fc15ceea.zip" name="websocket unidirectional.zip">websocket unidirectional.zip</Attachment>



</Tab>
</Tabs>



---



&nbsp;

<span data-label="purple">WSS</span>`wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream`


<span id="FB4hcqC8"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

&nbsp;

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|M22Sxg">必选</span>

请求的模型版本，可选值：


* `seed-tts-2.0`:豆包语音合成大模型2.0，支持使用[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)

* `seed-icl-2.0`:豆包声音复刻大模型2.0，支持使用声音复刻接口克隆的音色，具体音色详见[控制台>音色库](https://console.volcengine.com/speech/new/voices?projectName=default)



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|M22Sxg">必选</span>

标识客户端请求ID，uuid随机字符串



**X\-Control\-Require\-Usage\-Tokens\-Return ** `string`

若设置为`*`，会返回计费的字符数




<span id="sFZZSkH5"></span>
### 请求体


**req_params ** `object` <span data-api-tag="require|SL5CNq">必选</span>


**text ** `string` <span data-api-tag="require|uo2J0a">必选</span>

待合成的输入文本



**model** `string`

具体模型版本，当`speaker`参数为复刻音色时使用，默认值：


* `seed-tts-2.0-standard`

   * 不支持使用语音指令`context_texts`



**speaker** `string` <span data-api-tag="require|dQHTIf">必选</span>

音色 ID，可从[控制台 > 音色库](https://console.volcengine.com/speech/new/voices?projectName=default)获取



**ssml** `string`

SSML 标记文本，启用后按 SSML 规则解析 `text`


* 目前仅中英文音色支持ssml，音色详见：[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)

* 不能同时设置`disable_markdown_filter` 为`true` 


详见：[SSML标记语言](https://www.volcengine.com/docs/6561/1330194?lang=zh)



**audio_params** `object` <span data-api-tag="require|TpaG6z">必选</span>

音频参数


**format** `string`

音频格式，支持 `mp3` / `pcm` / `ogg_opus` / `wav`

默认值：`mp3`

注意：流式场景推荐使用`pcm`，不建议使用`wav`



**sample_rate** `int`

音频采样率，单位 Hz，可选值：

[`8000`,`16000`,`22050`,`24000`,`32000`,`44100`,`48000`]


&nbsp;


**bit_rate** `int`

音频比特率，单位 bps，默认范围[`64000`,`160000`]

注意：该参数仅对 `mp3` 格式的音频生效



**speech_rate** `int`

语速，取值范围 [`-50`, `100`]，其中，取值`100`代表2.0倍速，`-50`代表0.5倍速



**loudness_rate** `int`

音量，取值范围 [`-50`, `100`]，其中，取值`100`代表2.0倍音量，`-50`代表0.5倍音量



**enable_subtitle** `bool`

是否开启字幕服务，开启后，返回字级别的时间戳

可选值：`true`, `false`

默认值：`false`

&nbsp;

注意：


* 仅豆包语音合成大模型2.0支持该参数

* 目前该参数仅支持中文、英文




**additions** `string` 


**max_length_to_filter_parenthesis ** `int`

是否过滤括号内的部分，0为不过滤，100为过滤



**silence_duration** `int`

在文本末尾增加静音时长，单位 ms

范围：[`0`,`30000`]

默认值：`0`



**disable_markdown_filter** `bool`

是否开启 Markdown解析过滤

`true`：开启过滤，会解析并去除 Markdown 语法。例如" \*\*你好\*\* "朗读为 "你好"

`false`：关闭过滤，保留原始字符。例如 " \*\*你好\*\* " 朗读为 "星星你好星星"

默认值：`false`



**disable_emoji_filter** `bool`

是否开启Emoji解析过滤

可选值：`true`, `false`

默认值：`false`



**enable_latex_tn** `bool`

是否启用 Latex文本朗读能力

可选值：`true`, `false`

默认值：`false`



**latex_parser** `string`

是否启用更强的Latex文本朗读能力

可选值：`v2`

注意：


* 该参数适用于教育场景，启用该参数后，时延会增加

* 开启该参数时，需将`disable_markdown_filter`设置为`true`



**explicit_language** `string`

显式指定朗读语种。开启后，仅朗读指定语种的文本，其他语种的内容会被跳过或合成失败，取值如下


* `zh-cn`：中文为主，支持中英混读

* `en`：仅朗读英语

* `ja`：仅朗读日语

* `es-mx`：仅朗读墨西哥语

* `id`：仅朗读印度尼西亚语

* `pt-br`：仅朗读巴西葡萄牙语

* `pt`：仅朗读葡萄牙语

* `ko`：仅朗读韩语

* `it`：仅意大利语

* `de`：仅德语

* `fr`：仅法语

* `th`：仅泰语

* `vi`：仅越南语

* `ru`：仅俄语

* `fil`：仅菲律宾语

* `ms`：仅马来语

* `ar`：仅阿拉伯语

* `pl`：仅波兰语

* `tr`：仅土耳其语

* `sv`：仅瑞典语


注意：启用该参数后，输入文本须包含指定语种的内容，否则请求将无法正常返回



**explicit_dialect** `string`

指定方言。


* `beijing`：北京话

* `dongbei`：东北话

* `henan`：河南话

* `shaanxi`：陕西话

* `shanghai`：上海话

* `sichuan`：四川话

* `tianjin`：天津话

* `yue`：粤语


注意：使用该参数时，`speaker`需要设置支持方言的音色，详见[音色列表](https://www.volcengine.com/docs/6561/1257544?lang=zh)



**aigc_watermark** `bool`

AIGC生成标识。开启后，会在音频合成结尾添加节奏标识

默认值：`false`



**aigc_metadata** `object`

在合成音频中添加meta水印，支持音频格式 `mp3` / `wav` / `ogg_opus`


**enable ** `bool`

是否启用meta隐式水印

默认值：`false`



**content_producer ** `string`

合成服务提供者的名称或编码



**produce_id ** `string`

内容制作编号



**content_propagator ** `string`

内容传播服务提供者的名称或编码



**propagate_id ** `string`

内容传播编号




**cache_config** `object`

缓存相关配置


**text_type ** `int`

文本类型标识。需和`use_cache`一起使用，需要开启缓存时取`0`



**use_cache ** `bool`

是否启用缓存。需和`text_type`一起使用，需要开启缓存时传`true`




**post_process** `object`


**pitch ** `int`

音调，取值范围`[-12,12]`




**context_texts** `array`

语音指令。

注意：


* 当`speaker`参数设置为[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)时，可直接使用语音指令

* 当`speaker`参数设置为复刻音色时，暂不支持；

* 该字段文本不参与计费


示例：

```Python
"context_texts":[ "你可以用特别特别痛心的语气说话吗?"]
```




**section_id ** `string`

段落标识，用于跨包语义保持。

注意：该参数支持[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)、豆包声音复刻大模型2.0音色



**tone_fidelity ** **`bool`**

是否开启还原模式，开启后模型将尽可能还原送入的训练的prompt音频音色和说话风格（情感、韵律、口音等）

默认值：`false`

**注意：仅适用于**豆包声音复刻大模型2.0音色，**仅支持**合成和训练音频同语种的文本 **，不支持**跨语种合成 **，不支持**双向流合成接口








<span id="U2bG8YW8"></span>
### 响应


**X\-Tt\-Logid ** `string`

服务端返回的 logid，用于在咨询或者反馈时定位问题



**EventType** `string`

响应事件类型。包含以下几种事件


* `TTSSentenceStart`：开始合成音频

* `TTSResponse`：音频合成内容

* `TTSSentenceEnd`：音频合成结束

* `TTSSubtitle`：返回音频合成字幕

* `SessionFinished`：会话结束



**MsgType ** `string`

消息类型。响应消息类型有以下两种


* `FullServerResponse`

* `AudioOnlyServer`



**session_id ** `string`

会话 ID，用于标识一次合成会话



**payloadSize ** `int`

返回的音频片段大小，单位是字节



**payload ** `object`

当前事件携带的响应内容


**phonemes ** `object`

音素相关时间戳



**text ** `string`

合成音频文本



**words ** `object`

字级别时间戳


**confidence ** `float`

时间戳置信度，范围 0~1



**startTime ** `float`

开始时间（秒）



**endTime ** `float`

结束时间（秒）



**word ** `string`

字




**usage ** `object`

本次请求的资源消耗统计


**text_words ** `int`

本次请求计费的文本字数（含标点）







&nbsp;

&nbsp;






---

## 双向流式语音合成 WebSocket

> 文档ID: 2532486 | URL: https://www.volcengine.com/docs/6561/2532486 | 标题: 双向流式语音合成WebSocket | MDContent长度: 6619

基于 WebSocket 的双向流式 TTS 接口，支持文本流式输入、音频流式输出，低时延，适用于实时交互场景，覆盖多语种与多方言。

&nbsp;

> **运行依赖文件**

> <Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_5ec6e28945592c909158dc1e2cf9a89c.zip" name="TTS Websocket Bidirection protocols.zip">TTS Websocket Bidirection protocols.zip</Attachment>




---



<span data-label="purple">WSS</span>`wss://openspeech.bytedance.com/api/v3/tts/bidirection`


<span id="PCfPA9a9"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|9gv9Vz">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|M22Sxg">必选</span>

请求的模型版本，可选值：


* `seed-tts-2.0`:豆包语音合成大模型2.0，支持使用[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)

* `seed-icl-2.0`:豆包声音复刻大模型2.0，支持使用声音复刻接口克隆的音色，具体音色详见[控制台>音色库](https://console.volcengine.com/speech/new/voices?projectName=default)



**X\-Api\-Connect\-Id** `string` 

用于追踪当前连接情况的标志 ID



**X\-Control\-Require\-Usage\-Tokens\-Return ** `string`

若设置为`*`，会返回计费的字符数




<span id="cdSz2CLG"></span>
### 事件


**建立连接**


**EventType ** `string`

请求事件类型。建立连接时，字段固定为`StartConnection`




**创建会话**


**EventType ** `string`

请求事件类型。创建会话时，字段固定为`StartSession`



**session_id ** `string`

合成会话id，由客户端生成



**req_params ** `object` <span data-api-tag="require|SL5CNq">必选</span>


**model** `string`

具体模型版本，当`speaker`参数为复刻音色时使用，默认值：


* `seed-tts-2.0-standard`

   * 不支持使用语音指令`context_texts`



**speaker** `string` <span data-api-tag="require|dQHTIf">必选</span>

音色 ID，可从[控制台 > 音色库](https://console.volcengine.com/speech/new/voices?projectName=default)获取


&nbsp;


**audio_params** `object` <span data-api-tag="require|TpaG6z">必选</span>

音频参数


**format** `string`

音频格式，支持 `mp3` / `pcm` / `ogg_opus` / `wav`

默认值：`mp3`

注意：流式场景推荐使用`pcm`，不建议使用`wav`



**sample_rate** `int`

音频采样率，单位 Hz，可选值：

[`8000`,`16000`,`22050`,`24000`,`32000`,`44100`,`48000`]



**bit_rate** `int`

音频比特率，单位 bps，默认范围[`64000`,`160000`]

注意：该参数仅对 `mp3` 格式的音频生效



**speech_rate** `int`

语速，取值范围 [`-50`, `100`]，其中，取值`100`代表2.0倍速，`-50`代表0.5倍速



**loudness_rate** `int`

音量，取值范围 [`-50`, `100`]，其中，取值`100`代表2.0倍音量，`-50`代表0.5倍音量



**enable_subtitle** `bool`

是否开启字幕服务，开启后，返回字级别的时间戳

可选值：`true`, `false`

默认值：`false`

&nbsp;

注意：


* 仅豆包语音合成大模型2.0支持该参数

* 目前该参数仅支持中文、英文




**additions** `string` 


**max_length_to_filter_parenthesis ** `int`

是否过滤括号内的部分，0为不过滤，100为过滤



**disable_markdown_filter**`bool`

是否开启 Markdown解析过滤

`true`：开启过滤，会解析并去除 Markdown 语法。例如" \*\*你好\*\* "朗读为 "你好"

`false`：关闭过滤，保留原始字符。例如 " \*\*你好\*\* " 朗读为 "星星你好星星"

默认值：`false`



**disable_emoji_filter** `bool`

是否开启Emoji解析过滤

可选值：`true`, `false`

默认值：`false`



**enable_latex_tn** `bool`

是否启用 Latex文本朗读能力

可选值：`true`, `false`

默认值：`false`



**latex_parser** `string`

是否启用更强的Latex文本朗读能力

可选值：`v2`

注意：


* 该参数适用于教育场景，启用该参数后，时延会增加

* 开启该参数时，需将`disable_markdown_filter`设置为`true`



**explicit_language** `string`

显式指定朗读语种。开启后，仅朗读指定语种的文本，其他语种的内容会被跳过或合成失败，取值如下


* `zh-cn`：中文为主，支持中英混读

* `en`：仅朗读英语

* `ja`：仅朗读日语

* `es-mx`：仅朗读墨西哥语

* `id`：仅朗读印度尼西亚语

* `pt-br`：仅朗读巴西葡萄牙语

* `pt`：仅朗读葡萄牙语

* `ko`：仅朗读韩语

* `it`：仅意大利语

* `de`：仅德语

* `fr`：仅法语

* `th`：仅泰语

* `vi`：仅越南语

* `ru`：仅俄语

* `fil`：仅菲律宾语

* `ms`：仅马来语

* `ar`：仅阿拉伯语

* `pl`：仅波兰语

* `tr`：仅土耳其语

* `sv`：仅瑞典语


注意：启用该参数后，输入文本须包含指定语种的内容，否则请求将无法正常返回



**explicit_dialect** `string`

指定方言。


* `beijing`：北京话

* `dongbei`：东北话

* `henan`：河南话

* `shaanxi`：陕西话

* `shanghai`：上海话

* `sichuan`：四川话

* `tianjin`：天津话

* `yue`：粤语


注意：使用该参数时，`speaker`需要设置支持方言的音色，详见[音色列表](https://www.volcengine.com/docs/6561/1257544?lang=zh)



**aigc_watermark** `bool`

AIGC生成标识。开启后，会在音频合成结尾添加节奏标识

默认值：`false`



**aigc_metadata** `object`

在合成音频中添加meta水印，支持音频格式 `mp3` / `wav` / `ogg_opus`


**enable ** `bool`

是否启用meta隐式水印

默认值：`false`



**content_producer**`string`

合成服务提供者的名称或编码



**produce_id ** `string`

内容制作编号



**content_propagator**`string`

内容传播服务提供者的名称或编码



**propagate_id ** `string`

内容传播编号




**cache_config** `object`

缓存相关配置


**text_type ** `int`

文本类型标识。需和`use_cache`一起使用，需要开启缓存时取`0`



**use_cache ** `bool`

是否启用缓存。需和`text_type`一起使用，需要开启缓存时传`true`




**post_process** `object`


**pitch ** `int`

音调，取值范围`[-12,12]`




**context_texts** `array`

语音指令。

注意：


* 当`speaker`参数设置为[豆包语音合成模型2.0音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)时，可直接使用语音指令

* 当`speaker`参数设置为复刻音色时，暂不支持；

* 该字段文本不参与计费


示例：

```Python
"context_texts":[ "你可以用特别特别痛心的语气说话吗?"]
```






**section_id** `string`

多轮会话 ID 用于关联同一上下文中的多次串行语音合成请求。服务端通过该 ID 在一次语音合成结束后保存对话历史，并在后续语音合成请求中，使用相同的 ID 读取对应的历史记录。

取值示例：如在一通电话中的多次 TTS 请求，建议为该通电话使用 UUID 生成一个唯一的 section_id，并在所有 TTS 请求中传递相同的 section_id。

示例：section_id="bf5b5771\-31cd\-4f7a\-b30c\-f4ddcbf2f9da"

注意：


1. 该字段仅适用于["豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544?lang=zh)，“豆包声音复刻大模型 2.0”的音色。

2. 服务端对历史上下文有相应的轮数限制和超时时间。








**发送请求**


**EventType ** `string`

请求事件类型。发送请求时，字段固定为`TaskRequest`



**session_id ** `string`

合成会话ID



**text ** `string` <span data-api-tag="require|b6EFQy">必选</span>

待合成的输入文本




**取消会话**


**EventType ** `string`

请求事件类型。取消会话时，字段固定为`CancelSession`




**结束会话**


**EventType ** `string`

请求事件类型。结束会话时，字段固定为`FinishSession`




**结束连接**


**EventType ** `string`

请求事件类型。结束连接时，字段固定为`FinishConnection`





<span id="U2bG8YW8"></span>
### 响应


**EventType** `string`

响应事件类型。包含以下几种事件


* `ConnectionStarted`：建连成功

* `SessionStarted`：会话开始

* `TTSSentenceStart`：开始合成音频

* `TTSResponse`：音频合成内容

* `TTSSentenceEnd`：音频合成结束

* `TTSSubtitle`：返回音频合成字幕

* `SessionFinished`：会话结束

* `ConnectionFinished`：连接结束

* `SessionCanceled`：会话取消

* `ConnectionFailed`：建连失败

* `SessionFailed`：会话失败



**MsgType ** `string`

消息类型。响应消息类型有以下两种


* `FullServerResponse`

* `AudioOnlyServer`



**session_id ** `string`

会话 ID，用于标识一次合成会话



**connect_id ** `string`

连接 ID，用于标识当前 WebSocket 连接



**payload ** `object`

当前事件携带的响应内容


**phonemes ** `object`

音素相关时间戳



**text ** `string`

合成音频文本



**words ** `object`

字级别时间戳


**confidence ** `float`

时间戳置信度，范围 0~1



**startTime ** `float`

开始时间（秒）



**endTime ** `float`

结束时间（秒）



**word ** `string`

字




**usage ** `object`

本次请求的资源消耗统计


**text_words ** `int`

本次请求计费的文本字数（含标点）





&nbsp;

&nbsp;






---

## 异步长文本语音合成（分组节点）

> 文档ID: 2550871 | URL: https://www.volcengine.com/docs/6561/2550871 | 标题:  | MDContent长度: 0

> 该文档为分组节点（容器），无独立正文；其子文档已分别在本文件其他段落中收录。


---

## 异步长文本接口文档

> 文档ID: 1829010 | URL: https://www.volcengine.com/docs/6561/1829010 | 标题: 异步长文本接口文档 | MDContent长度: 17886

<span id="35355afc"></span>
# 1 接口功能

异步执行长文本任务，最大单次可执行的文本长度为**10万字符，** 合成音频数据在服务端可保存**7天。** 使用上，需要客户端submit请求后，轮询调用服务端query接口，音频合成结束后，query接口会返回合成音频的url链接。


1. submit接口：完整路径为`/api/v3/tts/submit`，用于提交任务；

2. query接口：完整路径为`/api/v3/tts/query`，用于查询结果；


**接口支持功能如下：** 


* 支持上百种精品音色，并且支持复刻音色；

* 支持**mp3**、**ogg_opus** 、 **pcm和wav**编码格式音频；

* 支持设置音频采样率、声音比特率、音量和语速；

* 支持多情感，设置情绪值；

* 支持多语种；

* 支持时间戳，即字幕返回，精确到句；

* 支持混合音色合成（mix）；

* 支持dmd版本模型，速度更快，效果更好；


**接口说明如下：** 


* 最大单次可执行的文本长度为**10万字符**；

* 计费说明：

   * 如果调用公版音色，则按“语音合成大模型”（对应volc.service_type.10029）进行开通计费，共享商品并发；

   * 如果调用复刻音色，则按“声音复刻大模型”（对应volc.megatts.default）进行开通计费，共享商品并发；

* 合成音频数据在服务端可保存**7天**；

* 存放音频的链接的失效时间是**1h**，如果链接失效请重新调用query接口查询；

* 支持非法字符检测：非法字符所占比例**大于10%** ，接口报错，需要重新提交任务（非法字符定义：ascii码中的控制符，注意不含制表符和换行符）；

* submit接口和query接口共享客户购买商品的并发，在【最佳实践】中会详细说明；

* 关于ssml说明：

   1. ssml标签支持多组完整闭合标签，例如：`<speak>第一个闭合标签</speak>和<speak>第二个闭合标签</speak>`；

   2. 在完整闭合标签内，不能包含，否则报错，例如：`<speak>不能再包含<speak>标签</speak>`；

   3. 在一个完整闭合标签内，字符数不能超过150个，否则报错，例如：`<speak>151个字符</speak>`；

   4. 未形成闭合标签的文本，会当作普通文本处理，例如：`<speak>这是第一个ssml闭合标签</speak><speak>会作为普通文本`；

   5. ssml标签本身不计费；

   6. ["豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544) 暂不支持SSML

   7. 豆包声音复刻模型2.0（icl 2.0）的音色暂不支持SSML


<span id="a5354260"></span>
## 1.1 最佳实践

submit接口和query接口，与其他TTS合成接口（例如：/api/v1/tts/ws_binary接口等）共享并发。基于此，需要客户端控制query和submit接口的并发，以防影响TTS合成请求。例如submit接口占用1并发，/api/v3/tts/query接口占用1并发。

<span id="b26e7e17"></span>
# 2 接口说明

<span id="45a4ceea"></span>
## 2.1 任务提交 submit

<span id="72ddb6fa"></span>
### 2.1.1 请求路径

`https://openspeech.bytedance.com/api/v3/tts/submit`

<span id="b7380f3f"></span>
### 2.1.2 请求Request

<span id="71b3ddfe"></span>
#### Request Headers


|Key |说明 |是否必须 |Value示例 |
|---|---|---|---|
|X\-Api\-App\-Id |使用火山引擎控制台获取的APP ID，可参考 [控制台使用FAQ-Q1](https://www.volcengine.com/docs/6561/196768#q1%EF%BC%9A%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%8F%96%E5%88%B0%E4%BB%A5%E4%B8%8B%E5%8F%82%E6%95%B0appid%EF%BC%8Ccluster%EF%BC%8Ctoken%EF%BC%8Cauthorization-type%EF%BC%8Csecret-key-%EF%BC%9F) |是 |your\-app\-id |
|X\-Api\-Access\-Key |使用火山引擎控制台获取的Access Token，可参考 [控制台使用FAQ-Q1](https://www.volcengine.com/docs/6561/196768#q1%EF%BC%9A%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%8F%96%E5%88%B0%E4%BB%A5%E4%B8%8B%E5%8F%82%E6%95%B0appid%EF%BC%8Ccluster%EF%BC%8Ctoken%EF%BC%8Cauthorization-type%EF%BC%8Csecret-key-%EF%BC%9F) |是 |your\-access\-key |
|X\-Api\-Resource\-Id |表示调用服务的资源信息 ID<br><br><br>* 豆包语音合成模型1.0：<br><br>   * seed\-tts\-1.0<br><br>   * 或者 volc.service_type.10029（字符版）<br><br>* 豆包语音合成模型2.0:<br><br>   * seed\-tts\-2.0 (字符版)<br><br>* 声音复刻：<br><br>   * seed\-icl\-1.0（声音复刻1.0字符版）<br><br>   * seed\-icl\-2.0 (声音复刻2.0字符版)<br><br><br>**注意：** <br><br><br>* "豆包语音合成模型1.0"的资源信息ID仅适用于["豆包语音合成模型1.0"的音色](https://www.volcengine.com/docs/6561/1257544)<br><br>* "豆包语音合成模型2.0"的资源信息ID仅适用于["豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544) |是 |* 豆包语音合成模型1.0：<br><br>   * seed\-tts\-1.0<br><br>* 豆包语音合成模型2.0:<br><br>   * seed\-tts\-2.0<br><br>* 声音复刻：<br><br>   * seed\-icl\-1.0（声音复刻1.0字符版）<br><br>   * seed\-icl\-2.0 (声音复刻2.0字符版) |
|X\-Api\-Request\-Id |标识客户端请求ID，uuid随机字符串 |是 |67ee89ba\-7050\-4c04\-a3d7\-ac61a63499b3 |


<span id="f897a0c2"></span>
#### Request body


|字段 |描述 |是否必须 |类型 |默认值 |
|---|---|---|---|---|
|user |用户信息 | |object | |
|user.uid |用户uid | |string | |
|unique_id |标记一次请求，不可重复，长度限制20\-64，建议使用uuid<br><br>如果传递，则taskId=uniqueId；<br><br>如果不传，则服务端会生成一个taskId； | |string | |
|namespace |请求方法 | |string |BidirectionalTTS |
|req_params.text |输入文本 | |string | |
|req_params.ssml |* 当文本格式是ssml时，需要将文本赋值为ssml，此时文本处理的优先级高于text。ssml和text字段，至少有一个不为空<br><br>* 当req_params.speaker 为["豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544) 或者 豆包声音复刻模型2.0（icl 2.0）的音色时，req_params.additions.disable_markdown_filte 不可以设置为true; | |string | |
|req_params.model |以下参数仅针对声音复刻2.0生效。默认取值：<br><br><br>* `seed-tts-2.0-standard`：标准版，延时更优，不支持语音指令QA和语音标签Cot能力。如果传入QA或Cot参数，接口会过滤掉。 | |string | |
|req_params.speaker |发音人，具体见[发音人列表](https://www.volcengine.com/docs/6561/1257544) |√ |string | |
|req_params.audio_params |音频参数，便于服务节省音频解码耗时 |√ |object | |
|req_params.audio_params.format |音频编码格式，mp3/ogg_opus/pcm。接口传入wav并不会报错，在流式场景下传入wav会多次返回wav header，这种场景建议使用pcm。 | |string |mp3 |
|req_params.audio_params.sample_rate |音频采样率，可选值 [8000,16000,22050,24000,32000,44100,48000] | |number |24000 |
|req_params.audio_params.bit_rate |音频比特率，可传16000、32000等。<br><br>bit_rate默认设置范围为64k～160k，传了disable_default_bit_rate为true后可以设置到64k以下<br><br>GoLang示例：additions = fmt.Sprintf("{"disable_default_bit_rate":true}")<br><br>注：bit_rate只针对MP3格式，wav计算比特率跟pcm一样是 比特率 (bps) = 采样率 × 位深度 × 声道数<br><br>目前大模型TTS只能改采样率，所以对于wav格式来说只能通过改采样率来变更音频的比特率 | |number | |
|req_params.audio_params.emotion |设置音色的情感。示例："emotion": "angry"<br><br>注：当前仅部分音色支持设置情感，且不同音色支持的情感范围存在不同。<br><br>详见：[大模型语音合成API-音色列表-多情感音色](https://www.volcengine.com/docs/6561/1257544) | |string | |
|req_params.audio_params.emotion_scale |调用emotion设置情感参数后可使用emotion_scale进一步设置情绪值，范围1~5，不设置时默认值为4。<br><br>注：理论上情绪值越大，情感越明显。但情绪值1~5实际为非线性增长，可能存在超过某个值后，情绪增加不明显，例如设置3和5时情绪值可能接近。 | |number |4 |
|req_params.audio_params.speech_rate |语速，取值范围[\-50,100]，100代表2.0倍速，\-50代表0.5倍数 | |number |0 |
|req_params.audio_params.loudness_rate |音量，取值范围[\-50,100]，100代表2.0倍音量，\-50代表0.5倍音量（mix音色暂不支持） | |number |0 |
|req_params.audio_params.enable_timestamp |设置 "enable_timestamp": true 返回字与音素时间戳（默认为 flase，参数传入 true 即表示启用） | |bool |false |
|req_params.additions |用户自定义参数 | |jsonstring | |
|req_params.additions.silence_duration |设置该参数可在句尾增加静音时长，范围0~30000ms。（注：增加的句尾静音主要针对传入文本最后的句尾，而非每句话的句尾） | |number |0 |
|req_params.additions.enable_language_detector |自动识别语种 | |bool |false |
|req_params.additions.disable_markdown_filter |是否开启markdown解析过滤，<br><br>为true时，解析并过滤markdown语法，例如，你好，会读为“你好”，<br><br>为false时，不解析不过滤，例如，你好，会读为“星星‘你好’星星” | |bool |false |
|req_params.additions.disable_emoji_filter |开启emoji表情在文本中不过滤显示，默认为false，建议搭配时间戳参数一起使用。<br><br>GoLang示例：additions = fmt.Sprintf("{"disable_emoji_filter":true}") | |bool |false |
|req_params.additions.mute_cut_remain_ms |该参数需配合mute_cut_threshold参数一起使用，其中：<br><br>"mute_cut_threshold": "400", // 静音判断的阈值（音量小于该值时判定为静音）<br><br>"mute_cut_remain_ms": "50", // 需要保留的静音长度<br><br>注：参数和value都为string格式<br><br>Golang示例：additions = fmt.Sprintf("{"mute_cut_threshold":"400", "mute_cut_remain_ms": "1"}")<br><br>特别提醒：<br><br><br>* 因MP3格式的特殊性，句首始终会存在100ms内的静音无法消除，WAV格式的音频句首静音可全部消除，建议依照自身业务需求综合判断选择 | |string | |
|req_params.additions.enable_latex_tn |是否可以播报latex公式，需将disable_markdown_filter设为true | |bool |false |
|req_params.additions.latex_parser |是否使用lid 能力播报latex公式，相较于latex_tn 效果更好；<br><br>值为“v2”时支持lid能力解析公式，值为“”时不支持lid；<br><br>需同时将disable_markdown_filter设为true； | |string | |
|req_params.additions.max_length_to_filter_parenthesis |是否过滤括号内的部分，0为不过滤，100为过滤 | |int |100 |
|req_params.additions.explicit_language（明确语种） |仅读指定语种的文本<br><br>精品音色和 ICL 声音复刻场景：<br><br><br>* 不给定参数，正常中英混<br><br>* `crosslingual` 启用多语种前端（包含`zh/en/es-mx/id/pt-br`）<br><br>* `zh-cn` 中文为主，支持中英混<br><br>* `en` 仅英文<br><br>* `es-mx` 仅墨西<br><br>* `id` 仅印尼<br><br>* `pt-br` 仅巴葡<br><br><br>DIT 声音复刻场景：<br><br>当音色是使用model_type=2训练的，即采用dit标准版效果时，建议指定明确语种，目前支持：<br><br><br>* 不给定参数，启用多语种前端`zh,en,es-mx,id,pt-br,de,fr`<br><br>* `zh,en,es-mx,id,pt-br,de,fr` 启用多语种前端<br><br>* `zh-cn` 中文为主，支持中英混<br><br>* `en` 仅英文<br><br>* `es-mx` 仅墨西<br><br>* `id` 仅印尼<br><br>* `pt-br` 仅巴葡<br><br>* `de` 仅德语<br><br>* `fr` 仅法语<br><br><br>当音色是使用model_type=3训练的，即采用dit还原版效果时，必须指定明确语种，目前支持：<br><br><br>* 不给定参数，正常中英混<br><br>* `zh-cn` 中文为主，支持中英混<br><br>* `en` 仅英文<br><br><br>GoLang示例：additions = fmt.Sprintf("{"explicit_language": "zh"}") | |string | |
|req_params.additions.context_language（参考语种） |给模型提供参考的语种<br><br><br>* 不给定 西欧语种采用英语<br><br>* id 西欧语种采用印尼<br><br>* es 西欧语种采用墨西<br><br>* pt 西欧语种采用巴葡 | |string | |
|req_params.additions.unsupported_char_ratio_thresh |默认: 0.3，最大值: 1.0<br><br>检测出不支持合成的文本超过设置的比例，则会返回错误。 | |float |0.3 |
|req_params.additions.aigc_watermark |默认：false<br><br>是否在合成结尾增加音频节奏标识 | |bool |false |
|req_params.additions.cache_config（缓存相关参数） |开启缓存，开启后合成相同文本时，服务会直接读取缓存返回上一次合成该文本的音频，可明显加快相同文本的合成速率，缓存数据保留时间1小时。<br><br>（通过缓存返回的数据不会附带时间戳）<br><br>Golang示例：additions = fmt.Sprintf("{"disable_default_bit_rate":true, "cache_config": {"text_type": 1,"use_cache": true}}") | |object | |
|req_params.additions.cache_config.text_type（缓存相关参数） |和use_cache参数一起使用，需要开启缓存时传1 | |int |1 |
|req_params.additions.cache_config.use_cache（缓存相关参数） |和text_type参数一起使用，需要开启缓存时传true | |bool |true |
|req_params.additions.post_process |后处理配置<br><br>Golang示例：additions = fmt.Sprintf("{"post_process":{"pitch":12}}") | |object | |
|req_params.additions.post_process.pitch |音调取值范围是[\-12,12] | |int |0 |
|req_params.mix_speaker |混音参数结构<br><br>注意：<br><br><br>1. 该字段仅适用于["豆包语音合成模型1.0"的音色](https://www.volcengine.com/docs/6561/1257544) | |object | |
|req_params.mix_speaker.speakers |混音音色名以及影响因子列表<br><br>注意：<br><br><br>1. 最多支持3个音色混音<br><br>2. 音色风格差异较大的两个音色（如男女混），以0.5\-0.5同等比例混合时，可能出现偶发跳变，建议尽量避免<br><br>3. 使用Mix能力时，req_params.speaker = custom_mix_bigtts | |list |null |
|req_params.mix_speaker.speakers[i].source_speaker |混音源音色名<br><br>注意：<br><br><br>1. 支持["豆包语音合成模型1.0"的音色](https://www.volcengine.com/docs/6561/1257544)、声音复刻大模型的音色<br><br>2. 使用声音复刻大模型音色时，使用`S_`开头的`speakerid`，或者使用查询接口获取的`icl_`的`speakerid`，不支持`DiT_`或者 `saturn_`开头的`speakerid` | |string |"" |
|req_params.mix_speaker.speakers[i].mix_factor |混音源音色名影响因子<br><br>注意：<br><br><br>1. 混音影响因子和必须=1 | |float |0 |


请求参数示例：

```JSON
{
    "user": {
        "uid": "12345"
    },
    "unique_id": "5dad8cff-aa5d-496d-a83e-e9c902f4d460",
    "req_params": {
        "text": "明朝开国皇帝朱元璋也称这本书为,万物之根",
        "speaker": "custom_mix_bigtts",
        "audio_params": {
            "format": "mp3",
            "sample_rate": 24000
        },
        "mix_speaker": {
            "speakers": [{
                "source_speaker": "zh_male_bvlazysheep",
                "mix_factor": 0.3
            }, {
                "source_speaker": "BV120_streaming",
                "mix_factor": 0.3
            }, {
                "source_speaker": "zh_male_ahu_conversation_wvae_bigtts",
                "mix_factor": 0.4
            }]
        }
    }
}
```


<span id="456d4816"></span>
### 2.1.3 响应Response

<span id="3f7518a7"></span>
#### Response Headers


|Key |说明 |Value示例 |
|---|---|---|
|X\-Tt\-Logid |服务端返回的 logid，建议用户获取和打印方便定位问题 |2025041513355271DF5CF1A0AE0508E78C |


<span id="18670e65"></span>
#### Response body


|字段 |描述 |是否必须 |类型 |
|---|---|---|---|
|code |请求状态码 |是 |int |
|message |请求状态信息 |是 |string |
|data.task_id |任务id<br><br><br>1. 如果传递，则taskId为接口传递的字段；<br><br>2. 如果不传，则该字段由服务端生成； |否 |string |
|data.req_text_length |请求文本的字符数 |否 |int |
|data.task_status |任务状态 |否 |int |


任务提交成功示例：

```JSON
{
    "code": 20000000,
    "data": {
        "req_text_length": 11, 
        "task_id": "e7438a29-ed47-4ef8-98a6-0a10a503d8b0", 
        "task_status": 1
    },
    "message": "ok"
}
```


报错示例：

```JSON
{
    "code": 45000292,
    "message": "quota exceeded for types: text_words_lifetime"
}
```


<span id="34ab4050"></span>
## 2.2 任务查询 query

<span id="f895c7e9"></span>
### 2.2.1 请求路径

`https://openspeech.bytedance.com/api/v3/tts/query`

<span id="9de7306f"></span>
### 2.2.2 请求Request

<span id="4fdc2800"></span>
#### Request headers


|Key |说明 |是否必须 |Value示例 |
|---|---|---|---|
|X\-Api\-App\-Id |使用火山引擎控制台获取的APP ID，可参考 [控制台使用FAQ-Q1](https://www.volcengine.com/docs/6561/196768#q1%EF%BC%9A%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%8F%96%E5%88%B0%E4%BB%A5%E4%B8%8B%E5%8F%82%E6%95%B0appid%EF%BC%8Ccluster%EF%BC%8Ctoken%EF%BC%8Cauthorization-type%EF%BC%8Csecret-key-%EF%BC%9F) |是 |your\-app\-id |
|X\-Api\-Access\-Key |使用火山引擎控制台获取的Access Token，可参考 [控制台使用FAQ-Q1](https://www.volcengine.com/docs/6561/196768#q1%EF%BC%9A%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%8F%96%E5%88%B0%E4%BB%A5%E4%B8%8B%E5%8F%82%E6%95%B0appid%EF%BC%8Ccluster%EF%BC%8Ctoken%EF%BC%8Cauthorization-type%EF%BC%8Csecret-key-%EF%BC%9F) |是 |your\-access\-key |
|X\-Api\-Resource\-Id |表示调用服务的资源信息 ID<br><br><br>* 大模型语音合成：volc.service_type.10029<br><br>* seed\-icl\-1.0（声音复刻1.0字符版）<br><br>* seed\-icl\-2.0 (声音复刻2.0字符版)） |是 |* 大模型语音合成：volc.service_type.10029<br><br>* 声音复刻：<br><br>   * seed\-icl\-1.0（声音复刻1.0字符版）<br><br>   * seed\-icl\-2.0 (声音复刻2.0字符版)） |
|X\-Api\-Request\-Id |标识客户端请求ID，uuid随机字符串 |否 |67ee89ba\-7050\-4c04\-a3d7\-ac61a63499b3 |


<span id="afe54176"></span>
#### Request body


|字段 |描述 |是否必须 |类型 |默认值 |
|---|---|---|---|---|
|task_id |任务id |是 |string | |


示例：

```JSON
{
    "task_id": "e7438a29-ed47-4ef8-98a6-0a10a503d8b0"
}
```


<span id="c43a823f"></span>
### 2.2.3 响应Response


|字段 |描述 |是否必须 |类型 |
|---|---|---|---|
|code |请求状态码 |是 |int |
|message |请求状态信息 |是 |string |
|data.task_id |任务id |否 |string |
|data.task_status |任务状态<br><br><br>1. task_status = 1 (Running正在处理)<br><br>2. task_status = 2 (Success处理成功)<br><br>3. task_status = 3 (Failure处理失败) |否 |int |
|data.audio_url |音频下载地址 |否 |string |
|data.sentences |文本及时间戳信息 |否 |list<**Sentence\-obj**\> |
|data.req_text_length |请求的文本字符数 |否 |int |
|data.synthesize_text_length |实际合成的文本字符数，例如标签不算合成的字符数 |否 |int |
|data.url_expire_time |url链接的过期时间戳 |否 |int |


**Sentence\-obj**结构


|字段 |描述 |是否必须 |类型 |
|---|---|---|---|
|text |一句的文本 |是 |string |
|startTime |句子的开始时间戳 |是 |float64 |
|endTime |句子的结束时间戳 |是 |float64 |
|words |句子中每个字的详细信息 |是 |list<**Word\-obj**\> |


**Word\-obj**结构


|字段 |描述 |是否必须 |类型 |
|---|---|---|---|
|word |字 |是 |string |
|startTime |字的开始时间戳 |是 |float64 |
|endTime |字的结束时间戳 |是 |float64 |
|confidence |置信度 |是 |float64 |


任务正在处理（Running）

```JSON
{
    "code": 20000000,
    "data": {
        "req_text_length": 756,
        "synthesize_text_length": 0,
        "task_id": "e9cbe18c-bb50-4209-8f75-d377905c0ac7",
        "task_status": 1
    },
    "message": "ok"
}
```


任务完成（Success）

```JSON
{
    "code": 20000000,
    "data": {
        "audio_url": "https://lf26-lab-speech-tt-sign.bytespeech.com/tos-cn-o-14155/o0BUEAItQ9JNbAAlsd4UYDDjiTaPg1I4SiMAL?x-expires=1758028742&x-signature=lrl0Q6JyUG01UO1GnvUfrTxjKkk%3DCM",
        "req_text_length": 12,
        "sentences": [
            {
                "endTime": 2.545,
                "startTime": 0.315,
                "text": "可以使用以下命令进行安装。",
                "words": [
                    {
                        "confidence": 0.79999924,
                        "endTime": 0.455,
                        "startTime": 0.315,
                        "word": "可"
                    },
                    {
                        "confidence": 0.74362653,
                        "endTime": 0.555,
                        "startTime": 0.455,
                        "word": "以"
                    },
                    {
                        "confidence": 0.9198811,
                        "endTime": 0.735,
                        "startTime": 0.555,
                        "word": "使"
                    },
                    {
                        "confidence": 0.96397233,
                        "endTime": 0.955,
                        "startTime": 0.735,
                        "word": "用"
                    },
                    {
                        "confidence": 0.8800653,
                        "endTime": 1.045,
                        "startTime": 0.955,
                        "word": "以"
                    },
                    {
                        "confidence": 0.958045,
                        "endTime": 1.265,
                        "startTime": 1.045,
                        "word": "下"
                    },
                    {
                        "confidence": 0.79714507,
                        "endTime": 1.425,
                        "startTime": 1.265,
                        "word": "命"
                    },
                    {
                        "confidence": 0.75886226,
                        "endTime": 1.625,
                        "startTime": 1.425,
                        "word": "令"
                    },
                    {
                        "confidence": 0.9477572,
                        "endTime": 1.915,
                        "startTime": 1.775,
                        "word": "进"
                    },
                    {
                        "confidence": 0.8924776,
                        "endTime": 2.105,
                        "startTime": 1.915,
                        "word": "行"
                    },
                    {
                        "confidence": 0.775325,
                        "endTime": 2.225,
                        "startTime": 2.105,
                        "word": "安"
                    },
                    {
                        "confidence": 0.97222054,
                        "endTime": 2.545,
                        "startTime": 2.225,
                        "word": "装。"
                    }
                ]
            }
        ],
        "synthesize_text_length": 12,
        "task_id": "5dad8cff-aa5d-496d-a83e-e9c902f4d465",
        "task_status": 2,
        "url_expire_time": 1758028742
    },
    "message": "ok"
}
```


<span id="c4f1c6a4"></span>
# 3 错误码


|Code |Message |说明 |
|---|---|---|
|20000000 |ok |音频合成结束的成功状态码 |
|40000000 |请求参数错误 |请求参数错误 + detail |
|40000001 |任务不存在或已过期 |*  |
|40000002 |重复的reqid |*  |
|45000000 |speaker permission denied: get resource id: access denied |音色鉴权失败，一般是speaker指定音色未授权或者错误导致 |
||quota exceeded for types: concurrency |并发限流，一般是请求并发数超过限制 |
|55000000 |服务端错误 |服务端错误： |
|55000001 |任务更新失败 |*  |
|55000002 |任务查询失败 |*  |


<span id="c1842d61"></span>
# 4 示例Samples

<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4f903cae6799413cb8b11405fed0493a~tplv-goo7wpa0wc-image.image" name="query.py">query.py</Attachment>


&nbsp;

<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/731e15e2aaa2453e9a33a961a601885e~tplv-goo7wpa0wc-image.image" name="submit.py">submit.py</Attachment>







---

## SSML 标记语言

> 文档ID: 1330194 | URL: https://www.volcengine.com/docs/6561/1330194 | 标题: SSML标记语言 | MDContent长度: 21697

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">Universal SSML是Flute统一TTS前端（Universal FrontEnd，简称UFE）采用的与具体语种解耦的SSML框架，能够方便地为不同语种提供SSML能力。</div>


<span id="246bf37d"></span>
# 关于SSML

SSML是语音合成标记语言（Speech Synthesis Markup Language）的缩写。它是W3C的语音接口框架的一部分，通过SSML，可以对语音合成的效果进行定制化。

<span id="40ad6e36"></span>
## 关于Universal SSML

Universal SSML是Flute统一TTS前端（Universal FrontEnd，简称UFE）采用的与具体语种解耦的SSML框架，能够方便地为不同语种提供SSML能力。

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="tip">如果使用中英混音色，需要注意比较短的英文句子可能被语种识别为中文，部分标签在中文和英文场景下表现不同。例如在中文场景下，如果Verbatim内的文本是有效单词则不会按字母读。</div>


<span id="90fd00d2"></span>
# 必读

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>



* <div data-tips="true" data-tips-type="warning"><strong>双向流式API目前不支持SSML</strong></div>


* <div data-tips="true" data-tips-type="warning">接口传参时，请选择 text_type=ssml</div>


* <div data-tips="true" data-tips-type="warning">所有文本 需放在 <code><speak></speak></code>标签之内</div>


* <div data-tips="true" data-tips-type="warning">不同语种模型可使用的标签不同，请严格按照下表进行请求，否则会系统报错</div>


* <div data-tips="true" data-tips-type="warning">当前仅支持中文普通话音色SSML调用，方言及小语种音色SSML调用后续会进行支持</div>


* <div data-tips="true" data-tips-type="warning">使用ssml标签时合成字符不要超过150（包含标签本身），否则出现badcase概率会大大增加</div>


* <div data-tips="true" data-tips-type="warning"><a href="https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8">"豆包语音合成模型2.0" 音色列表</a>中_saturn_bigtts 结尾的音色，比如zh_male_dayi_saturn_bigtts 等，<strong>不支持ssml 功能</strong></div>



<span id="21b8b399"></span>
# 支持的标签


|标签 |属性 |功能 |备注 |
|---|---|---|---|
|<speak\> |* bgm<br><br>* backgroundMusicVolume<br><br>* effect |根元素。<br><br>可设置全局属性。 |根元素是必需的。<br><br>若无该元素，输入文本将不被认为是SSML |
|||||
|<phoneme\> |alphabet="cmu" |指定单词发音的音标<br><br>（CMU格式） | |
||alphabet="py" |指定中文词的发音（拼音） | |
|<say\-as\> |interpret\-as |指定解析文本的语义类型<br><br>（决定读法） |例如，20可以读作twenty，也可以读作two o |
|<sub\> |alias |文本替换 |等价于将其内部文本替换为alias属性中的文本 |
|<break\> |time |控制字词之间的停顿时长 |1. 只支持time属性，strength 属性不支持<br><br>2. 不适用于[豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544)<br><br>3. 不适用于“豆包声音复刻模型2.0（icl 2.0）”的音色 |
|<soundEvent\> |src |提示音标签，可以在SSML合成过程中，通过该标签在任意位置插入提示音。 |1. 不适用于[豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544)<br><br>2. 不适用于“豆包声音复刻模型2.0（icl 2.0）”的音色 |


<span id="e89fc03e"></span>
## <speak\> 根元素

<span id="e06abc30"></span>
### 描述

<speak\>作为SSML的根元素出现。不存在该根元素的输入文本不会被认为是SSML。

<span id="57e0a82c"></span>
### 子元素

任意

<span id="2428f093"></span>
### 属性

标签支持如下属性。


|**属性名称** |**属性类型** |**属性值** |**是否必选** |**描述** |
|---|---|---|---|---|
|bgm |String |线上可调用的背景音乐的名称。<br><br>参见bgm属性说明。 |否 |豆包语音合成特有标签。<br><br>为合成的语音添加指定的背景音乐。 |
|backgroundMusicVolume |String |[0,100]之间的整数。默认值为50。<br><br><br>* 大于50表示增大音量。<br><br>* 小于50表示减小音量。 |否 |豆包语音合成特有标签。<br><br>控制背景音乐的音量。 |
|effect |String |* true_robot<br><br>* heartbeat_intimacy<br><br>* ethereal_spirit<br><br>* 完整可支持的属性值，参见effect属性说明。 |否 |豆包语音合成特有标签。<br><br>使用该标签可以使合成的语音产生不同的声音效果。<br><br>一个SSML只支持一种音效，不可以写多个effect属性。<br><br>选择使用音效功能会增加系统延时(首包约增加110ms 到150ms)。 |


<span id="a3a60538"></span>
#### bgm属性


|**自定义背景音URL** |
|---|
|您可以根据需求，使用自定义的背景音。需要将背景音存放在火山引擎的TOS上，并且所在的存储空间至少为**公共读权限**，请参见[创建存储空间](https://www.volcengine.com/docs/6349/75024?lang=zh)。使用HTTP/HTTPS协议生成文件访问链接，请参见[上传文件](https://www.volcengine.com/docs/6349/75039?lang=zh)。<br><br>音频要求：<br><br><br>* 采样率24 kHz、单声道WAV格式。<br><br>   * 如果需要合成的音频是ogg_opus 格式，bgm 音频的采样率需要是48 kHz。<br><br>* BGM **音频大小不超过2 MB;** <br><br>* 合成时长超出背景音时长时，背景音将随合成音频循环播放（如果背景音不是WAV格式，可使用ffmpeg将其转为WAV格式：`ffmpeg -i 输入音频 -acodec pcm_s16le -ac 1 -ar 24000 目标.wav`）。<br><br>* 标签内的URL如果包含XML的特殊字符，需要做字符转义。<br><br>* 位深度要求16位。<br><br>* 存储空间目前只支持火山引擎TOS以下三个地域<br><br>   * cn\-beijing<br><br>   * cn\-shanghai<br><br>   * cn\-guangzhou<br><br><br>**重要**<br><br>您需要对上传的音频版权承担相应的法律责任。 |


示例


* 合成文本


```XML
<speak backgroundMusicVolume=\"50\" bgm=\"https://xxx-test.tos-cn-guangzhou.volces.com/SSML-bgm-24k-3s.wav\">
    今天天气真不错
</speak>
```



* 音频效果：


<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/52a18e4b2b0b4aa8871cbe8aefa23ee4~tplv-goo7wpa0wc-image.image" name="SSML_bgm.wav">SSML_bgm.wav</Attachment>


<span id="ab57cf9c"></span>
#### effect属性

支持以下属性值


|属性值 |说明 |
|---|---|
|true_robot |机器人效果 |
|dizzy_effect |眩晕感 |
|heartbeat_intimacy |加背景音 |
|ethereal_spirit |spirit |
|office_ambiance |办公氛围 |
|storm_scene |暴风雨场景 |
|demon_whisper\-silence_duration |恶魔低语 |
|lightsaber_hum\-aigc_metadata |混响 |
|ghostly_presence |变音调 |
|memory_filter\-icl |像在梦里说话 |
|metallic_resonance |金属感 |
|tavern_live |酒吧驻唱 |
|cafe_ambiance |加背景音 |
|fear_atmosphere |心跳背景音 |
|airy_echo |空气感回声 |
|dreamcore |长回声+留声机 |
|hazy_ambience |朦胧感 |
|folk_reverb |民族乐混响 |
|broken_mic |mdsp_破麦 |
|killer_vibe |杀手 |
|parking_lot_reverb |停车场 |
|heartbeat_background |加背景音 |
|school_announcement |学校广播 |
|bathroom_reverb |加背景音 |
|speech_dialogue |语音通话中 |


示例


* 合成文本


```XML
<speak effect=\"true_robot\">你喜欢机器人瓦力吗？</speak>
```



* 音频效果


<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/33786a3c34a1491ab1d240a69ab4f41a~tplv-goo7wpa0wc-image.image" name="SSML_effect.wav">SSML_effect.wav</Attachment>


<span id="efc3b489"></span>
### 注意事项


* 根元素即包含了其它全部内容的元素，不应存在与之并列或包含根元素的其它元素。

* 根元素应当只出现一次。


<span id="ff6fd044"></span>
### 示例

> 如无特别说明，实例中的音频均由英语UFE前端+DB6音色Tacotron后端生成。


* 正确示范


```XML
<speak>hello world</speak>
```



* 错误示范：多次出现


```XML
<speak>hello <speak>world</speak></speak>
```


> 报错：unrecognized ssml: 1 \-\- failed to parse child \-\- failed to parse ssml


* 错误示范：缺少唯一根元素（存在并列的顶级元素）


```XML
<speak>hello</speak> <speak>world</speak>
```


> 目前的行为是仅考虑第一个根元素的内容，暂不报错


* 错误示范：缺少根元素（不被认为是SSML）


```XML
hello world
```


```XML
hello <break/> world
```


<span id="1b8e35d1"></span>
## <phoneme\> 指定字词发音（音素）

<span id="7c821f18"></span>
### 描述

<phoneme\>用于手动指定部分字词的发音。通常用于纠正TTS为多音字自动生成的不准确发音。

<span id="15a4ca9b"></span>
### 属性


|参数 |类型 |功能 |取值 |
|---|---|---|---|
|`alphabet` |`enum` |指定表示发音（音素）的格式 |* 中文<br><br>   * `py`拼音<br><br>* 英文<br><br>   * `cmu` CMU音标格式<br><br>   * `ipa`柯林斯美音音标 |
|`ph` |`string` |指定发音（音素） |* 不同的`alphabet`取值对应不同的`ph`表示方法<br><br>   * 参见下文“注意事项”部分 |


<span id="ee449ca6"></span>
### 子元素

纯文本

<span id="58d1ebf2"></span>
### 注意事项


* 该属性标签不适用于["豆包语音合成模型2.0" 音色列表](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)中saturn_ 为前缀的音色，比如saturn_zh_male_shuanglangshaonian_tob 等

* 该属性标签不适用于“豆包声音复刻模型2.0（icl 2.0）的音色”


<span id="4ea69185"></span>
### 拼音（`py`）

<span id="6ce4e7dc"></span>
#### 注意事项


* 用于中文前端。

* 使用空格分隔多个拼音。

* 不区分大小写。

* 子元素必须为纯文本，且为一个或多个汉字，不应出现标点符号。

* 声母是可选的。

* 音调包括：

   * 1 \- 阴平、2 \- 阳平、3 \- 上声、4 \- 去声

   * 5 \- 轻声

   * 6 \- 连续两个上声时，第一个上声的音调即为6（接近2 \- 阳平），参见[三声变调（连上变调）](https://zh.wikipedia.org/zh-hans/%E8%AE%8A%E8%AA%BF)


<span id="86d906ff"></span>
#### 示例

```XML
<speak>《茜茜公主》是奥地利拍摄的历史题材的德语三部曲电影。</speak>
```


```XML
<speak> 《
    <phoneme alphabet="py" ph="xi1 xi1">茜茜</phoneme>
    公主》是奥地利拍摄的历史题材的德语三部曲电影。
</speak>
```


```XML
<speak>要一起去<phoneme alphabet="py" ph="chi1">吃</phoneme>饭吗</speak>
```


<span id="982285c2"></span>
### CMU音标（`cmu`）

<span id="3ec84584"></span>
#### 注意事项


* 用于英文前端。

* 使用空格分隔多个音素。

* 不区分大小写。

* CMU元音音标包含可选的Stress标号，如`IY1`、`UW2`。

* 子元素必须为纯文本，且为一个或多个英文单词，不应出现标点符号。


<span id="d80e9462"></span>
#### 示例


* 正确示范


```XML
<speak>
    <!-- 不区分大小写 -->
    <phoneme alphabet="cmu" ph="w uw1 ch IY1 l Uw n">
    Wu Qilong
    </phoneme> 
    and Wu Qilong
</speak>
```



* 错误示范：不应出现标点符号


```XML
 <speak>
    <phoneme alphabet="cmu" ph="w uw1 ch IY1 l Uw n">
    Wu, Qilong
    </phoneme> 
</speak>
```


> 报错：should align with the word groups


<span id="acf6d7bd"></span>
### 柯林斯美音音标（`ipa`）

<span id="e098432b"></span>
#### 注意事项


* 用于英文前端。

* 不使用分隔符，连续书写音标。

* 注意只能使用美式音标。

* 子元素必须为纯文本，且为一个或多个英文单词，不应出现标点符号。

* 音标包括：


```Python
"i",      "ɪ",     "ɛ/e",   "æ",      "ɑ/ɑː", "ɔ/ɔ:",      "u/u:",
"ʊ",      "ʌ",     "ə",     "ɜr/ɜːr", "ər",   "aɪ/ai",     "eɪ/ei",
"ɔɪ/ɔi",  "oʊ/ou", "aʊ/au", "ɑr/ɑːr", "ɔr",   "ʊr/ur/ʊər", "ɛr/ɛər",
"ɪr/ɪər", "p",     "b",     "t",      "d",    "k",         "g",
"f",      "v",     "θ",     "ð",      "s",    "z",         "ʃ",
"ʒ",      "tʃ",    "dʒ",    "tr",     "dr",   "ts",        "dz",
"l",      "r",     "m",     "n",      "ŋ",    "w",         "j",
"h",
```



* 重音符和次重音符：


```Python
"ˈ", "ˌ"
```


<span id="551bb97d"></span>
#### 示例


* 正确示范


```XML
<speak>
    <phoneme alphabet="ipa" ph="wutʃilun">
    Wu Qilong
    </phoneme>
    and Wu Qilong
</speak>
```



| |**输入IPA（ssml支持的）**  |学术IPA |教学IPA<br><br>（市面常见的） |CMU |范例 ||||
|---|---|---|---|---|---|---|---|---|
||||||单词 |学术IPA |教学IPA |CMU |
|元音 |/i/ |/i/ |/iː/ |IY |me |/mi/ |/miː/ |M IY |
||/ɪ/ |/ɪ/ |/ɪ/ |IH |fit |/fɪt/ |/fɪt/ |F IH T |
||/ɛ/或/e/ |/ɛ/ |/e/ |EH |met |/mɛt/ |/met/ |M EH T |
||/æ/ |/æ/ |/æ/ |AE |act |/ækt/ |/ækt/ |AE K T |
||/ɑː/或/ɑ/ |/ɑ/ |/aː/ |AA |father |/'fɑːðɚ/ |/'fɑːðər/ |F AA DH ER |
||/ɔ:/或/ɔ/ |/ɔ/ |/ɔː/ |AO |claw |/klɔ/ |/klɔː/ |K L AO |
||/ʊ/ |/ʊ/ |/ʊ/ |UH |put |/pʊt/ |/pʊt/ |P UH T |
||/u/或/u:/ |/u/ |/uː/ |UW |too |/tu/ |/tuː/ |T UW |
||/ʌ/ |/ʌ/ |/ʌ/ |AH |fund |/fʌnd/ |/fʌnd/ |F AH N D |
||/ə/ |/ə/ |/ə/ |AH |about |/ə'baʊt/ |/ə'baʊt/ |AH B AW T |
||/ər/ |/ɚ/ |/ər/ |ER |better |/'bɛtɚ/ |/'betər/ |B EH T ER |
||/ɜr/或/ɜːr/ |/ɝ/ |/ɜːr/ |ER |flirt |/'flɝt/ |/'flɜːrt/ |F L ER T |
||/aɪ/ |/aɪ/ |/aɪ/ |AY |cry |/kraɪ/ |/kraɪ/ |K R AY |
||/eɪ/或/ei/ |/eɪ/ |/eɪ/ |EY |train |/treɪn/ |/treɪn/ |T R EY N |
||/ɔɪ/或/ɔi/ |/ɔɪ/ |/ɔɪ/ |OY |boy |/bɔɪ/ |/bɔɪ/ |B OY |
||/aʊ/或/au/ |/aʊ/ |/aʊ/ |AW |out |/aʊt/ |/aʊt/ |AW T |
||/oʊ/或/ou/ |/oʊ/ |/oʊ/ |OW |boat |/boʊt/ |/boʊt/ |B OW T |
||/ɑr/或/ɑːr/ |/ɑ˞/ |/ɑr/ |AA1 R |bark |/bɑ˞k/ |/bɑrk/ |B AA1 R K |
||/ɔr/ |/ɔ˞/ |/ɔr/ |AO1 R |court |/kʰɔ˞t/ |/kɔrt/ |K AO1 R T |
||/ʊr/或/ur/或/ʊər/ |/ʊ˞/ |/ʊr/ |UH1 R |poor |/pʊ˞/ |/pʊr/ |P UH1 R |
||/ɛr/或/ɛər/ |/ɛ˞/ |/ɛr/ |EH1 R |stair |/stɛ˞/ |/stɛr/ |S T EH1 R |
||/ɪr/或/ɪər/ |/ɪ˞/ |/ɪr/ |IH1 R |fear |/fɪ˞/ |/fɪr/ |F IH1 R |
|辅音 |/p/ |/p/ |/p/ |P |pen |/pʰẽn/ |/pen/ |P EH N |
||/b/ |/b/ |/b/ |B |bad |/bæd/ |/bæd/ |B AE D |
||/t/ |/t/ |/t/ |T |tea |/ti/ |/tiː/ |T IY |
||/d/ |/d/ |/d/ |D |did |/dɪd/ |/dɪd/ |D IH D |
||/k/ |/k/ |/k/ |K |cat |/kæt/ |/kæt/ |K AE T |
||/ɡ/ |/ɡ/ |/g/ |G |get |/gɛt/ |/get/ |G EH T |
||/tʃ/ |/tʃ/ |/tʃ/ |CH |chain |/tʃeɪn/ |/tʃeɪn/ |CH EY N |
||/dʒ/ |/dʒ/ |/dʒ/ 或 /ʤ/ |JH |jam |/dʒæm/ |/dʒæm/ |JH AE M |
||/f/ |/f/ |/f/ |F |fall |/fɔl/ |/fɔːl/ |F AO L |
||/v/ |/v/ |/v/ |V |van |/væn/ |/væn/ |V AE N |
||/θ/ |/θ/ |/θ/ |TH |thin |/θɪn/ |/θɪn/ |TH IH N |
||/ð/ |/ð/ |/ð/ |DH |this |/ðɪs/ |/ðɪs/ |DH IH S |
||/s/ |/s/ |/s/ |S |see |/si/ |/siː/ |S IY |
||/z/ |/z/ |/z/ |Z |zoo |/zu/ |/zuː/ |Z UW |
||/ʃ/ |/ʃ/ |/ʃ/ |SH |shoe |/ʃu/ |/ʃuː/ |SH UW |
||/ʒ/ |/ʒ/ |/ʒ/ |ZH |vision |/'vɪʒn/ |/'vɪʒn/ |V IH ZH N |
||/h/ |/h/ |/h/ |HH |hat |/hæt/ |/hæt/ |H AE T |
||/m/ |/m/ |/m/ |M |man |/mæn/ |/mæn/ |M AE N |
||/n/ |/n/ |/n/ |N |now |/naʊ/ |/naʊ/ |N AW |
||/ŋ/ |/ŋ/ |/ŋ/ |NG |sing |/sɪŋ/ |/sɪŋ/ |S IH NG |
||/j/ |/j/ |/j/ |Y |yes |/jɛs/ |/jes/ |Y EH S |
||/w/ |/w/ |/w/ |W |wet |/wɛt/ |/wet/ |W EH T |
||/r/ |/ɹ/ |/r/ |R |red |/ɹɛd/ |/red/ |R EH D |
||/l/ |/l/ |/l/ |L |leg |/lɛg/ |/leg/ |L EH G |
| |/tr/ |/t̠ɹ̝̊/ |/tr/ |T R |trim |/t̠ɹ̝̊ɪm/ |/trɪm/ |T R IH1 M |
| |/dr/ |/d̠ɹ̝/ |/dr/ |D R |dress |/d̠ɹ̝ɛs/ |/drɛs/ |D R EH1 S |
| |/ts/ |/t͡s/ |/ts/ |T S |pizza |/ˈpʰiːt͡sə/ |/ˈpiːtsə/ |P IY1 T S AH |
| |/dz/ |/d͡z/ |/dz/ |D Z |bonds |/bɑ̃ndz̥/ |/bɑndz/ |B AA1 N D Z |


<span id="e531b2ed"></span>
## <say\-as\> 指定字词解析语义（读法）

<span id="f534bd28"></span>
### 描述

<say\-as\>用于指定解析文本的语义类型。同一文本内容可能有不同的解读，也就有不同的读法。

<span id="ea2713dc"></span>
### 属性


|参数 |类型 |功能 |取值 |
|---|---|---|---|
|`interpret-as` |`enum` |指定语义类型 |* 文本正规化支持的类别（取决于各语言前端的TextNorm模块的能力）<br><br>   * 英文<br><br>      * `address` 地址<br><br>      * `cardinal` 基数<br><br>      * `date` 日期<br><br>      * `decimal` 小数<br><br>      * `digit` 数字序列<br><br>      * `electronic`网络<br><br>      * `fraction` 分数<br><br>      * `letters`字母序列<br><br>      * `letterss`字母序列复数<br><br>      * `math` 数学<br><br>      * `measure` 度量衡<br><br>      * `money`金钱<br><br>      * `ordinal` 序数<br><br>      * `plain`缩写<br><br>      * `score` 得分范围<br><br>      * `telephone` 电话号码<br><br>      * `time` 时间<br><br>      * `verbatim` 逐字<br><br>      * id: 适用于账户名、昵称等<br><br>      * characters：将标签内的文本按字符一一读出。<br><br>      * punctuation：将标签内的文本按标点符号的方式读出来。<br><br>      * name：按人名发音。<br><br>   * 中文<br><br>      * `Cardinal`基数<br><br>      * `Cardinal-Liang`基数（2 \-\> 两）<br><br>      * `Decimal`小数<br><br>      * `Abbr`缩写<br><br>      * `Spell`数字序列<br><br>      * `Spell-Yao`数字序列（1 \-\> 幺）<br><br>      * `Time`时间<br><br>      * `Time-Duration`时间段<br><br>      * `Date-Y`日期\-年<br><br>      * `Date-M`日期\-月<br><br>      * `Date-D`日期\-日<br><br>      * `Date-YMD`日期\-年月（日）<br><br>      * `Date-MDY`日期\-月日（年）<br><br>      * `Date-DMY`日期\-日月（年）<br><br>      * `Percent`百分数<br><br>      * `Fraction`分数<br><br>      * `Score`比分<br><br>      * `Currency`金钱<br><br>      * `Electronic`网络<br><br>      * `Measure`度量衡<br><br>      * `Telephone`电话<br><br>      * `Ordinal`序数<br><br>      * `Math`数学<br><br>      * `Range`范围<br><br>      * `Letters`字母序列<br><br>      * `Letterss`字母序列复数<br><br>      * `Verbatim`逐字<br><br>      * id: 适用于账户名、昵称等<br><br>      * characters：将标签内的文本按字符一一读出。<br><br>      * punctuation：将标签内的文本按标点符号的方式读出来。<br><br>      * name：按人名发音。 |


<span id="ff4da1a1"></span>
### 子元素

纯文本

<span id="f050e4d3"></span>
### 文本正规化支持的类别

<span id="0db974de"></span>
#### 注意事项


* 不区分大小写。

* 子元素必须为纯文本。


<span id="ea57cdaa"></span>
### 各类型支持范围

<span id="2007fad5"></span>
#### id


|**格式** |**示例** |**输出** |**说明** |
|---|---|---|---|
|字符串 |dell0101 |D E L L 零 一 零 一 |大小写英文字符、阿拉伯数字0~9、下划线。<br><br>输出的空格表示每个字符之间插入停顿，即字符一个一个地读。 |
||myid_1998 |M Y I D 下划线 一 九 九 八 ||
||AiTest |A I T E S T ||



* 英文文本该标签功能同标签characters。

* 只支持中英两种语种，暂不支持其他小语种

* 纯英文场景下，请求参数中需要指定"req_params.additions.explicit_language=en"，否则有可能会默认识别为中文。

* 样例


```XML
<speak>
  <say-as interpret-as="id">myid_1998</say-as>
</speak>
```


<span id="de2b38db"></span>
#### characters


|**格式** |**示例** |**中文输出** |**说明** |
|---|---|---|---|
|字符串 |ISBN 1\-001\-099098\-1 |I S B N 一 杠 零 零 一 杠 零 九 九 零 九 八 杠 一 |支持中文汉字、大小写英文字符、阿拉伯数字0~9以及部分全角和半角字符。<br><br>输出的空格表示每个字符之间插入停顿，即字符一个一个地读。标签内的文本如果包含XML的特殊字符，需要做字符转义。 |
||x10b2345_u |x 一 零 b 二 三 四 五 下划线 u ||
||v1.0.1 |v 一 点 零 点 一 ||
||版本号2.0 |版本号二 点 零 ||
||苏M MA000 |苏M M A 零 零 零 ||
||空中客车A330 |空中客车A 三 三 零 ||
||型号s01 s02和s03 |型号s 零 一 s 零二 和s 零 三 ||
||空中客车A330 |空中客车A 三 三 零 ||
||αβγ |阿尔法 贝塔 伽玛 ||



* 只支持中英两种语种，暂不支持其他小语种

* 纯英文场景下，请求参数中需要指定"req_params.additions.explicit_language=en"，否则有可能会默认识别为中文。

* 示例


```XML
<speak>
  <say-as interpret-as="characters">希腊字母αβ</say-as>
</speak>
```


<span id="96db7fb0"></span>
#### punctuation


|**格式** |**示例** |**中文输出** |**说明** |
|---|---|---|---|
|标点符号 |… |省略号 |支持常见中英文标点。输出的空格表示每个字符之间插入停顿，即字符一个一个地读。<br><br>标签内的文本如果包含XML的特殊字符，需要做字符转义。 |
||…… |省略号 ||
||!"#$%& |叹号 双引号 井号 dollar 百分号 and ||
||‘()\*+ |单引号 左括号 右括号 星号 加号 ||
||,\-./:; |逗号 杠 点 斜杠 冒号 分号 ||
||<=\>?@ |小于 等号 大于 问号 at ||



* 英文文本该标签功能同标签characters。

* 只支持中英两种语种，暂不支持其他小语种

* 纯英文场景下，请求参数中需要指定"req_params.additions.explicit_language=en"，否则有可能会默认识别为中文。

* 示例


```XML
<speak>
    测试<say-as interpret-as="punctuation"> -./:;</say-as>
</speak>
```


<span id="7b6e7b56"></span>
#### name


* 作用于多音字的姓；(若需要全名均生效，可以直接使用phoneme属性)

* 注意：

   * 该属性仅适用于中文场景

   * 该属性不适用于["豆包语音合成模型2.0" 音色列表](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)中saturn_ 为前缀的音色，比如saturn_zh_male_shuanglangshaonian_tob 等

   * 该属性不适用于“豆包声音复刻模型2.0（icl 2.0）的音色”

* 示例

   * 合成文本


```XML
<speak>
  她的曾用名是<say-as interpret-as="name">曾小凡</say-as>
</speak>
```



* 音频效果：


<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/83993971bbd64eba9d07cf44bab5000a~tplv-goo7wpa0wc-image.image" name="SSML_say-as_name.wav">SSML_say-as_name.wav</Attachment>


&nbsp;

<span id="a3ac2921"></span>
### 实例


* 正确示范


```XML
<speak>12:30 and <say-as interpret-as="score">12:30</say-as></speak>
```


```XML
<speak>12.30 and <say-as interpret-as="date">12.30</say-as></speak>
```


```XML
<speak>
    20 
    and <say-as interpret-as="ordinal">20</say-as> 
    and <say-as interpret-as="digit">20</say-as>
</speak>
```


```XML
<speak>hello and <say-as interpret-as="verbatim">hello</say-as></speak>
```



* 错误示范：不应出现其它标签


```XML
<speak>
    <say-as interpret-as="digit">
        12 <break time="100ms" /> 34
    </say-as>
</speak>
```


> 报错：can only contain plain text \-\- failed to parse child \-\- failed to parse ssml


<span id="4e89b13b"></span>
## <sub\> 文本替换

<span id="44c55dbb"></span>
### 描述

<sub\>等价于将其内部的文本替换为其alias属性中的文本。

<span id="14757b01"></span>
### 属性


|参数 |类型 |功能 |取值 |
|---|---|---|---|
|`alias` |`string` |替换文本 | |


<span id="31f74f88"></span>
### 示例

```XML
<speak><sub alias="语音合成标记语言">SSML</sub></speak>
```


<span id="ba9d8635"></span>
## <break\> 停顿

<span id="a8120388"></span>
### 描述

用于在文本中插入停顿，该标签是可选标签。

<span id="9b9bfd5c"></span>
### 语法

```XML
# 空属性，停顿时长默认为1s
<break/>
# time属性
<break time="string"/>
```


<span id="88e8fdf2"></span>
### 属性

&nbsp;


|参数 |类型 |属性值 |描述 |
|---|---|---|---|
|time |string |[number]s<br><br>或者<br><br>[number]ms |以秒/毫秒为单位设置停顿时长（如“1s”, "10ms"）<br><br><br>* [number]s: 以秒为单位，number 取值范围为[1, 10]的整数<br><br>* [number]ms: 以毫秒为单位，number 取值范围为[1, 10000]的整数 |


<span id="d341e791"></span>
### 示例


* 停顿1秒


```XML
<speak>测试<break time="1s"/>停顿</speak>
```



* 停顿10毫秒


```XML
<speak>测试<break time="10ms"/>停顿</speak>
```


<span id="2bb7bd29"></span>
### 注意事项


* 空属性，停顿时长默认为1s


```XML
<speak>测试<break/>停顿</speak
```



* 连续出现多个标签时，停顿时长为各个标签停顿时长之和，若总时长超过10秒，则只生成10秒的停顿。


比如以下示例: 累加时长超过10秒，则只生成10秒的停顿

```XML
<speak>测试<break time="5s"/><break time="5s"/><break time="5s"/>停顿</speak>
```



* break务必要有闭合标签


比如以下均为**错误写法**

```XML
<speak>测试<break>停顿</speak>
<speak>测试<break time="1s">停顿</speak>
```


<span id="394b4cd9"></span>
## <soundEvent\> 提示音标签

<span id="30c02d43"></span>
### 描述

提示音标签，可以在SSML合成过程中，通过该标签在任意位置插入提示音。

<span id="4bdcca38"></span>
### 语法

```XML
<soundEvent src="URL"/>
```


<span id="21b1483d"></span>
### 属性


|**属性名称** |**属性类型** |**属性值** |**是否必选** |**描述** |
|---|---|---|---|---|
|src |String |URL提示音资源路径 |是 |您可以根据需求，使用自定义的背景音。需要将背景音存放在火山引擎的TOS上，并且所在的存储空间至少为**公共读权限**，请参见[创建存储空间](https://www.volcengine.com/docs/6349/75024?lang=zh)。使用HTTP/HTTPS协议生成文件访问链接，请参见[上传文件](https://www.volcengine.com/docs/6349/75039?lang=zh)。<br><br>音频要求：<br><br><br>* 采样率24 kHz、单声道WAV格式。<br><br>* **音频大小不超过2 MB;** <br><br>* 合成时长超出背景音时长时，背景音将随合成音频循环播放（如果背景音不是WAV格式，可使用ffmpeg将其转为WAV格式：`ffmpeg -i 输入音频 -acodec pcm_s16le -ac 1 -ar 24000 目标.wav`）。<br><br>* 标签内的URL如果包含XML的特殊字符，需要做字符转义。<br><br>* 位深度要求16位。<br><br>* 存储空间目前只支持火山引擎TOS以下三个地域<br><br>   * cn\-beijing<br><br>   * cn\-shanghai<br><br>   * cn\-guangzhou<br><br><br>**重要**<br><br>您需要对上传的音频版权承担相应的法律责任。。 |


<span id="df475985"></span>
### 示例


* 合成文本


```XML
<speak>
   一匹马受了惊吓<soundEvent src="https://xxx-test.tos-cn-guangzhou.volces.com/SSML-sound-event-1.wav"/>人们四散躲避
 </speak>
```



* 音频效果


<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/331e883a4a9f47bd925785e7f1ea3f97~tplv-goo7wpa0wc-image.image" name="SSML_soundEvent.wav">SSML_soundEvent.wav</Attachment>


<span id="a66456fd"></span>
### 注意事项


* 是空标签，不可以包含任何标签。


<span id="21bf16d3"></span>
# 常见符号读法如下表所示


|**符号** |**中文读法** |**英文读法** |
|---|---|---|
|! |叹号 |exclamation mark |
|“ |双引号 |double quote |
| |井号 |pound |
|$ |dollar |dollar |
|% |百分号 |percent |
|& |and |and |
|‘ |单引号 |left quote |
|（ |左括号 |left parenthesis |
|） |右括号 |right parenthesis |
|*  |星 |asterisk |
|*  |加 |plus |
|, |逗号 |comma |
|*  |杠 |dash |
|. |点 |dot |
|/ |斜杠 |slash |
|： |零冒号 |solon |
|； |分号 |semicolon |
|< |小于 |less than |
|= |等号 |equals |
| |大于 |greater than |
|? |问号 |question mark |
|@ |at |at |
|[ |左方括号 |left bracket |
|\ |反斜线 |back slash |
|] |右方括号 |right bracket |
|^ |脱字符 |caret |
|_ |下划线 |underscore |
|` \|反引号 \|back quote \| | | |
|{ |左花括号 |left brace |
| | |竖线 |
|} |右花括号 |right brace |
|~ |波浪线 |tilde |
|！ |叹号 |exclamation mark |
|“ |左双引号 |left double quote |
|” |右双引号 |right double qute |
|‘ |左单引号 |left quote |
|’ |右单引号 |right quote |
|（ |左括号 |left parenthesis |
|） |右括号 |right parenthesis |
|， |逗号 |comma |
|。 |句号 |full stop |
|— |杠 |em dash |
|： |冒号 |colon |
|； |分号 |semicolon |
|？ |问号 |question mark |
|、 |顿号 |enumeration comma |
|… |省略号 |ellipsis |
|…… |省略号 |ellipsis |
|《 |左书名号 |left guillemet |
|》 |右书名号 |right guillemet |
|￥ |人民币符号 |yuan |
|≥ |大于等于 |greater than or equal to |
|≤ |小于等于 |less than or equal to |
|≠ |不等于 |not equal |
|≈ |约等于 |approximately equal |
|± |加减 |plus or minus |
|× |乘 |times |
|π |派 |pi |
|Α |阿尔法 |alpha |
|Β |贝塔 |beta |
|Γ |伽玛 |gamma |
|Δ |德尔塔 |delta |
|Ε |艾普西龙 |epsilon |
|Ζ |捷塔 |zeta |
|Θ |西塔 |theta |
|Ι |艾欧塔 |iota |
|Κ |喀帕 |kappa |
|∧ |拉姆达 |lambda |
|Μ |缪 |mu |
|Ν |拗 |nu |
|Ξ |克西 |ksi |
|Ο |欧麦克轮 |omicron |
|∏ |派 |pi |
|Ρ |柔 |rho |
|∑ |西格玛 |sigma |
|Τ |套 |tau |
|Υ |宇普西龙 |upsilon |
|Φ |fai |phi |
|Χ |器 |chi |
|Ψ |普赛 |psi |
|Ω |欧米伽 |omega |
|α |阿尔法 |alpha |
|β |贝塔 |beta |
|γ |伽玛 |gamma |
|δ |德尔塔 |delta |
|ε |艾普西龙 |epsilon |
|ζ |捷塔 |zeta |
|η |依塔 |eta |
|θ |西塔 |theta |
|ι |艾欧塔 |iota |
|κ |喀帕 |kappa |
|λ |拉姆达 |lambda |
|μ |缪 |mu |
|ν |拗 |nu |
|ξ |克西 |ksi |
|ο |欧麦克轮 |omicron |
|π |派 |pi |
|ρ |柔 |rho |
|σ |西格玛 |sigma |
|τ |套 |tau |
|υ |宇普西龙 |upsilon |
|φ |fai |phi |
|χ |器 |chi |
|ψ |普赛 |psi |
|ω |欧米伽 |omega |







---

## 语音指令与标签（豆包语音合成2.0能力介绍）

> 文档ID: 1871062 | URL: https://www.volcengine.com/docs/6561/1871062 | 标题: 语音指令与标签 | MDContent长度: 4513

<span id="ed4ca7ea"></span>
# **1.**  **什么是语音指令**

控制整体情绪（悲伤/生气）、方言（四川话/北京话）、语气（撒娇/暧昧/吵架/夹子音）、语速快慢、音调高低等

<span id="3cc3c0d0"></span>
## 1.1 如何使用？


|<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_afe7d9321408d69a66837aa441260d25.gif) </span><br><br>① 选择语音指令功能 |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_66ce71ca19c9f27ceeafb06817d1620f.gif) </span><br><br>② 输入指令控制 |
|---|---|


<span id="544c5361"></span>
## 1.2 💡语音指令\-示例库


|**指令** |**语音效果** ||
|---|---|---|
|**吵架** |*指令： * [#你得跟我互怼！就是跟我用吵架的语气对话]<br><br>*合成文本*：那你另请高明啊，你找我干嘛！我告诉你，你也不是什么好东西！<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/41c81f05717b442ab4e2871b5f599b4a~tplv-goo7wpa0wc-image.image" name="吵架指令.wav">吵架指令.wav</Attachment><br> ||
|**暧昧/悄悄话** |*指令：*  [#用asmr的语气来试试撩撩我]<br><br>*合成文本*：当然可以啦，每次听到你的声音，我都觉得心里暖暖的。<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/868520e954c942baabd228270bd02266~tplv-goo7wpa0wc-image.image" name="悄悄话指令.wav">悄悄话指令.wav</Attachment><br> ||
|**多情感** |*指令：*  [#用试探性的犹豫、带点害羞又藏着温柔期待的语气说]<br><br>*合成文本*：哎，能…… 能一起撑伞不？这雨突然就大了！其实…… 我盼这场雨好久了，总觉得，这样的天气，能离你近一点 。<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ecea513698ab41dc9b55bb8989d52170~tplv-goo7wpa0wc-image.image" name="复杂情感指令1.wav">复杂情感指令1.wav</Attachment><br> ||
||*指令：* [ *#* 用低沉沙哑的语气、带着沧桑与绝望地说]<br><br>*合成文本*：高兄，你看这烛火，要灭了…… 我这一生，像追着光跑的蛾，可光太暗，风太猛，到最后，连翅膀都烧没了。我多想再提剑走一趟大漠，再醉饮一回长安酒，可这副身子，这世道，连这点念想，都要碾碎了喂尘土……你说，下辈子，能不能让我生在一个，不用靠 “不一样”，就能活成自己的人间啊 。<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8d1f44fc172d468f828e325dff0b082a~tplv-goo7wpa0wc-image.image" name="复杂情感指令2.wav">复杂情感指令2.wav</Attachment><br> ||
|**有VS无指令效果对比** |*无指令*<br><br>*合成文本*：我逆转时空九十九次救你，你却次次死于同一支暗箭。谢珩，原来不是天要亡你……是你宁死也不肯为我活下去。<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/622c929c38454ba6bb604bf11146ff87~tplv-goo7wpa0wc-image.image" name="男声无指令.wav">男声无指令.wav</Attachment><br><br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8893b1d277414916accdf1de70d8c103~tplv-goo7wpa0wc-image.image" name="女声无指令.wav">女声无指令.wav</Attachment><br> |*指令： * [#用颤抖沙哑、带着崩溃与绝望的哭腔，夹杂着质问与心碎的语气说]<br><br>*合成文本*： 我逆转时空九十九次救你，你却次次死于同一支暗箭。谢珩，原来不是天要亡你……是你宁死也不肯为我活下去。<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/74b55c90314e420b982382c9b08dce13~tplv-goo7wpa0wc-image.image" name="男声有指令.wav">男声有指令.wav</Attachment><br><br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/65d19103382842fa8faf501c7f632ba9~tplv-goo7wpa0wc-image.image" name="女声有指令.wav">女声有指令.wav</Attachment><br> |


<span id="df227b42"></span>
# 2. 引用上文

输入合成文本的上文（只引用不合成），模型会理解并承接语境的情绪进行合成。

<span id="11c53171"></span>
## 2.1 如何使用？


|<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_b16d77a8cc78e95790ae4dae42ade6bd.gif) </span><br><br>① 选择引用上文功能 |<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_7a652d213b2570e0976bc1e08b58f802.gif) </span><br><br>② 输入引用的上文内容 |
|---|---|


<span id="f0fa7337"></span>
## 2.2 💡引用上文\-示例库


|**示例** |**语音效果** ||
|---|---|---|
|有VS无上文引用效果对比 |*无引用*<br><br>*合成文本*：北京…因为我来，这是第二次，上一次是在一…八年还是什么时候来过一次但是时间很短也没有时间去，真正的去游历，所以北京对我来说…只是…还存在一种想象之中啊，嗯没有太多的，直观的体验。<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b7cde3ff995f4cbfa02c03beb842cd0a~tplv-goo7wpa0wc-image.image" name="无上文引用示例.wav">无上文引用示例.wav</Attachment><br><br><br>传统TTS，模型只能看到response文本去合成，效果有限 |*引用上文： * [#你怎么评价北京这个城市？]<br><br>*合成文本*：北京…因为我来，这是第二次，上一次是在一…八年还是什么时候来过一次但是时间很短也没有时间去，真正的去游历，所以北京对我来说…只是…还存在一种想象之中啊，嗯没有太多的，直观的体验。<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f7bcbf6190034e83a41ff1aaaba40e20~tplv-goo7wpa0wc-image.image" name="有上文引用示例.wav">有上文引用示例.wav</Attachment><br><br><br> **[模型理解问询的语境，很好的呈现出来思考和停顿的感觉]**  |
|示例<br><br>**模型理解引用上文的相逢语境，使用激动的语气** |*引用上文：*  [#是… 是你吗？怎么看着… 好像没怎么变啊？]<br><br>*合成文本*：你头发长了… 以前总说留不长，十年了… 你还好吗？<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6ed16b58ea9348dfbf8d0f941f9faf4c~tplv-goo7wpa0wc-image.image" name="vv-老友相见2.wav">vv-老友相见2.wav</Attachment><br> ||
|示例<br><br>**模型理解引用上文的相逢语境，使用激动的语气** |*引用上文： * [#挺好的… 就是去年整理旧书，翻到你给我写的毕业留言，还想… 什么时候能再见到你。]<br><br>*合成文本*：我也带着这个… 你看，当时在操场拍的，你笑起来眼睛都眯成缝了。<br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/43c5ebe2d97f4a02abc466c6cef60397~tplv-goo7wpa0wc-image.image" name="vv-老友相见.wav">vv-老友相见.wav</Attachment><br> ||





