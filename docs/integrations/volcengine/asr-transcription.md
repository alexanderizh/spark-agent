> 抓取日期: 2026-08-11 | 来源: https://www.volcengine.com/docs/6561 (豆包语音 / Doubao Voice, LibraryID=6561) | 渠道: 火山引擎方舟 Volcengine Ark（豆包大模型语音） | 抓取方式: getDocDetail API（`https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=<docId>`，返回 JSON `.Result.MDContent`）

# 豆包语音识别大模型（Doubao Automatic Speech Recognition）

本文档汇总火山引擎「豆包语音」产品库下"语音识别大模型"全部 API 与说明，原文逐段保留。所有参数名/枚举/endpoint 均来自官方原文。

文档树（来源：https://www.volcengine.com/docs/6561/1354867 「语音识别大模型」分组）：
- 产品简介 → docId 1354871
- 流式语音识别（分组节点，正文为空）→ docId 2607736
- 单向流式语音识别 WebSocket → docId 2628951
- 双向流式语音识别 WebSocket → docId 2630027
- 录音文件识别标准版
  - 任务提交-HTTP → docId 2606791
  - 结果查询-HTTP → docId 2606792
- 录音文件识别闲时版
  - 任务提交-HTTP → docId 2608618
  - 结果查询-HTTP → docId 2608619
- 录音文件识别极速版 HTTP → docId 2608628
- 错误码查询 → docId 2611432


---

## 产品简介

> 文档ID: 1354871 | URL: https://www.volcengine.com/docs/6561/1354871 | 标题: 产品简介 | MDContent长度: 2661

<span id="c39b5f39"></span>
## 产品说明

火山引擎语音团队基于大模型语音识别能力全新升级,依托业界领先的自研语音识别技术和海量的语音行业大数据优势，语音识别大模型拥有更加灵敏的耳朵+更加聪明的大脑，识别准确率进一步提升。

<span id="大模型流式语音识别"></span>
#### 大模型流式语音识别

**双向流式模式：**  支持将长音频实时识别成文字，达到“边说话边出文字”的效果，适用于实时语音识别的场景，如实时会议字幕、直播字幕、智能外呼等。

**流式输入模式：**  支持将音频以流式方式送入，语音识别引擎处理完后返回句级的识别结果，适用于智能体对话、IM语音消息转写、语音输入法等场景。

<span id="大模型录音文件识别"></span>
#### 大模型录音文件识别

支持将音频文件（≤5小时）转写成文本数据，内置自动标点、语义顺滑、数字规整、智能分句等功能，可根据需要任意搭配。适用于非实时的语音识别场景，如会议记录总结、智能外呼质检、课后教辅和学情分析等。

<span id="a37b848c"></span>
## 产品优势


* **超高的准确率**：相比传统模型识别错误率降低30%，在音乐，科技，教育，医疗等垂直领域识别错误率降低50%以上。

* **复杂场景识别效果提升**：支持多语种多方言语音识别，口音错误率降低60%，噪声和背景人声下降30%\-50%。

* **更类真人的交互体验**：大模型能根据上下文、用户输入、背景信息输入等，让“耳朵”能思考，给出更贴合语境的识别效果。


<span id="功能特性"></span>
## 功能特性


|**功能项** |**豆包流式语音识别模型** ||**豆包录音文件识别模型** |
|---|---|---|---|
|**识别模式** |双向流式（含优化版本） |流式输入 |录音文件识别 |
|**返回时效** |实时，即边说话边出文字 |流式输入，分句返回 |一般接到任务立即识别；<br><br>标准版：3 小时内；<br><br>闲时版：24小时内；<br><br>极速版：30分钟音频一般10秒左右返回（不含音频传输时间） |
|**敏感词过滤** |✅ |✅ |✅ |
|**智能分句** |✅ |✅ |✅ |
|**字/词时间戳** |✅ |✅ |✅ |
|**标点符号预测** |✅ |✅ |✅ |
|**语义顺滑（目前支持中文、英文）**  |✅ |✅ |✅ |
|**数字规整ITN** |✅ |✅ |✅ |
|**启用双声道识别** |不支持 |不支持 |✅ |
|**使用vad分句** |✅ |不支持 |✅ |
|**自动说话人分离（中英文）**  |✅ |✅ |✅ |
|**上下文（文本、图片）**  |✅<br><br>2.0支持图片 |✅<br><br>2.0支持图片 |✅<br><br>2.0支持图片 |
|**强制判停时间** |✅ |✅ |✅ |
|**输出语音停顿、分句、分词信息** |✅ |✅ |✅ |
|**性别检测** |✅ |✅ |✅ |
|**分句信息携带语速** |✅ |✅ |✅ |
|**分句信息携带音量** |✅ |✅ |✅ |
|**语种检测** |✅ |✅ |✅ |
|**情绪检测** |✅ |✅ |✅ |
|**热词纠错\-平台级别** |✅ |✅ |✅ |
|**热词纠错\-请求级别** |✅ |✅ |✅ |
|**正则替换词** |✅ |✅ |✅ |
|**是否启动首字返回加速** |✅ |不支持 |不涉及 |
|**首字返回加速率** |✅ |不支持 |不涉及 |
|**并发限制** |正式版默认10并发，以控制台为准 支持购买并发扩容 ||正式版默认最大支持 20QPS，半小时内提交的音频时长不超过 500小时 |
|**输入音频格式** |支持 pcm、opus、mp3格式 ||支持pcm、opus、mp3、wav、spx、ogg、amr、aac、m4a格式 |
|**采样率** |采样率无要求 ||采样率无要求 |
|**音频大小** |/ ||音频时长<5小时，且文件大小<512M |
|**开启音乐 function call** |双向流式优化版\-开启二遍支持 |✅ |✅ |
|**开启** **POI** **function call** |双向流式优化版\-开启二遍支持 |✅ |✅ |
|**支持语种** |* **中英文**<br><br><br>（双向流式只支持中英文、二遍支持中英文及方言） |* **中英文**<br><br>* **方言：** <br><br>   * 方言文本输出：粤语、四川、陕西、冀鲁、兰银、江淮；<br><br>   * 普通话文本输出：上海话、闽南语，山西话、客家话；<br><br>   * 国内口音普通话（东北话、北京话等）<br><br>* **外语：中英+23种**<br><br>   日语、印尼语、西班牙语、葡萄牙语、德语、法语、韩语、菲律宾语、马来语、泰语、阿拉伯语、意大利语、孟加拉语 、希腊语、荷兰语、俄语 、土耳其语 、越南语 、波兰语、罗马尼亚语 、尼泊尔语 、乌克兰语、粤语 ||


<span id="9be973a6"></span>
## 应用场景


|应用场景 |场景描述及价值 |
|---|---|
|语音交互 |为人机交互提供语音输入渠道，通过实时将语音转成文字作为输入，达到和设备/硬件/应用快速&便捷交互的目的 |
|内容审核质检 |将录音识别为文字，通过质检规则对文本进行分析，及时发现违规内容并干预处理；或对内容进行监控分析，发掘潜在商机 |
|会议访谈转写 |将会议、访谈音频实时或异步识别为文字，自动切分有语音部分识别，降本增效；同时自动分段，有效提升会议内容记录效率 |
|游戏语音输入 |针对游戏语音输入、手机输入法场景，支持用户“边说边出文字”的效果，极大降低用户文字沟通的精力、提升沟通效率 |
|课堂内容分析 |将课堂录音文件进行识别，通过文字还原课堂场景，分析教学内容，提升教学质量 |
|音视频字幕 |支持自动将音/视频中的语音、歌词识别转换为文本，一键生成与音视频对应的字幕内容。适用于视频剪辑、视频观看、视频会议等多个场景。 |







---

## 流式语音识别（分组节点）

> 文档ID: 2607736 | URL: https://www.volcengine.com/docs/6561/2607736 | 标题:  | MDContent长度: 0

> 该文档为分组节点（容器），无独立正文；其子文档已分别在本文件其他段落中收录。


---

## 单向流式语音识别 WebSocket

> 文档ID: 2628951 | URL: https://www.volcengine.com/docs/6561/2628951 | 标题: 单向流式语音识别WebSocket | MDContent长度: 10047

**流式输入音频**，返回整句语音识别结果，准确率优于双向流式接口。本接口适用于非实时场景，如语音输入法、微信消息语音转写等场景

&nbsp;

> 运行依赖文件

> 
<Tabs>
<Tab zoneid="cHFyoLxJFC" title="Python">
<TabTitle>Python</TabTitle>

&nbsp;

<Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_084f2effab285cf82e5196388e0bd354.zip" name="sauc_python.zip">sauc_python.zip</Attachment>



</Tab>
<Tab zoneid="nCazn1TLQY" title="Go">
<TabTitle>Go</TabTitle>

&nbsp;

<Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_25e3ec23373a78508cf36cb446a4141f.zip" name="sauc_go.zip">sauc_go.zip</Attachment>



</Tab>
</Tabs>




---



<span data-label="purple">POST</span> wss://[openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream](http://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream)

&nbsp;


<span id="ULAS3Id9"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|1RbFw3">必选</span>

API Key 可从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考示例](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

请求的模型版本，可选值：


* 豆包流式语音识别模型2.0 <span data-label="purple">推荐</span>

   * 小时版：`volc.seedasr.sauc.duration`

   * 并发版：`volc.seedasr.sauc.concurrent`

* 豆包流式语音识别模型1.0

   * 小时版：`volc.seedasr.sauc.duration`

   * 并发版：`volc.seedasr.sauc.concurrent`



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

提交和查询任务的任务ID，推荐传入随机生成的UUID



**X\-Api\-Sequence ** `string` <span data-api-tag="require|W2vM70">必选</span>

发包序号，固定值: `-1`




<span id="OG7QrhRG"></span>
### 请求体


**audio ** `dict` <span data-api-tag="require|WnVo1B">必选</span>


**url ** `string` <span data-api-tag="require|1zS7c2">必选</span>

音频链接



**language ** `string`

指定识别语种，当前支持识别以下语种：


* 中文普通话：`zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语：`ar-SA`

* 意大利语：`it-IT`

* 孟加拉语：`bn-BD`

* 希腊语：`el-GR`

* 荷兰语：`nl-NL`

* 俄语：`ru-RU`

* 土耳其语：`tr-TR`

* 越南语：`vi-VN`

* 波兰语：`pl-PL`

* 罗马尼亚语：`ro-R0`

* 尼泊尔语：`ne-NP`

* 乌克兰语：`uk-UA`

* 粤语：`yue-CN`


注意：

当 `language` 参数为空时，模型支持识别以下语种：中文、英文、上海话、闽南话、四川话、陕西话、粤语



**format ** `string` <span data-api-tag="require|7sHXWE">必选</span>

指定音频格式。

可选值：`raw` / `wav` / `mp3` / `ogg `/ `pcm` /` spx` / `amr` /` aac` / `m4a`



**codec** `string`

指定音频编码格式，默认为raw（pcm）

可选值：`raw` / `opus`



**rate** `int`

指定音频采样率，默认值为 `16000`



**bits** `int`

指定音频采样点位数，默认值为16



**channel** `int`

指定音频声道数，默认值为 `1`

可选值：

`1`：mono

`2`：stereo




**request** `object`


**model_name** `string` <span data-api-tag="require|tXLKeG">必选</span>

指定模型名称，目前仅支持 `bigmodel`



**enable_speaker_info** `bool`

说话人分离。开启后可返回说话人信息，默认为`false`

注意


* 需要与`ssd_version`参数配合使用

* 仅在 `language` 未指定，或指定为` zh-CN` 时生效

* 推荐搭配**豆包流式语音识别模型 2.0** 使用



**ssd_version** `string`

说话人分离场景对应的模型版本。使用后，返回的内容里包含说话人，推荐搭配**豆包流式语音识别模型 2.0** 使用

可选值如下


* `200`：

   * 说话人数量建议不超过5人

   * 适用于**非会议场景**

   * 需将`enable_speaker_info`设置为`true`

* `300`：

   * 使用声纹匹配能力

   * 适用于长音频会议场景，包括线上会议、录音笔、录音卡、笔记 App 等**多人说话场景**

   * 需将`enable_speaker_info`设置为`true`



**ssd_mode** `int`

指定说话人分离模式，仅`ssd_version：200`模型支持该参数。可选值如下：


* `0`:普通模式（默认），适用于3分钟以内、说话人数小于5的短音频

* `1`:聚类模式，适用于3分钟以上的长音频，如售车、售房、一对多销售等非会议场景



**enable_itn** `bool`

启用将语音识别结果转换为规范的书面格式，默认为`true`

开启后，系统会将语音里口语化的数字、金额及日期等自动转成阿拉伯数字和符号形式，使文本更简洁、更易读

效果示例:


* "一九七零年" → "1970 年"

* "一百二十三美元" → "$123"



**enable_punc** `bool`

启用标点，默认为`false`

开启后，系统会在识别结果中添加逗号、句号、问号等标点符号，提升文本可读性



**enable_ddc** `bool`

启用语义顺滑，默认为 `false`

开启后，系统会删除或修正识别结果中的停顿词、语气词、语义重复词等不流畅内容，让文本更连贯、更易读


&nbsp;


**output_zh_variant ** `string`

将识别结果输出为繁体中文。

可选值：


* `traditional`:简体 → 繁体（大陆）

* `tw`：简体 → 台湾正体

* `hk`：简体 → 香港繁体



**enable_channel_split** `bool`

启用双声道识别，默认为`false`

开启后，返回结果中将以 `channel_id` 标记声道

`1` :左声道

`2` :右声道



**show_utterances** `bool`

启用输出分句、分词、说话人及语音停顿信息，默认为`false`



**show_speech_rate** `bool`

启用分句信息携带语速，默认为`false`

开启后，系统将在分句 `additions` 中返回语速信息，单位为 token/s



**show_volume** `bool`

启用分句信息携带音量，默认 `false`

开启后，系统将在分句 `additions` 中返回音量信息，单位为dB



**enable_auto_lang** `bool`

启用自动识别语种，默认 `false`

开启后，系统会自动检测音频所属语种。支持自动识别以下语种：


* 中文普通话 `zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语 `ar-SA`

* 意大利语 `it-IT`

* 孟加拉语 `bn-BD`

* 希腊语 `el-GR`

* 荷兰语 `nl-NL`

* 俄语 `ru-RU`

* 土耳其语 `tr-TR`

* 越南语 `vi-VN`

* 波兰语 `pl-PL`

* 罗马尼亚语 `ro-RO`

* 尼泊尔语 `ne-NP`

* 乌克兰语 `uk-UA`

* 粤语 `yue-CN`


注意：使用该能力时，不支持同时设置`corpus`参数，即不支持使用热词、替换词与上下文能力



**enable_lid** `bool`

启用中英文及方言识别，默认 `false`

支持识别以下语种：中文、英文、上海话、闽南话、四川话、陕西话、粤语

开启后，系统将在 `additions` 中返回语种/场景标签，取值如下：


* `singing_en`：英文唱歌

* `singing_mand`：普通话唱歌

* `singing_dia_cant`：粤语唱歌

* `speech_en`：英文说话

* `speech_mand`：普通话说话

* `speech_dia_nan`：闽南语

* `speech_dia_wuu`：吴语（含上海话）

* `speech_dia_cant`：粤语说话

* `speech_dia_xina`：西南官话（含四川话）

* `speech_dia_zgyu`：中原官话（含陕西话）

* `other_langs`：其它语种（其它语种人声）

* `others`：检测不出（非语义人声和非人声）

* 返回为空则代表无法判断（例如传入音频过短等）



**enable_emotion_detection** `bool`

启用情绪检测，默认为 `False`

开启后，系统将在分句`additions`中返回对应的情绪标签。支持的情绪标签如下：


* `angry`：表示情绪为生气

* `happy`：表示情绪为开心

* `neutral`：表示情绪为平静或中性

* `sad`：表示情绪为悲伤

* `surprise`：表示情绪为惊讶



**enable_gender_detection** `bool`

启用性别检测，默认为 `False`

开启后，系统将在分句`additions`中返回性别标签（male/female）


&nbsp;


**result_type ** `string`

结果返回方式，默认值为`full`

可选值：


* `full`：全量返回

* `single`：增量结果返回，即不返回之前分句的结果


&nbsp;


**vad_segment_duration** `int`

启用语音分句，默认为`false`

注意：当`enable_channel_split`设置为`true`时，建议使用语义分句



**end_window_size** `int`

语音活动检测 (VAD) 的静音判停阈值，单位 ms。当检测到的连续静音时长达到该值时，判定一句话结束并触发分句。默认值为 `800`

范围：`[300,5000] `

推荐值：`[800,1000]`


&nbsp;


**force_to_speech_time ** `int`

强制语音判定的最小时长阈值。当音频时长超过该值后，才会启动语音活动检测（VAD）判停；小于该值的音频不做判停处理；最小值1，单位ms

推荐值：`1000`



**sensitive_words_filter** `string`

启用敏感词过滤功能。开启后，可对识别结果中的敏感词做屏蔽或替换处理

示例

```Bash
"sensitive_words_filter":{\"system_reserved_filter\":true,\"filter_with_empty\":[\"敏感词\"],\"filter_with_signed\":[\"敏感词\"]}"
```



**system_reserved_filter ** `bool`

启用系统内置敏感词库。启用后，命中的系统敏感词会被替换为 `*`



**filter_with_empty ** `string`

设置需替换为空字符串的自定义敏感词列表



**filter_with_signed ** `string`

设置需替换为 `*` 的自定义敏感词列表




**enable_poi_fc** `bool`

启用 POI function call，调用专业的地图领域推荐词服务辅助识别，提高识别准确率

示例：

```SQL
"request": {
    "enable_poi_fc": true,
    "corpus": {
        "context": "{\"loc_info\":{\"city_name\":\"北京市\"}}"
    }
}
```




**enable_music_fc** `bool`

开启后，对于语音识别困难的词语，能调用专业的音领域推荐词服务辅助识别



**corpus** `object`

配置语境词典，可自定义配置热词、替换词，配置后可提高特定语境下的词语识别准确率

注意：使用该能力时，不支持同时设置`enable_auto_lang`参数


**boosting_table_name ** `string`

热词词表名称，配置热词后可优化该类词语的识别效果

热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中添加



**boosting_table_id ** `string`

热词词表id，配置热词可优化该类词语的识别效果


* 热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中添加

* 若传入的`boosting_table_name`和`boosting_table_id`对应的热词词表不一致，则以`boosting_table_id`为准



**correct_table_name ** `string`

替换词词表名称，配置替换词，可将模型识别出的特定词汇替换为目标词汇

替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**correct_table_id ** `string`

替换词词表名称，配置替换词，可将模型识别出的特定词汇替换为目标词汇


* 替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置

* 若传入的`correct_table_name`和`correct_table_id`对应的热词词表不一致，则以`correct_table_id`为准



**regex_correct_table_name**`string`

正则替换词表名称。相较于替换词的精确匹配替换，正则替换词适合批量格式转换（如日期格式统一、符号标准化）、模糊模式匹配等复杂场景

正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**regex_correct_table_id ** `string`

正则替换词表id。

正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**context ** `string`

上下文功能。在识别前传入辅助信息，帮助模型更准确地识别。支持热词直传、传入对话历史、场景等信息。最佳使用方式可参考：[热词与上下文最佳实践](https://docs.volcengine.com/docs/6561/2604976?lang=zh)

注意：使用该能力时，不支持同时设置`enable_auto_lang`参数

示例：

```Python
{
  "corpus": {
    "context": {
      "hotwords": [
        { "word": "豆包" },
        { "word": "火山引擎" },
        { "word": "奥迪A4L" }
      ],
      "context_type": "dialog_ctx",
      "context_data": [
        { "text": "最近一轮助手的回答" },
        { "text": "最近一轮用户的提问" },
        { "text": "更早一轮助手的回答" },
        { "text": "更早一轮用户的提问" }
      ]
    }
  }
}
```



**hotwords ** `string`

热词列表直传，用于提升指定词汇的识别准确率。最佳使用方式可参考：[热词与上下文最佳实践](https://docs.volcengine.com/docs/6561/2604976?lang=zh)

注意：使用该能力时，不支持同时设置`enable_auto_lang`参数


**word** `string`

热词内容




**context_type** `string`

上下文类型，目前仅支持`dialog_ctx`



**context_data** `object`

上下文数据列表，用于传入历史对话等语境信息，需同时配置`context_type`


**text ** `string`

历史对话文本，帮助模型理解语境，提升识别准确率



**image_url ** `string`

图片 URL，用于提供视觉上下文，辅助理解语音内容










<span id="pF6mxalL"></span>
### 响应


**code ** `int`

请求状态码。0 表示识别成功，非 0 表示识别失败



**event** `int`

会话事件类型标识



**is_last_package ** `bool`

是否为最后一个响应包。`true` 表示识别结果已全部返回



**payload_sequence ** `int`

响应数据包的序号



**payload_size ** `int`

响应数据 payload 的字节大小



**payload_msg ** `object`

响应数据主体，包含音频信息与识别结果


**audio_info ** `object`

音频相关信息


**duration ** `int`

音频时长，单位为毫秒（ms）




**result ** `list`

识别结果，识别成功后返回


**additions ** `object`


**log_id** `string`

服务端返回的 logid，方便定位问题




**text ** `string`

音频识别结果文本，识别成功后返回



**utterances ** `list`

语音分句信息。满足以下条件时返回


* 请求参数`show_utterances`设置为`true`

* 识别成功



**fixed_prefix_result ** `strin`

&nbsp;

已确定的前缀识别结果



**source ** `string`

分句结果来源



**speaker_id ** `string`

说话人 ID。开启说话人分离 `enable_speaker_info=true`后返回



**definite ** `bool`

当前分句结果是否为最终确定结果。`true` 表示该分句不再变化



**words** `list`

分词信息列表。请求参数`show_utterances`设置为`true`且识别成功时返回


**start_time ** `int`

起始时间（毫秒）



**end_time ** `int`

结束时间（毫秒）



**text ** `string`

语音文本内容。满足以下条件时返回


* 请求参数show_utterances设置为true

* 识别成功














---

## 双向流式语音识别 WebSocket

> 文档ID: 2630027 | URL: https://www.volcengine.com/docs/6561/2630027 | 标题: 双向流式语音识别WebSocket | MDContent长度: 10636

流式输入音频，实时返回识别结果，实现边说边出字的效果。本接口识别速度优于单向流式接口，适用于实时会议字幕、直播字幕、智能外呼等场景

&nbsp;

> 运行依赖文件

> 
<Tabs>
<Tab zoneid="ZdWDeQZL" title="Python">
<TabTitle>Python</TabTitle>

&nbsp;

<Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_084f2effab285cf82e5196388e0bd354.zip" name="sauc_python.zip">sauc_python.zip</Attachment>



</Tab>
<Tab zoneid="cMxx2BqQ" title="Go">
<TabTitle>Go</TabTitle>

&nbsp;

<Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_25e3ec23373a78508cf36cb446a4141f.zip" name="sauc_go.zip">sauc_go.zip</Attachment>



</Tab>
</Tabs>




---



<span data-label="purple">POST</span> wss://[openspeech.bytedance.com/api/v3/sauc/bigmodel_async](http://openspeech.bytedance.com/api/v3/sauc/bigmodel_async)

&nbsp;


<span id="ULAS3Id9"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|1RbFw3">必选</span>

API Key 可从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考示例](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

请求的模型版本，可选值：


* 豆包流式语音识别模型2.0 <span data-label="purple">推荐</span>

   * 小时版：`volc.seedasr.sauc.duration`

   * 并发版：`volc.seedasr.sauc.concurrent`

* 豆包流式语音识别模型1.0

   * 小时版：`volc.seedasr.sauc.duration`

   * 并发版：`volc.seedasr.sauc.concurrent`



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

提交和查询任务的任务ID，推荐传入随机生成的UUID



**X\-Api\-Sequence ** `string` <span data-api-tag="require|W2vM70">必选</span>

发包序号，固定值: `-1`




<span id="OG7QrhRG"></span>
### 请求体


**audio ** `dict` <span data-api-tag="require|WnVo1B">必选</span>


**url ** `string` <span data-api-tag="require|1zS7c2">必选</span>

音频链接



**language ** `string`

指定识别语种，当前支持识别以下语种：


* 中文普通话：`zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语：`ar-SA`

* 意大利语：`it-IT`

* 孟加拉语：`bn-BD`

* 希腊语：`el-GR`

* 荷兰语：`nl-NL`

* 俄语：`ru-RU`

* 土耳其语：`tr-TR`

* 越南语：`vi-VN`

* 波兰语：`pl-PL`

* 罗马尼亚语：`ro-R0`

* 尼泊尔语：`ne-NP`

* 乌克兰语：`uk-UA`

* 粤语：`yue-CN`


注意：

当 `language` 参数为空时，模型支持识别以下语种：中文、英文、上海话、闽南话、四川话、陕西话、粤语



**format ** `string` <span data-api-tag="require|7sHXWE">必选</span>

指定音频格式。

可选值：`raw` / `wav` / `mp3` / `ogg `/ `pcm` /` spx` / `amr` /` aac` / `m4a`



**codec** `string`

指定音频编码格式，默认为raw（pcm）

可选值：`raw` / `opus`



**rate** `int`

指定音频采样率，默认值为 `16000`



**bits** `int`

指定音频采样点位数，默认值为16



**channel** `int`

指定音频声道数，默认值为 `1`

可选值：

`1`：mono

`2`：stereo




**request** `object`


**model_name** `string` <span data-api-tag="require|tXLKeG">必选</span>

指定模型名称，目前仅支持 `bigmodel` 


&nbsp;


**enable_nonstream ** `bool`

是否开启**二遍识别模式**。开启后，同一个接口会在双向流式实时的基础上，对每个分句再用非流式模型 (nostream) 重新识别一遍，以提升该分句的最终准确率。既满足实时上屏的 “快”, 又保证最终结果的 “准”。

**开启后的行为:** 


* 自动启用语音活动检测 (VAD) 分句，默认静音 800ms 判定为一句结束 (可通过 `end_window_size` 参数调整)。

* 每次 VAD 判停时，会用非流式模型对该分句音频重新识别。

* 仅在非流式模型重新识别的结果中，才会带上 `"definite": true` 分句标识 ，用于标记该分句为最终确定结果。



**enable_speaker_info** `bool`

说话人分离。开启后可返回说话人信息，默认为`false`

注意


* 需要与`ssd_version`参数配合使用

* 仅在 `language` 未指定，或指定为` zh-CN` 时生效

* 推荐搭配**豆包流式语音识别模型 2.0** 使用



**ssd_version** `string`

说话人分离场景对应的模型版本。使用后，返回的内容里包含说话人，推荐搭配**豆包流式语音识别模型 2.0** 使用

可选值如下


* `200`：

   * 说话人数量建议不超过5人

   * 适用于**非会议场景**

   * 需将`enable_speaker_info`设置为`true`

* `300`：

   * 使用声纹匹配能力

   * 适用于长音频会议场景，包括线上会议、录音笔、录音卡、笔记 App 等**多人说话场景**

   * 需将`enable_speaker_info`设置为`true`



**ssd_mode** `int`

指定说话人分离模式，仅`ssd_version：200`模型支持该参数。可选值如下：


* `0`:普通模式（默认），适用于3分钟以内、说话人数小于5的短音频

* `1`:聚类模式，适用于3分钟以上的长音频，如售车、售房、一对多销售等非会议场景



**enable_itn** `bool`

启用将语音识别结果转换为规范的书面格式，默认为`true`

开启后，系统会将语音里口语化的数字、金额及日期等自动转成阿拉伯数字和符号形式，使文本更简洁、更易读

效果示例:


* "一九七零年" → "1970 年"

* "一百二十三美元" → "$123"



**enable_punc** `bool`

启用标点，默认为`false`

开启后，系统会在识别结果中添加逗号、句号、问号等标点符号，提升文本可读性



**enable_ddc** `bool`

启用语义顺滑，默认为 `false`

开启后，系统会删除或修正识别结果中的停顿词、语气词、语义重复词等不流畅内容，让文本更连贯、更易读


&nbsp;


**output_zh_variant ** `string`

将识别结果输出为繁体中文。

可选值：


* `traditional`:简体 → 繁体（大陆）

* `tw`：简体 → 台湾正体

* `hk`：简体 → 香港繁体



**enable_channel_split** `bool`

启用双声道识别，默认为`false`

开启后，返回结果中将以 `channel_id` 标记声道

`1` :左声道

`2` :右声道



**show_utterances** `bool`

启用输出分句、分词、说话人及语音停顿信息，默认为`false`



**show_speech_rate** `bool`

启用分句信息携带语速，默认为`false`

开启后，系统将在分句 `additions` 中返回语速信息，单位为 token/s

注意: 开启此功能后，会自动开启语音活动检测 (VAD) 分句。当检测到静音片段超过 800ms 时切分为一句。该静音判停阈值可通过`end_window_size` 参数调整。



**show_volume** `bool`

启用分句信息携带音量，默认 `false`

开启后，系统将在分句 `additions` 中返回音量信息，单位为dB

注意: 开启此功能后，会自动开启语音活动检测 (VAD) 分句。当检测到静音片段超过 800ms 时切分为一句。该静音判停阈值可通过`end_window_size` 参数调整。


&nbsp;


**enable_lid** `bool`

启用中英文及方言识别，默认 `false`

支持识别以下语种：中文、英文、上海话、闽南话、四川话、陕西话、粤语

开启后，系统将在 `additions` 中返回语种/场景标签，取值如下：


* `singing_en`：英文唱歌

* `singing_mand`：普通话唱歌

* `singing_dia_cant`：粤语唱歌

* `speech_en`：英文说话

* `speech_mand`：普通话说话

* `speech_dia_nan`：闽南语

* `speech_dia_wuu`：吴语（含上海话）

* `speech_dia_cant`：粤语说话

* `speech_dia_xina`：西南官话（含四川话）

* `speech_dia_zgyu`：中原官话（含陕西话）

* `other_langs`：其它语种（其它语种人声）

* `others`：检测不出（非语义人声和非人声）

* 返回为空则代表无法判断（例如传入音频过短等）


注意: 开启此功能后，会自动开启语音活动检测 (VAD) 分句。当检测到静音片段超过 800ms 时切分为一句。该静音判停阈值可通过`end_window_size` 参数调整。



**enable_emotion_detection** `bool`

启用情绪检测，默认为 `False`

开启后，系统将在分句`additions`中返回对应的情绪标签。支持的情绪标签如下：


* `angry`：表示情绪为生气

* `happy`：表示情绪为开心

* `neutral`：表示情绪为平静或中性

* `sad`：表示情绪为悲伤

* `surprise`：表示情绪为惊讶


注意: 开启此功能后，会自动开启语音活动检测 (VAD) 分句。当检测到静音片段超过 800ms 时切分为一句。该静音判停阈值可通过`end_window_size` 参数调整。



**enable_gender_detection** `bool`

启用性别检测，默认为 `False`

开启后，系统将在分句`additions`中返回性别标签（male/female）

注意: 开启此功能后，会自动开启语音活动检测 (VAD) 分句。当检测到静音片段超过 800ms 时切分为一句。该静音判停阈值可通过`end_window_size` 参数调整。


&nbsp;


**result_type ** `string`

结果返回方式，默认值为`full`

可选值：


* `full`：全量返回

* `single`：增量结果返回，即不返回之前分句的结果


&nbsp;


**enable_accelerate_text ** `bool`

是否启动首字返回加速。如果设为`True`，则会尽量加速首字返回，但会降低首字准确率。默认值`False`


&nbsp;


**accelerate_score** `int`

首字返回加速率，设置的值越大，首字出字越快。默认值为0，表示不加速。

注意：该参数需要配合`enable_accelerate_text`参数使用



**vad_segment_duration** `int`

启用语音分句，默认为`false`

注意：当`enable_channel_split`设置为`true`时，建议使用语义分句



**end_window_size** `int`

语音活动检测 (VAD) 的静音判停阈值，单位 ms。当检测到的连续静音时长达到该值时，判定一句话结束并触发分句。默认值为 `800`

范围：`[300,5000] `

推荐值：`[800,1000]`


&nbsp;


**force_to_speech_time ** `int`

强制语音判定的最小时长阈值。当音频时长超过该值后，才会启动语音活动检测（VAD）判停；小于该值的音频不做判停处理；最小值1，单位ms

推荐值：`1000`



**sensitive_words_filter** `string`

启用敏感词过滤功能。开启后，可对识别结果中的敏感词做屏蔽或替换处理

示例

```Bash
"sensitive_words_filter":{\"system_reserved_filter\":true,\"filter_with_empty\":[\"敏感词\"],\"filter_with_signed\":[\"敏感词\"]}"
```



**system_reserved_filter ** `bool`

启用系统内置敏感词库。启用后，命中的系统敏感词会被替换为 `*`



**filter_with_empty ** `string`

设置需替换为空字符串的自定义敏感词列表



**filter_with_signed ** `string`

设置需替换为 `*` 的自定义敏感词列表






**enable_poi_fc** `bool`

启用 POI function call，调用专业的地图领域推荐词服务辅助识别，提高识别准确率

注意：使用该能力时，需要将`enable_nonstream`设置为`true`

示例：

```SQL
"request": {
    "enable_poi_fc": true,
    "corpus": {
        "context": "{\"loc_info\":{\"city_name\":\"北京市\"}}"
    }
}
```




**enable_music_fc** `bool`

开启后，对于语音识别困难的词语，能调用专业的音领域推荐词服务辅助识别

注意：使用该能力时，需要将`enable_nonstream`设置为`true`



**corpus** `object`

配置语境词典，可自定义配置热词、替换词，配置后可提高特定语境下的词语识别准确率

注意：使用该能力时，不支持同时设置`enable_auto_lang`参数


**boosting_table_name ** `string`

热词词表名称，配置热词后可优化该类词语的识别效果

热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中添加



**boosting_table_id ** `string`

热词词表id，配置热词可优化该类词语的识别效果


* 热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中添加

* 若传入的`boosting_table_name`和`boosting_table_id`对应的热词词表不一致，则以`boosting_table_id`为准



**correct_table_name ** `string`

替换词词表名称，配置替换词，可将模型识别出的特定词汇替换为目标词汇

替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**correct_table_id ** `string`

替换词词表名称，配置替换词，可将模型识别出的特定词汇替换为目标词汇


* 替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置

* 若传入的`correct_table_name`和`correct_table_id`对应的热词词表不一致，则以`correct_table_id`为准



**regex_correct_table_name**`string`

正则替换词表名称。相较于替换词的精确匹配替换，正则替换词适合批量格式转换（如日期格式统一、符号标准化）、模糊模式匹配等复杂场景

正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**regex_correct_table_id ** `string`

正则替换词表id。

正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**context ** `string`

上下文功能。在识别前传入辅助信息，帮助模型更准确地识别。支持热词直传、传入对话历史、场景等信息。最佳使用方式可参考：[热词与上下文最佳实践](https://docs.volcengine.com/docs/6561/2604976?lang=zh)

注意：使用该能力时，不支持同时设置`enable_auto_lang`参数

示例：

```Python
{
  "corpus": {
    "context": {
      "hotwords": [
        { "word": "豆包" },
        { "word": "火山引擎" },
        { "word": "奥迪A4L" }
      ],
      "context_type": "dialog_ctx",
      "context_data": [
        { "text": "最近一轮助手的回答" },
        { "text": "最近一轮用户的提问" },
        { "text": "更早一轮助手的回答" },
        { "text": "更早一轮用户的提问" }
      ]
    }
  }
}
```



**hotwords ** `string`

热词列表直传，用于提升指定词汇的识别准确率。最佳使用方式可参考：[热词与上下文最佳实践](https://docs.volcengine.com/docs/6561/2604976?lang=zh)

注意：使用该能力时，不支持同时设置`enable_auto_lang`参数


**word** `string`

热词内容




**context_type** `string`

上下文类型，目前仅支持`dialog_ctx`



**context_data** `object`

上下文数据列表，用于传入历史对话等语境信息，需同时配置`context_type`


**text ** `string`

历史对话文本，帮助模型理解语境，提升识别准确率



**image_url ** `string`

图片 URL，用于提供视觉上下文，辅助理解语音内容












<span id="pF6mxalL"></span>
### 响应


**code ** `int`

请求状态码。0 表示识别成功，非 0 表示识别失败



**event** `int`

会话事件类型标识



**is_last_package ** `bool`

是否为最后一个响应包。`true` 表示识别结果已全部返回



**payload_sequence ** `int`

响应数据包的序号



**payload_size ** `int`

响应数据 payload 的字节大小



**payload_msg ** `object`

响应数据主体，包含音频信息与识别结果


**audio_info ** `object`

音频相关信息


**duration ** `int`

音频时长，单位为毫秒（ms）




**result ** `list`

识别结果，识别成功后返回


**additions ** `object`


**log_id** `string`

服务端返回的 logid，方便定位问题




**text ** `string`

音频识别结果文本，识别成功后返回



**utterances ** `list`

语音分句信息。满足以下条件时返回


* 请求参数`show_utterances`设置为`true`

* 识别成功



**fixed_prefix_result ** `strin`

&nbsp;

已确定的前缀识别结果



**source ** `string`

分句结果来源



**speaker_id ** `string`

说话人 ID。开启说话人分离 `enable_speaker_info=true`后返回



**definite ** `bool`

当前分句结果是否为最终确定结果。`true` 表示该分句不再变化



**words** `list`

分词信息列表。请求参数`show_utterances`设置为`true`且识别成功时返回


**start_time ** `int`

起始时间（毫秒）



**end_time ** `int`

结束时间（毫秒）



**text ** `string`

语音文本内容。满足以下条件时返回


* 请求参数show_utterances设置为true

* 识别成功









 &nbsp;

&nbsp;






---

## 录音文件识别标准版 - 任务提交 HTTP

> 文档ID: 2606791 | URL: https://www.volcengine.com/docs/6561/2606791 | 标题: 任务提交-HTTP | MDContent长度: 8106

本接口可将音频文件异步转写成文本；上传文件需小于 512 MB, 时长不超过 5 小时，支持 raw、wav、mp3、ogg 、pcm 、spx、amr、aac、m4a 格式

上传后需通过**查询接口**获取识别结果

&nbsp;

<span data-label="purple">POST</span>https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit

&nbsp;


<span id="ULAS3Id9"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|1RbFw3">必选</span>

API Key 可从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考示例](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

请求的模型版本，可选值：


* `volc.seedasr.auc`：豆包录音文件识别模型2.0

* `volc.bigasr.auc`：豆包录音文件识别模型1.0



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

提交和查询任务的任务ID，推荐传入随机生成的UUID



**X\-Api\-Sequence ** `string` <span data-api-tag="require|W2vM70">必选</span>

发包序号，固定值: `-1`




<span id="OG7QrhRG"></span>
### 请求体


**audio ** `dict` <span data-api-tag="require|WnVo1B">必选</span>


**url ** `string` <span data-api-tag="require|1zS7c2">必选</span>

指定音频链接



**language ** `string`

指定识别语种，当前支持识别以下语种：


* 中文普通话：`zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语：`ar-SA`

* 意大利语：`it-IT`

* 孟加拉语：`bn-BD`

* 希腊语：`el-GR`

* 荷兰语：`nl-NL`

* 俄语：`ru-RU`

* 土耳其语：`tr-TR`

* 越南语：`vi-VN`

* 波兰语：`pl-PL`

* 罗马尼亚语：`ro-R0`

* 尼泊尔语：`ne-NP`

* 乌克兰语：`uk-UA`

* 粤语：`yue-CN`


注意：

当 `language` 参数为空时，模型支持识别以下语种：中文、英文、上海话、闽南话、四川话、陕西话、粤语



**format ** `string` <span data-api-tag="require|7sHXWE">必选</span>

指定音频格式。

可选值：`raw` / `wav` / `mp3` / `ogg `/ `pcm` /` spx` / `amr` /` aac` / `m4a`



**codec** `string`

指定音频编码格式，默认为raw（pcm）

可选值：`raw` / `opus`



**rate** `int`

指定音频采样率，默认值为 `16000`



**bits** `int`

指定音频采样点位数，默认值为16



**channel** `int`

指定音频声道数，默认值为 `1`

可选值：

`1`：mono

`2`：stereo




**request** `object`


**model_name** `string` <span data-api-tag="require|tXLKeG">必选</span>

指定模型名称，目前仅支持 `bigmodel`



**enable_speaker_info** `bool`

启用说话人分离参数，默认为`false`

开启后需指定`ssd_version`，并将`show_utterances`设置为`true`，才能获取到说话人分离结果



**ssd_version** `string`

指定说话人分离场景对应的模型版本，可选值如下：


* `200`：

   * 说话人数量建议不超过5人

   * 适用于**非会议场景**

   * 需将`enable_speaker_info`和`show_utterances`设置为`true`

* `300`：

   * 使用声纹匹配能力

   * 适用于长音频会议场景，包括线上会议、录音笔、录音卡、笔记 App 等**多人说话场景**

   * 需将`enable_speaker_info`和`show_utterances`设置为`true`



**ssd_mode** `int`

指定说话人分离模式，仅`ssd_version：200`模型支持该参数。可选值如下：


* `0`:普通模式（默认），适用于3分钟以内、说话人数小于5的短音频

* `1`:聚类模式，适用于3分钟以上的长音频，如售车、售房、一对多销售等非会议场景



**enable_itn** `bool`

启用将语音识别结果转换为规范的书面格式，默认为`true`

开启后，系统会将语音里口语化的数字、金额及日期等自动转成阿拉伯数字和符号形式，使文本更简洁、更易读

效果示例:


* "一九七零年" → "1970 年"

* "一百二十三美元" → "$123"



**enable_punc** `bool`

启用标点，默认为`false`

开启后，系统会在识别结果中添加逗号、句号、问号等标点符号，提升文本可读性



**enable_ddc** `bool`

启用语义顺滑，默认为 `false`

开启后，系统会删除或修正识别结果中的停顿词、语气词、语义重复词等不流畅内容，让文本更连贯、更易读



**enable_channel_split** `bool`

启用双声道识别，默认为`false`

开启后，返回结果中将以 `channel_id` 标记声道

`1` :左声道

`2` :右声道



**show_utterances** `bool`

启用输出分句、分词、说话人及语音停顿信息，默认为`false`



**show_speech_rate** `bool`

启用分句信息携带语速，默认为`false`

开启后，系统将在分句 `additions` 中返回语速信息，单位为 token/s



**show_volume** `bool`

启用分句信息携带音量，默认 `false`

开启后，系统将在分句 `additions` 中返回音量信息，单位为dB



**enable_auto_lang** `bool`

启用自动识别语种，默认 `false`

开启后，系统会自动检测音频所属语种。支持自动识别以下语种：


* 中文普通话 `zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语 `ar-SA`

* 意大利语 `it-IT`

* 孟加拉语 `bn-BD`

* 希腊语 `el-GR`

* 荷兰语 `nl-NL`

* 俄语 `ru-RU`

* 土耳其语 `tr-TR`

* 越南语 `vi-VN`

* 波兰语 `pl-PL`

* 罗马尼亚语 `ro-RO`

* 尼泊尔语 `ne-NP`

* 乌克兰语 `uk-UA`

* 粤语 `yue-CN`



**enable_lid** `bool`

启用中英文及方言识别，默认 `false`

支持识别以下语种：中文、英文、上海话、闽南话、四川话、陕西话、粤语

开启后，系统将在 `additions` 中返回语种/场景标签，取值如下：


* `singing_en`：英文唱歌

* `singing_mand`：普通话唱歌

* `singing_dia_cant`：粤语唱歌

* `speech_en`：英文说话

* `speech_mand`：普通话说话

* `speech_dia_nan`：闽南语

* `speech_dia_wuu`：吴语（含上海话）

* `speech_dia_cant`：粤语说话

* `speech_dia_xina`：西南官话（含四川话）

* `speech_dia_zgyu`：中原官话（含陕西话）

* `other_langs`：其它语种（其它语种人声）

* `others`：检测不出（非语义人声和非人声）

* 返回为空则代表无法判断（例如传入音频过短等）



**enable_emotion_detection** `bool`

启用情绪检测，默认为 `False`

开启后，系统将在分句`additions`中返回对应的情绪标签。支持的情绪标签如下：


* `angry`：表示情绪为生气

* `happy`：表示情绪为开心

* `neutral`：表示情绪为平静或中性

* `sad`：表示情绪为悲伤

* `surprise`：表示情绪为惊讶



**enable_gender_detection** `bool`

启用性别检测，默认为 `False`

开启后，系统将在分句`additions`中返回性别标签（male/female）



**vad_segment** `bool`

启用语义分句（VAD分句），默认为`false`

注意：当`enable_channel_split`设置为`true`时，建议使用语义分句



**end_window_size** `int`

设置语音活动检测 (VAD) 的静音判停阈值，单位 ms。当系统检测到的连续静音时长达到该值时，则判定一句话结束并触发分句

范围：`[300,5000]` 

推荐值：`[800,1000]`



**sensitive_words_filter** `string`

启用敏感词过滤功能。开启后，可对识别结果中的敏感词做屏蔽或替换处理

示例

```Bash
"sensitive_words_filter":{\"system_reserved_filter\":true,\"filter_with_empty\":[\"敏感词\"],\"filter_with_signed\":[\"敏感词\"]}"
```



**system_reserved_filter ** `bool`

启用系统内置敏感词库。启用后，命中的系统敏感词会被替换为 `*`



**filter_with_empty ** `string`

设置需替换为空字符串的自定义敏感词列表



**filter_with_signed ** `string`

设置需替换为 `*` 的自定义敏感词列表




**enable_poi_fc** `bool`

启用 POI function call，调用专业的地图领域推荐词服务辅助识别，提高识别准确率

示例：

```SQL
"request": {
    "enable_poi_fc": true,
    "corpus": {
        "context": "{\"loc_info\":{\"city_name\":\"北京市\"}}"
    }
}
```




**enable_music_fc** `bool`

开启后，对于语音识别困难的词语，能调用专业的音领域推荐词服务辅助识别



**corpus** `object`

配置语境词典，可自定义配置热词、替换词，配置后可提高特定语境下的词语识别准确率


**boosting_table_name ** `string`

热词词表名称，配置热词后可优化该类词语的识别效果

热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中添加



**boosting_table_id ** `string`

热词词表id，配置热词可优化该类词语的识别效果


* 热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中添加

* 若传入的`boosting_table_name`和`boosting_table_id`对应的热词词表不一致，则以`boosting_table_id`为准



**correct_table_name ** `string`

替换词词表名称，配置替换词，可将模型识别出的特定词汇替换为目标词汇

替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**correct_table_id ** `string`

替换词词表名称，配置替换词，可将模型识别出的特定词汇替换为目标词汇


* 替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置

* 若传入的`correct_table_name`和`correct_table_id`对应的热词词表不一致，则以`correct_table_id`为准



**regex_correct_table_name**`string`

正则替换词表名称。相较于替换词的精确匹配替换，正则替换词适合批量格式转换（如日期格式统一、符号标准化）、模糊模式匹配等复杂场景

正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**regex_correct_table_id ** `string`

正则替换词表id。

正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**context ** `string`

上下文功能。在识别前传入辅助信息，帮助模型更准确地识别。支持热词直传、传入对话历史、场景等信息。最佳使用方式可参考：[热词与上下文最佳实践](https://docs.volcengine.com/docs/6561/2604976?lang=zh)

示例：

```Python
{
  "corpus": {
    "context": {
      "hotwords": [
        { "word": "豆包" },
        { "word": "火山引擎" },
        { "word": "奥迪A4L" }
      ],
      "context_type": "dialog_ctx",
      "context_data": [
        { "text": "最近一轮助手的回答" },
        { "text": "最近一轮用户的提问" },
        { "text": "更早一轮助手的回答" },
        { "text": "更早一轮用户的提问" }
      ]
    }
  }
}
```



**hotwords ** `string`

热词列表直传，用于提升指定词汇的识别准确率。最佳使用方式可参考：[热词与上下文最佳实践](https://docs.volcengine.com/docs/6561/2604976?lang=zh)


**word** `string`

热词内容




**context_type** `string`

上下文类型，目前仅支持`dialog_ctx`



**context_data** `object`

上下文数据列表，用于传入历史对话等语境信息，需同时配置`context_type`


**text ** `string`

历史对话文本，帮助模型理解语境，提升识别准确率



**image_url ** `string`

图片 URL，用于提供视觉上下文，辅助理解语音内容







**callback  ** `string`

指定回调地址。

示例：

```Python
"callback": "http://xxx"
```




**callback_data** `string`

指定回调信息。

```Python
"callback_data":"$Request-Id"
```





<span id="pF6mxalL"></span>
### 响应


**task_id ** `string`

任务 ID，可通过该 ID 调用识别结果查询接口获取识别结果



**X\-Tt\-Logid ** `string`

服务端返回的 logid，方便定位问题



**X\-Api\-Status\-Code ** `string`

提交任务后服务端返回的状态码



**X\-Api\-Message ** `string`

提交任务后服务端返回的信息，`OK` 表示成功，其他值表示失败








---

## 录音文件识别标准版 - 结果查询 HTTP

> 文档ID: 2606792 | URL: https://www.volcengine.com/docs/6561/2606792 | 标题: 结果查询-HTTP | MDContent长度: 1368

通过task_id查询录音文件识别标准版、录音文件识别极速版、录音文件识别闲时版接口的识别结果；

**本接口请求体为空json**

&nbsp;

<span data-label="purple">POST</span> https://openspeech.bytedance.com/api/v3/auc/bigmodel/query

&nbsp;


<span id="U2dCXzkM"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|g9zFYw">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|g9zFYw">必选</span>

请求的模型版本，可选值：


* `volc.seedasr.auc`:豆包录音文件识别模型2.0

* `volc.bigasr.auc`：豆包录音文件识别模型1.0



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|g9zFYw">必选</span>

传入录音文件识别接口返回的`task_id`




<span id="WtD1SAXn"></span>
### 响应


**X\-Tt\-Logid ** `string`

服务端返回的 logid，方便定位问题



**X\-Api\-Status\-Code ** `string`

提交任务后服务端返回的状态码



**X\-Api\-Message ** `string`

提交任务后服务端返回的信息，OK 表示成功，其他值表示失败



**result** `list`

识别结果，识别成功后返回


**text ** `string`

音频识别结果文本，识别成功后返回



**utterances ** `string`

语音分句信息。满足以下条件时返回


* 请求参数`show_utterances`设置为`true`

* 识别成功


&nbsp;


**text ** `string`

语音文本内容。满足以下条件时返回


* 请求参数`show_utterances`设置为`true`

* 识别成功



**start_time ** `int`

起始时间（毫秒）



**end_time ** `int`

结束时间（毫秒）










---

## 录音文件识别闲时版 - 任务提交 HTTP

> 文档ID: 2608618 | URL: https://www.volcengine.com/docs/6561/2608618 | 标题: 任务提交-HTTP | MDContent长度: 7508

本接口提供语音转文本能力，专为批量、非实时场景设计，利用闲时算力执行识别任务；上传文件需小于 512 MB, 时长不超过 5 小时，支持 raw、wav、mp3、ogg 等格式；上传后可通过查询接口获取识别结果，结果在24h内返回。

&nbsp;

<span data-label="purple">POST</span> https://openspeech.bytedance.com/api/v3/auc/bigmodel/idle/submit

&nbsp;


<span id="ULAS3Id9"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|1RbFw3">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

请求的模型版本，可选值：`volc.bigasr.auc_idle`



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

用于提交和查询任务的任务ID，推荐传入随机生成的UUID



**X\-Api\-Sequence ** `string` <span data-api-tag="require|W2vM70">必选</span>

发包序号，固定值: `-1`




<span id="OG7QrhRG"></span>
### 请求体


**audio ** `dict` <span data-api-tag="require|WnVo1B">必选</span>


**url ** `string` <span data-api-tag="require|1zS7c2">必选</span>

音频链接



**language ** `string`

指定识别语种。

当前支持识别以下语种


* 中文普通话：`zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语：`ar-SA`

* 意大利语：`it-IT`

* 孟加拉语：`bn-BD`

* 希腊语：`el-GR`

* 荷兰语：`nl-NL`

* 俄语：`ru-RU`

* 土耳其语：`tr-TR`

* 越南语：`vi-VN`

* 波兰语：`pl-PL`

* 罗马尼亚语：`ro-R0`

* 尼泊尔语：`ne-NP`

* 乌克兰语：`uk-UA`

* 粤语：`yue-CN`


注意：

当 `language` 参数为空时，模型支持识别以下语种：中文、英文、上海话、闽南话、四川话、陕西话、粤语



**format ** `string` <span data-api-tag="require|7sHXWE">必选</span>

音频格式。

可选值：`raw` / `wav` / mp3 / ogg / pcm / spx / amr / aac / m4a



**codec** `string`

音频编码格式。默认raw（pcm）

可选值：`raw` / `opus`



**rate** `int`

音频采样率。默认值为 `16000`



**bits** `int`

音频采样点位数。默认支持16bits



**channel** `int`

音频声道数，默认值为 `1`

可选值：

`1`:mono

`2`:stereo




**request** `object`


**model_name** `string` <span data-api-tag="require|tXLKeG">必选</span>

模型名称。目前仅支持 `bigmodel`


&nbsp;


**enable_itn** `bool`

是否将语音识别结果转换为规范的书面格式，默认为`true`。

开启后，系统会把语音里的口语化数字、金额、日期等自动转成阿拉伯数字和符号形式，让文本更简洁、更易读。

效果示例:


* "一九七零年" → "1970 年"

* "一百二十三美元" → "$123"



**enable_punc** `bool`

是否启用标点，默认值为`false`。

开启后，识别结果会自动添加逗号、句号、问号等标点符号，提升文本可读性



**enable_ddc** `bool`

是否启用语义顺滑，默认 `false`。

开启后，系统会删除或修正识别结果中的停顿词、语气词、语义重复词等不流畅内容，让文本更连贯、更易读。



**enable_channel_split** `bool`

是否启用双声道识别，默认 `false`。

开启后，返回结果会用 `channel_id` 标记声道

`1` :左声道

`2` :右声道



**show_utterances** `bool`

是否输出分句、分词及语音停顿信息，默认 `false`。



**show_speech_rate** `bool`

分句信息是否携带语速，默认 `false`。开启后，会在分句 `additions` 中返回语速信息，单位为 token/s。



**show_volume** `bool`

分句信息是否携带音量，默认 `false`。开启后，会在分句 `additions` 中返回音量信息，单位为分贝。



**enable_auto_lang** `bool`

是否自动识别语种，默认 `false`。开启后，系统会自动检测音频所属语种。

支持自动识别以下语种：


* 中文普通话 `zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语 `ar-SA`

* 意大利语 `it-IT`

* 孟加拉语 `bn-BD`

* 希腊语 `el-GR`

* 荷兰语 `nl-NL`

* 俄语 `ru-RU`

* 土耳其语 `tr-TR`

* 越南语 `vi-VN`

* 波兰语 `pl-PL`

* 罗马尼亚语 `ro-RO`

* 尼泊尔语 `ne-NP`

* 乌克兰语 `uk-UA`

* 粤语 `yue-CN`



**enable_lid** `bool`

是否启用中英文及方言识别，默认 `false`。

支持识别以下语言：中文、英文、上海话、闽南话、四川话、陕西话、粤语

开启后，会在 `additions` 中返回语种/场景标签，取值如下：


* `singing_en`：英文唱歌

* `singing_mand`：普通话唱歌

* `singing_dia_cant`：粤语唱歌

* `speech_en`：英文说话

* `speech_mand`：普通话说话

* `speech_dia_nan`：闽南语

* `speech_dia_wuu`：吴语（含上海话）

* `speech_dia_cant`：粤语说话

* `speech_dia_xina`：西南官话（含四川话）

* `speech_dia_zgyu`：中原官话（含陕西话）

* `other_langs`：其它语种（其它语种人声）

* `others`：检测不出（非语义人声和非人声）

* 返回为空则代表无法判断（例如传入音频过短等）



**enable_emotion_detection** `bool`

启用情绪检测。如果设为`True`，则会在分句`additions`中返回对应的情绪标签。默认 `False`

支持的情绪标签包括：


* `angry`：表示情绪为生气

* `happy`：表示情绪为开心

* `neutral`：表示情绪为平静或中性

* `sad`：表示情绪为悲伤

* `surprise`：表示情绪为惊讶



**enable_gender_detection** `bool`

启用性别检测。如果设为`True`，则会在分句`additions`中返回性别标签（male/female），默认 `False`



**vad_segment** `bool`

语义分句（VAD分句），默认为`false`

注意：当`enable_channel_split`设置为`true`时，建议同时使用语义分句



**end_window_size** `int`

语音活动检测 (VAD) 的静音判停阈值，单位 ms。当检测到的连续静音时长达到该值时，判定一句话结束并触发分句。

范围：`[300,5000]` 

推荐值：`[800,1000]`



**sensitive_words_filter** `string`

是否开启敏感词过滤功能。开启后，可对识别结果中的敏感词做屏蔽或替换处理。

示例

```Bash
"sensitive_words_filter":{\"system_reserved_filter\":true,\"filter_with_empty\":[\"敏感词\"],\"filter_with_signed\":[\"敏感词\"]}"
```



**system_reserved_filter ** `bool`

是否启用系统内置敏感词库。启用后，命中的系统敏感词会被替换为 `*`



**filter_with_empty ** `string`

需替换为空字符串的自定义敏感词列表



**filter_with_signed ** `string`

需替换为 `*` 的自定义敏感词列表




**enable_poi_fc** `bool`

开启 POI function call。能调用专业的地图领域推荐词服务辅助识别，提高识别准确率。

示例：

```SQL
"request": {
    "enable_poi_fc": true,
    "corpus": {
        "context": "{\"loc_info\":{\"city_name\":\"北京市\"}}"
    }
}
```




**enable_music_fc** `bool`

对于语音识别困难的词语，能调用专业的音领域推荐词服务辅助识别



**corpus** `object`

语境词典。可自定义配置热词、替换词，配置后可提高特定语境下的词语识别准确率


**boosting_table_name ** `string`

热词词表名称。配置热词可优化该类词语的识别效果

热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中设置



**boosting_table_id ** `string`

热词词表id。配置热词可优化该类词语的识别效果


* 热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中设置

* 若传入的`boosting_table_name`和`boosting_table_id`对应的热词词表不一致，则以`boosting_table_id`为准



**correct_table_name ** `string`

替换词词表名称。配置替换词，可将模型识别出的特定词汇替换为目标词汇

替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**correct_table_id ** `string`

替换词词表名称。配置替换词，可将模型识别出的特定词汇替换为目标词汇


* 替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置

* 若传入的`correct_table_name`和`correct_table_id`对应的热词词表不一致，则以`correct_table_id`为准



**regex_correct_table_name**`string`

正则替换词表名称。相较于替换词的精确匹配替换，正则替换词适合批量格式转换（如日期格式统一、符号标准化）、模糊模式匹配等复杂场景


* 正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**regex_correct_table_id ** `string`

正则替换词表id。


* 正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**context ** `string`

上下文功能。在识别前传入辅助信息，帮助模型更准确地识别。支持热词直传、传入对话历史、场景等信息辅助理解用法，可查询[热词与上下文](https://docs.volcengine.com/docs/6561/2604976?lang=zh)最佳实践了解更多信息

示例：

```Python
{
  "corpus": {
    "context": {
      "hotwords": [
        { "word": "豆包" },
        { "word": "火山引擎" },
        { "word": "奥迪A4L" }
      ],
      "context_type": "dialog_ctx",
      "context_data": [
        { "text": "最近一轮助手的回答" },
        { "text": "最近一轮用户的提问" },
        { "text": "更早一轮助手的回答" },
        { "text": "更早一轮用户的提问" }
      ]
    }
  }
}
```



**hotwords ** `string`

热词列表直传，用于提升指定词汇的识别准确率。可查询[热词与上下文](https://docs.volcengine.com/docs/6561/2604976?lang=zh)最佳实践了解更多信息


**word** `string`

热词内容




**context_type** `string`

上下文类型，目前仅支持`dialog_ctx`



**context_data** `object`

上下文数据列表，用于传入历史对话等语境信息，需要和`context_type`一起使用


**text ** `string`

历史对话文本，帮助模型理解语境，提升识别准确率



**image_url ** `string`

图片 URL，用于提供视觉上下文，辅助理解语音内容







**callback  ** `string`

回调地址。

示例：

```Python
"callback": "http://xxx"
```




**callback_data** `string`

回调信息。

```Python
"callback_data":"$Request-Id"
```





<span id="pF6mxalL"></span>
### 响应


**task_id ** `string`

任务 ID，可通过该 ID 调用识别结果查询接口获取识别结果



**X\-Tt\-Logid ** `string`

服务端返回的 logid，方便定位问题



**X\-Api\-Status\-Code ** `string`

提交任务后服务端返回的状态码



**X\-Api\-Message ** `string`

提交任务后服务端返回的信息，`OK` 表示成功，其他值表示失败








---

## 录音文件识别闲时版 - 结果查询 HTTP

> 文档ID: 2608619 | URL: https://www.volcengine.com/docs/6561/2608619 | 标题: 结果查询-HTTP | MDContent长度: 1308

通过task_id查询录音文件识别标准版接口的识别结果；

**本接口请求体为空json**

&nbsp;

<span data-label="purple">POST</span> https://openspeech.bytedance.com/api/v3/auc/bigmodel/idle/query

&nbsp;


<span id="U2dCXzkM"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|g9zFYw">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|g9zFYw">必选</span>

请求的模型版本，可选值：`volc.bigasr.auc_idle`



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|g9zFYw">必选</span>

传入录音文件识别\-闲时版接口返回的`task_id`




<span id="WtD1SAXn"></span>
### 响应


**X\-Tt\-Logid ** `string`

服务端返回的 logid，方便定位问题



**X\-Api\-Status\-Code ** `string`

提交任务后服务端返回的状态码



**X\-Api\-Message ** `string`

提交任务后服务端返回的信息，OK 表示成功，其他值表示失败



**result** `list`

识别结果，识别成功后返回


**text ** `string`

音频识别结果文本，识别成功后返回



**utterances ** `string`

语音分句信息。满足以下条件时返回


* 请求参数`show_utterances`设置为`true`

* 识别成功


&nbsp;


**text ** `string`

语音文本内容。满足以下条件时返回


* 请求参数`show_utterances`设置为`true`

* 识别成功



**start_time ** `int`

起始时间（毫秒）



**end_time ** `int`

结束时间（毫秒）










---

## 录音文件识别极速版 HTTP

> 文档ID: 2608628 | URL: https://www.volcengine.com/docs/6561/2608628 | 标题: 录音文件识别极速版HTTP | MDContent长度: 7015

本接口提供录音文件转文本能力。上传音频后可直接返回识别结果，无需调用接口查询。支持时长不超过 2 小时、大小不超过 100MB 的 WAV / MP3 / OGG OPUS 文件。

&nbsp;

<span data-label="purple">POST</span> https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash

&nbsp;


<span id="ULAS3Id9"></span>
### 请求头


**X\-Api\-Key ** `string` <span data-api-tag="require|1RbFw3">必选</span>

API Key 可以从 [控制台>API Key管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default.) 获取

注意：


* 本接口同时支持[旧版控制台](https://console.volcengine.com/speech/service/10035)的鉴权方式，详见[旧版控制台鉴权参考](https://www.volcengine.com/docs/6561/2534847?lang=zh)



**X\-Api\-Resource\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

请求的模型版本，可选值：`volc.bigasr.auc_turbo`



**X\-Api\-Request\-Id ** `string` <span data-api-tag="require|W2vM70">必选</span>

用于提交和查询任务的任务ID，推荐传入随机生成的UUID



**X\-Api\-Sequence ** `string` <span data-api-tag="require|W2vM70">必选</span>

发包序号，固定值: `-1`




<span id="OG7QrhRG"></span>
### 请求体


**audio ** `dict` <span data-api-tag="require|WnVo1B">必选</span>


**url ** `string` <span data-api-tag="require|1zS7c2">必选</span>

音频链接



**language ** `string`

指定识别语种。

当前支持识别以下语种


* 中文普通话：`zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语：`ar-SA`

* 意大利语：`it-IT`

* 孟加拉语：`bn-BD`

* 希腊语：`el-GR`

* 荷兰语：`nl-NL`

* 俄语：`ru-RU`

* 土耳其语：`tr-TR`

* 越南语：`vi-VN`

* 波兰语：`pl-PL`

* 罗马尼亚语：`ro-R0`

* 尼泊尔语：`ne-NP`

* 乌克兰语：`uk-UA`

* 粤语：`yue-CN`


注意：

当 `language` 参数为空时，模型支持识别以下语种：中文、英文、上海话、闽南话、四川话、陕西话、粤语



**format ** `string` <span data-api-tag="require|7sHXWE">必选</span>

音频格式。

可选值：`raw` / `wav` / mp3 / ogg / pcm / spx / amr / aac / m4a



**codec** `string`

音频编码格式。默认raw（pcm）

可选值：`raw` / `opus`



**rate** `int`

音频采样率。默认值为 `16000`



**bits** `int`

音频采样点位数。默认支持16bits



**channel** `int`

音频声道数，默认值为 `1`

可选值：

`1`:mono

`2`:stereo




**request** `object`


**model_name** `string` <span data-api-tag="require|tXLKeG">必选</span>

模型名称。目前仅支持 `bigmodel`


&nbsp;


**enable_itn** `bool`

是否将语音识别结果转换为规范的书面格式，默认为`true`。

开启后，系统会把语音里的口语化数字、金额、日期等自动转成阿拉伯数字和符号形式，让文本更简洁、更易读。

效果示例:


* "一九七零年" → "1970 年"

* "一百二十三美元" → "$123"



**enable_punc** `bool`

是否启用标点，默认值为`false`。

开启后，识别结果会自动添加逗号、句号、问号等标点符号，提升文本可读性



**enable_ddc** `bool`

是否启用语义顺滑，默认 `false`。

开启后，系统会删除或修正识别结果中的停顿词、语气词、语义重复词等不流畅内容，让文本更连贯、更易读。



**enable_channel_split** `bool`

是否启用双声道识别，默认 `false`。

开启后，返回结果会用 `channel_id` 标记声道

`1` :左声道

`2` :右声道



**show_utterances** `bool`

是否输出分句、分词及语音停顿信息，默认 `false`。


&nbsp;


**enable_auto_lang** `bool`

是否自动识别语种，默认 `false`。开启后，系统会自动检测音频所属语种。

支持自动识别以下语种：


* 中文普通话 `zh-CN`

* 英语：`en-US`

* 日语：`ja-JP`

* 印尼语：`id-ID`

* 西班牙语：`es-MX`

* 葡萄牙语：`pt-BR`

* 德语：`de-DE`

* 法语：`fr-FR`

* 韩语：`ko-KR`

* 菲律宾语：`fil-PH`

* 马来语：`ms-MY`

* 泰语：`th-TH`

* 阿拉伯语 `ar-SA`

* 意大利语 `it-IT`

* 孟加拉语 `bn-BD`

* 希腊语 `el-GR`

* 荷兰语 `nl-NL`

* 俄语 `ru-RU`

* 土耳其语 `tr-TR`

* 越南语 `vi-VN`

* 波兰语 `pl-PL`

* 罗马尼亚语 `ro-RO`

* 尼泊尔语 `ne-NP`

* 乌克兰语 `uk-UA`

* 粤语 `yue-CN`



**enable_lid** `bool`

是否启用中英文及方言识别，默认 `false`。

支持识别以下语言：中文、英文、上海话、闽南话、四川话、陕西话、粤语

开启后，会在 `additions` 中返回语种/场景标签，取值如下：


* `singing_en`：英文唱歌

* `singing_mand`：普通话唱歌

* `singing_dia_cant`：粤语唱歌

* `speech_en`：英文说话

* `speech_mand`：普通话说话

* `speech_dia_nan`：闽南语

* `speech_dia_wuu`：吴语（含上海话）

* `speech_dia_cant`：粤语说话

* `speech_dia_xina`：西南官话（含四川话）

* `speech_dia_zgyu`：中原官话（含陕西话）

* `other_langs`：其它语种（其它语种人声）

* `others`：检测不出（非语义人声和非人声）

* 返回为空则代表无法判断（例如传入音频过短等）


&nbsp;


**vad_segment** `bool`

语义分句（VAD分句），默认为`false`

注意：当`enable_channel_split`设置为`true`时，建议同时使用语义分句



**end_window_size** `int`

语音活动检测 (VAD) 的静音判停阈值，单位 ms。当检测到的连续静音时长达到该值时，判定一句话结束并触发分句。

范围：`[300,5000]` 

推荐值：`[800,1000]`



**sensitive_words_filter** `string`

是否开启敏感词过滤功能。开启后，可对识别结果中的敏感词做屏蔽或替换处理。

示例

```Bash
"sensitive_words_filter":{\"system_reserved_filter\":true,\"filter_with_empty\":[\"敏感词\"],\"filter_with_signed\":[\"敏感词\"]}"
```



**system_reserved_filter ** `bool`

是否启用系统内置敏感词库。启用后，命中的系统敏感词会被替换为 `*`



**filter_with_empty ** `string`

需替换为空字符串的自定义敏感词列表



**filter_with_signed ** `string`

需替换为 `*` 的自定义敏感词列表




**enable_poi_fc** `bool`

开启 POI function call。能调用专业的地图领域推荐词服务辅助识别，提高识别准确率。

示例：

```SQL
"request": {
    "enable_poi_fc": true,
    "corpus": {
        "context": "{\"loc_info\":{\"city_name\":\"北京市\"}}"
    }
}
```




**enable_music_fc** `bool`

对于语音识别困难的词语，能调用专业的音领域推荐词服务辅助识别



**corpus** `object`

语境词典。可自定义配置热词、替换词，配置后可提高特定语境下的词语识别准确率


**boosting_table_name ** `string`

热词词表名称。配置热词可优化该类词语的识别效果

热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中设置



**boosting_table_id ** `string`

热词词表id。配置热词可优化该类词语的识别效果


* 热词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/hot-word?projectName=default)中设置

* 若传入的`boosting_table_name`和`boosting_table_id`对应的热词词表不一致，则以`boosting_table_id`为准



**correct_table_name ** `string`

替换词词表名称。配置替换词，可将模型识别出的特定词汇替换为目标词汇

替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**correct_table_id ** `string`

替换词词表名称。配置替换词，可将模型识别出的特定词汇替换为目标词汇


* 替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置

* 若传入的`correct_table_name`和`correct_table_id`对应的热词词表不一致，则以`correct_table_id`为准



**regex_correct_table_name**`string`

正则替换词表名称。相较于替换词的精确匹配替换，正则替换词适合批量格式转换（如日期格式统一、符号标准化）、模糊模式匹配等复杂场景


* 正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**regex_correct_table_id ** `string`

正则替换词表id。


* 正则替换词可在[控制台>自学习平台](https://console.volcengine.com/speech/new/correct-word?projectName=default)中配置



**context ** `string`

上下文功能。在识别前传入辅助信息，帮助模型更准确地识别。支持热词直传、传入对话历史、场景等信息辅助理解用法，可查询[热词与上下文](https://docs.volcengine.com/docs/6561/2604976?lang=zh)最佳实践了解更多信息

示例：

```Python
{
  "corpus": {
    "context": {
      "hotwords": [
        { "word": "豆包" },
        { "word": "火山引擎" },
        { "word": "奥迪A4L" }
      ],
      "context_type": "dialog_ctx",
      "context_data": [
        { "text": "最近一轮助手的回答" },
        { "text": "最近一轮用户的提问" },
        { "text": "更早一轮助手的回答" },
        { "text": "更早一轮用户的提问" }
      ]
    }
  }
}
```



**hotwords ** `string`

热词列表直传，用于提升指定词汇的识别准确率。可查询[热词与上下文](https://docs.volcengine.com/docs/6561/2604976?lang=zh)最佳实践了解更多信息


**word** `string`

热词内容




**context_type** `string`

上下文类型，目前仅支持`dialog_ctx`



**context_data** `object`

上下文数据列表，用于传入历史对话等语境信息，需要和`context_type`一起使用


**text ** `string`

历史对话文本，帮助模型理解语境，提升识别准确率



**image_url ** `string`

图片 URL，用于提供视觉上下文，辅助理解语音内容







**callback  ** `string`

回调地址。

示例：

```Python
"callback": "http://xxx"
```




**callback_data** `string`

回调信息。

```Python
"callback_data":"$Request-Id"
```





<span id="pF6mxalL"></span>
### 响应


**task_id ** `string`

任务 ID，可通过该 ID 调用识别结果查询接口获取识别结果



**X\-Tt\-Logid ** `string`

服务端返回的 logid，方便定位问题



**X\-Api\-Status\-Code ** `string`

提交任务后服务端返回的状态码



**X\-Api\-Message ** `string`

提交任务后服务端返回的信息，`OK` 表示成功，其他值表示失败



&nbsp;






---

## 错误码查询

> 文档ID: 2611432 | URL: https://www.volcengine.com/docs/6561/2611432 | 标题: 错误码查询 | MDContent长度: 1251

本文档汇总语音合成接口常见错误码及对应解决方案，帮助开发者快速排查并解决调用问题。

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="tip">如需反馈问题，请提供响应中的Logid，以便我们排查与定位问题。</div>


<span id="yK6gG9dr"></span>
# 录音文件识别标准版HTTP接口错误码


|**错误码** |**含义** |**说明** |
|---|---|---|
|20000000 |成功 | |
|20000001 |正在处理中 | |
|20000002 |任务在队列中 | |
|20000003 |静音音频 |没有检测到人声 |
|45000001 |请求参数无效 |请求参数缺失必需字段 / 字段值无效 / 重复请求。 |
|45000002 |空音频 | |
|45000131 |超过半小时提交的音频长度上限 |超过了半小时允许提交的音频长度上限（默认半小时最多提交500小时），需要降低提交任务的速度 |
|45000132 |超过音频大小限制 |上传的音频超过大小限制（<512M） |
|45000151 |音频格式不正确 | |
|550xxxx |服务内部处理错误 | |
|55000031 |服务器繁忙 |服务过载，无法处理当前请求。 |


<span id="haZNg6ZE"></span>
# 录音文件识别闲时版HTTP接口错误码


|**错误码** |**含义** |**说明** |
|---|---|---|
|20000000 |成功 | |
|20000001 |正在处理中 | |
|20000002 |任务在队列中 | |
|20000003 |静音音频 | |
|45000001 |请求参数无效 |请求参数缺失必需字段 / 字段值无效 / 重复请求。 |
|45000002 |空音频 | |
|45000151 |音频格式不正确 | |
|550xxxx |服务内部处理错误 | |
|55000031 |服务器繁忙 |服务过载，无法处理当前请求。 |


<span id="FBsTvSRA"></span>
# 录音文件识别极速版HTTP接口错误码


|**错误码** |**含义** |**说明** |
|---|---|---|
|20000000 |成功 | |
|20000003 |静音音频 | |
|45000001 |请求参数无效 |请求参数缺失必需字段 / 字段值无效 |
|45000002 |空音频 | |
|45000151 |音频格式不正确 | |
|550XXXX |服务内部处理错误 | |
|55000031 |服务器繁忙 |服务过载，无法处理当前请求。 |





