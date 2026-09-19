import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Work 的多媒体能力用「能力注册表 + 平台适配器 + Media Model Manifest」三层实现： Provider
      Profile 声明它支持哪些能力，适配器负责平台协议，manifest 负责单个模型的参数与
      产物提取。图片、语音、视频共用同一套代码路径，画布、<code>spark_media</code> MCP 与 Provider
      表单读的是同一份元数据。
    </p>

    <h2 id="capabilities">1. 能力枚举与适配器</h2>
    <p>
      统一能力 id 共 <strong>11 个</strong>（不是 9 个），定义在{' '}
      <code>packages/protocol/src/media-config.ts</code> 的 <code>MEDIA_CAPABILITY_IDS</code>。
      括号里是 Provider 表单上的中文标签（<code>providerMediaConfig.ts</code> 的{' '}
      <code>MEDIA_CAPABILITY_LABELS</code>）。
    </p>
    <table>
      <thead>
        <tr>
          <th>能力 id</th>
          <th>界面标签</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>image.generate</code>
          </td>
          <td>生图</td>
          <td>文生图</td>
        </tr>
        <tr>
          <td>
            <code>image.edit</code>
          </td>
          <td>图生图 / 图片编辑</td>
          <td>含多图合成</td>
        </tr>
        <tr>
          <td>
            <code>image.variations</code>
          </td>
          <td>图片变体</td>
          <td>目前只有 Midjourney manifest 声明</td>
        </tr>
        <tr>
          <td>
            <code>audio.speech</code>
          </td>
          <td>语音合成</td>
          <td>TTS</td>
        </tr>
        <tr>
          <td>
            <code>audio.music</code>
          </td>
          <td>音乐生成</td>
          <td>Lyria / MiniMax 音乐 / 火山豆包音频生成</td>
        </tr>
        <tr>
          <td>
            <code>audio.transcription</code>
          </td>
          <td>语音转写</td>
          <td>ASR，如 APIMart Whisper</td>
        </tr>
        <tr>
          <td>
            <code>video.generate</code>
          </td>
          <td>文生视频</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>video.image_to_video</code>
          </td>
          <td>图生视频</td>
          <td>首帧驱动</td>
        </tr>
        <tr>
          <td>
            <code>video.reference_to_video</code>
          </td>
          <td>参考图生视频</td>
          <td>参考图（非首帧）驱动</td>
        </tr>
        <tr>
          <td>
            <code>video.edit</code>
          </td>
          <td>视频编辑</td>
          <td>按 prompt 改已有视频</td>
        </tr>
        <tr>
          <td>
            <code>video.extend</code>
          </td>
          <td>视频扩展</td>
          <td>从末帧续拍</td>
        </tr>
      </tbody>
    </table>

    <h3 id="provider-kinds">1.1 平台适配器枚举</h3>
    <p>
      <code>mediaProvider</code> 的合法值共 <strong>18 个</strong>（
      <code>MEDIA_PROVIDER_KINDS</code>）。 Provider
      表单里的「平台适配器」下拉不是全量枚举，而是按模型类型裁剪： 生图 / 视频模型给 9 项，其余给 15
      项。
    </p>
    <table>
      <thead>
        <tr>
          <th>mediaProvider</th>
          <th>表单标签</th>
          <th>协议实现</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>apimart</code>
          </td>
          <td>APIMart</td>
          <td>
            专用适配器 <code>ApimartMediaAdapter</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>agnes</code>
          </td>
          <td>Agnes AI</td>
          <td>
            专用适配器 <code>AgnesMediaAdapter</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>xai</code>
          </td>
          <td>xAI</td>
          <td>
            专用适配器 <code>XaiMediaAdapter</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>openai-images</code>
          </td>
          <td>OpenAI 多媒体</td>
          <td>
            专用适配器 <code>OpenAiOfficialMediaAdapter</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>openai-compatible</code>
          </td>
          <td>OpenAI Compatible</td>
          <td>走 manifest 驱动的模板适配器</td>
        </tr>
        <tr>
          <td>
            <code>google-generative-ai</code>
          </td>
          <td>Google Gemini / Veo / Lyria</td>
          <td>
            专用适配器（含 <code>:predict</code> / <code>:predictLongRunning</code> /{' '}
            <code>/interactions</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>omni</code>
          </td>
          <td>Omni</td>
          <td>复用 Google 适配器，走 Omni 专用端点</td>
        </tr>
        <tr>
          <td>
            <code>bailian</code>
          </td>
          <td>阿里百炼</td>
          <td>
            专用适配器 <code>BailianMediaAdapter</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>volcengine-ark</code>
          </td>
          <td>火山方舟 / Seedance</td>
          <td>
            专用适配器（<code>content[]</code> 嵌套请求体）
          </td>
        </tr>
        <tr>
          <td>
            <code>volcengine-speech</code>
          </td>
          <td>火山豆包语音</td>
          <td>
            专用适配器（<code>X-Api-Key</code> 鉴权，区别于方舟的 Bearer）
          </td>
        </tr>
        <tr>
          <td>
            <code>kling</code>
          </td>
          <td>Kling</td>
          <td>6 个内置 manifest，走模板适配器</td>
        </tr>
        <tr>
          <td>
            <code>minimax-hailuo</code>
          </td>
          <td>MiniMax Hailuo</td>
          <td>
            专用适配器（v1 恒 200 + <code>base_resp</code>、V2 OAI 协议）
          </td>
        </tr>
        <tr>
          <td>
            <code>midjourney</code>
          </td>
          <td>Midjourney 网关</td>
          <td>
            专用适配器 <code>MidjourneyMediaAdapter</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>tencent-tokenhub</code>
          </td>
          <td>腾讯云 TokenHub</td>
          <td>专用适配器（查询是 POST + body）</td>
        </tr>
        <tr>
          <td>
            <code>custom</code>
          </td>
          <td>自定义</td>
          <td>模板适配器 + 自定义 manifest</td>
        </tr>
        <tr>
          <td>
            <code>pixverse</code> / <code>wan</code> / <code>happyhorse</code>
          </td>
          <td>PixVerse / Wan / HappyHorse</td>
          <td>
            枚举里有值、有中文标签，但<strong>不在表单下拉里</strong>，也没有独立 manifest
            种子；对应模型挂在 APIMart 下（如 <code>pixverse-v6</code>、
            <code>happyhorse-1.0/1.1</code>、<code>wan2.7-image</code>）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      适配器注册是显式的：<code>MediaRouterService</code> 构造函数里 <code>register()</code> 了 12
      个实例（含 Google 适配器注册两次，分别对应 <code>google-generative-ai</code> 与{' '}
      <code>omni</code>）。路由时先看有没有专用适配器且它声明支持该能力，否则改用 manifest
      驱动的模板适配器；两者都没有时抛{' '}
      <code>provider_not_configured: No adapter for provider kind ...</code>。
    </p>
    <p>
      <code>openai-compatible</code> 没有注册为独立适配器（
      <code>openai-compatible-media.adapter.ts</code> 是其他适配器的基类），所以这一类渠道必须绑定
      manifest 才能调用。
    </p>

    <h2 id="manifest">2. Media Model Manifest</h2>
    <p>
      Manifest 是「模型元数据单一来源」：类型与 zod schema 在{' '}
      <code>packages/protocol/src/media-model-manifest.ts</code>，内置种子共 <strong>167 条</strong>
      ，覆盖 13 个 <code>providerKind</code>。
    </p>
    <table>
      <thead>
        <tr>
          <th>providerKind</th>
          <th>内置 manifest 数</th>
          <th>种子来源</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>apimart</code>
          </td>
          <td>59</td>
          <td>
            <code>media-model-manifest.ts</code> 内的 APIMart 模型表
          </td>
        </tr>
        <tr>
          <td>
            <code>bailian</code>
          </td>
          <td>22</td>
          <td>
            <code>bailian-media-model-manifests.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>tencent-tokenhub</code>
          </td>
          <td>21</td>
          <td>
            <code>tencent-tokenhub-media-model-manifests.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>google-generative-ai</code>
          </td>
          <td>13</td>
          <td>
            <code>google-media-model-manifests.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>openai-images</code>
          </td>
          <td>12</td>
          <td>
            <code>openai-media-model-manifests.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>volcengine-ark</code>
          </td>
          <td>12</td>
          <td>
            <code>volcengine-ark-media-model-manifests.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>minimax-hailuo</code>
          </td>
          <td>9</td>
          <td>
            <code>media-model-manifest.ts</code> + 共享片段
          </td>
        </tr>
        <tr>
          <td>
            <code>xai</code>
          </td>
          <td>6</td>
          <td>
            <code>xai-media-model-manifests.ts</code>（视频 1.5）+ 主文件
          </td>
        </tr>
        <tr>
          <td>
            <code>kling</code>
          </td>
          <td>6</td>
          <td>
            <code>media-model-manifest.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>agnes</code>
          </td>
          <td>3</td>
          <td>
            <code>media-model-manifest.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>volcengine-speech</code>
          </td>
          <td>2</td>
          <td>
            <code>volcengine-speech-media-model-manifests.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>omni</code> / <code>midjourney</code>
          </td>
          <td>各 1</td>
          <td>
            <code>omni-media-model-manifests.ts</code> / <code>media-model-manifest.ts</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>一条 manifest 的关键字段：</p>
    <ul>
      <li>
        <code>id</code> / <code>providerKind</code> / <code>modelId</code> /{' '}
        <code>displayName</code> / <code>domains</code>（image / audio / video / text …）。
      </li>
      <li>
        <code>capabilities[]</code>：每条含 <code>id</code>、<code>label</code>、
        <code>input.required</code>、<code>input.maxImages</code>、<code>output.types</code>、
        <code>paramSchema</code>、<code>defaults</code>、<code>aliases</code>。
      </li>
      <li>
        <code>invocation</code>：<code>mode</code>（<code>sync</code> / <code>async_polling</code> /{' '}
        <code>async_callback</code> / <code>stream</code> / <code>file_job</code>）、
        <code>endpoint</code>、<code>method</code>、<code>contentType</code>（json / multipart /
        binary）、<code>requestTemplate</code>、<code>response</code>、<code>polling</code>。
      </li>
      <li>
        <code>docs.sourceUrls</code> + <code>lastCheckedAt</code>
        ：记录参数是照着哪份官方文档核对的。
      </li>
      <li>
        <code>safety</code>：<code>maxPromptLength</code>、<code>allowLocalFiles</code>、
        <code>maxInputBytes</code>。
      </li>
    </ul>
    <p>
      Contract V2 增补了 <code>contractVersion: 2</code>、<code>adapterMode</code>（
      <code>native</code> / <code>template</code>）与 <code>baseTemplate</code>；后者在 Provider
      表单的「配置自定义适配器」里有 4 个基底可选：完全自定义、OpenAI 接口协议基底、通用异步 JSON
      任务（GET 轮询）、ToApis 图片全能力异步轮询。
    </p>
    <p>
      持久化用两张表：<code>media_model_manifests</code>（manifest 本体）与{' '}
      <code>media_provider_models</code>（某个 Provider 启用了哪些 manifest、本地默认参数覆盖）， 见{' '}
      <code>packages/storage/migrations/033_media_model_manifests.sql</code>。启动时由{' '}
      <code>MediaModelCatalogService.seedBuiltinManifests()</code> 把内置种子写回 SQLite。
    </p>

    <h2 id="config">3. 配置步骤（真实界面）</h2>
    <ol>
      <li>
        打开 <strong>设置 → Provider</strong>，点「新建」（或「新增配置」）打开编辑面板。
      </li>
      <li>
        <strong>模型类型</strong>选 4 项之一：<strong>对话模型</strong> / <strong>生图模型</strong>{' '}
        / <strong>语音模型</strong> / <strong>视频模型</strong>
        。对话模型属于附加能力场景，需要额外打开 <strong>附加生成能力</strong>
        开关才会出现多媒体面板。
      </li>
      <li>选模板预设（如 APIMart、xAI、火山方舟），会预填 Base URL、默认模型、能力与轮询参数。</li>
      <li>
        在多媒体面板里确认三件事：
        <ul>
          <li>
            <strong>平台适配器</strong>：图片 / 视频模型从 9 个里选，其余从 15 个里选。
          </li>
          <li>
            <strong>支持能力</strong>：勾选本 Provider
            真实支持的能力，别多勾——路由和调用方式都按它判断。
          </li>
          <li>
            <strong>调用方式</strong>：<code>sync</code> / <code>async</code> / <code>auto</code>。
          </li>
        </ul>
      </li>
      <li>
        <strong>模型清单</strong>里从内置目录勾选要启用的 manifest；自定义渠道可以手输模型 ID 并按
        Enter 添加。
      </li>
      <li>
        <strong>参数默认值</strong>填 size / 比例 / 质量 / 时长等；异步渠道再填{' '}
        <strong>轮询间隔 ms</strong> 与 <strong>接口超时 ms</strong>。
      </li>
      <li>
        填 API Key 保存。表单下方会给出「实际请求地址」预览，确认适配器拼出的 URL 与渠道文档一致。
      </li>
    </ol>
    <p>
      注意：<strong>「测试连接」不是媒体链路验证</strong>。它发的是文本协议 ping （OpenAI 兼容走{' '}
      <code>/chat/completions</code>，Anthropic 走 messages），纯图片 / 视频渠道 常常没有 chat
      端点，因此测试失败不代表媒体不可用；反过来测试通过也不代表生图能跑通。请以 「实际请求地址」+
      一次真实生成为准。
    </p>

    <h2 id="presets">4. 内置预设清单</h2>
    <p>
      当前共 64 个 Provider 预设，其中 <strong>35 个</strong>带多媒体配置。下表为真实 id 与默认模型
      （预设定义在 <code>packages/protocol/src/provider-presets.ts</code>）。
    </p>
    <table>
      <thead>
        <tr>
          <th>预设 id</th>
          <th>名称</th>
          <th>类型</th>
          <th>mediaProvider / 调用方式</th>
          <th>默认模型</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>openai-images</code>
          </td>
          <td>OpenAI</td>
          <td>image</td>
          <td>
            <code>openai-images</code> / auto
          </td>
          <td>gpt-image-2</td>
        </tr>
        <tr>
          <td>
            <code>openai-sora-video</code>
          </td>
          <td>OpenAI</td>
          <td>video</td>
          <td>
            <code>openai-images</code> / async
          </td>
          <td>sora-2</td>
        </tr>
        <tr>
          <td>
            <code>agnes-ai</code>
          </td>
          <td>Agnes AI</td>
          <td>multimodal</td>
          <td>
            <code>agnes</code> / auto
          </td>
          <td>agnes-2.0-flash</td>
        </tr>
        <tr>
          <td>
            <code>apimart-images</code>
          </td>
          <td>APIMart</td>
          <td>image</td>
          <td>
            <code>apimart</code> / auto
          </td>
          <td>gpt-image-2</td>
        </tr>
        <tr>
          <td>
            <code>apimart-audio-whisper</code>
          </td>
          <td>APIMart Whisper</td>
          <td>voice</td>
          <td>
            <code>apimart</code> / sync
          </td>
          <td>whisper-1</td>
        </tr>
        <tr>
          <td>
            <code>apimart-audio-tts</code>
          </td>
          <td>APIMart TTS</td>
          <td>voice</td>
          <td>
            <code>apimart</code> / sync
          </td>
          <td>tts-1</td>
        </tr>
        <tr>
          <td>
            <code>apimart-video-veo3</code>
          </td>
          <td>APIMart VEO 3</td>
          <td>video</td>
          <td>
            <code>apimart</code> / async
          </td>
          <td>veo3.1-quality</td>
        </tr>
        <tr>
          <td>
            <code>apimart-video-sora2</code>
          </td>
          <td>APIMart Sora 2</td>
          <td>video</td>
          <td>
            <code>apimart</code> / async
          </td>
          <td>sora-2</td>
        </tr>
        <tr>
          <td>
            <code>apimart-video-collection</code>
          </td>
          <td>APIMart 综合</td>
          <td>video</td>
          <td>
            <code>apimart</code> / async
          </td>
          <td>kling-v3</td>
        </tr>
        <tr>
          <td>
            <code>xai-imagine-image</code>
          </td>
          <td>xAI</td>
          <td>image</td>
          <td>
            <code>xai</code> / sync
          </td>
          <td>grok-imagine-image-quality</td>
        </tr>
        <tr>
          <td>
            <code>xai-imagine-video</code>
          </td>
          <td>xAI</td>
          <td>video</td>
          <td>
            <code>xai</code> / async
          </td>
          <td>grok-imagine-video</td>
        </tr>
        <tr>
          <td>
            <code>xai-tts</code>
          </td>
          <td>xAI</td>
          <td>voice</td>
          <td>
            <code>xai</code> / sync
          </td>
          <td>grok-tts</td>
        </tr>
        <tr>
          <td>
            <code>bailian-images</code>
          </td>
          <td>阿里云百炼</td>
          <td>image</td>
          <td>
            <code>bailian</code> / async
          </td>
          <td>wan2.7-image-pro</td>
        </tr>
        <tr>
          <td>
            <code>bailian-video-happyhorse</code>
          </td>
          <td>阿里云百炼 HappyHorse</td>
          <td>video</td>
          <td>
            <code>bailian</code> / async
          </td>
          <td>happyhorse-1.1-t2v</td>
        </tr>
        <tr>
          <td>
            <code>bailian-video-wan-i2v</code>
          </td>
          <td>阿里云百炼 Wan</td>
          <td>video</td>
          <td>
            <code>bailian</code> / async
          </td>
          <td>wan2.7-t2v-2026-06-12</td>
        </tr>
        <tr>
          <td>
            <code>bailian-audio-tts</code>
          </td>
          <td>阿里云百炼</td>
          <td>voice</td>
          <td>
            <code>bailian</code> / sync
          </td>
          <td>qwen3-tts-flash</td>
        </tr>
        <tr>
          <td>
            <code>volcengine-seedance-video</code>
          </td>
          <td>火山方舟</td>
          <td>video</td>
          <td>
            <code>volcengine-ark</code> / async
          </td>
          <td>doubao-seedance-2-5-260628</td>
        </tr>
        <tr>
          <td>
            <code>volcengine-seedream-image</code>
          </td>
          <td>火山方舟</td>
          <td>image</td>
          <td>
            <code>volcengine-ark</code> / sync
          </td>
          <td>doubao-seedream-5-0-pro-260628</td>
        </tr>
        <tr>
          <td>
            <code>volcengine-speech-tts</code>
          </td>
          <td>火山豆包语音合成</td>
          <td>voice</td>
          <td>
            <code>volcengine-speech</code> / sync
          </td>
          <td>seed-tts-2.0</td>
        </tr>
        <tr>
          <td>
            <code>volcengine-speech-audio</code>
          </td>
          <td>火山豆包音频生成</td>
          <td>voice</td>
          <td>
            <code>volcengine-speech</code> / sync
          </td>
          <td>seed-audio-1.0</td>
        </tr>
        <tr>
          <td>
            <code>google-gemini-images</code>
          </td>
          <td>Google Gemini</td>
          <td>image</td>
          <td>
            <code>google-generative-ai</code> / sync
          </td>
          <td>gemini-3.1-flash-image</td>
        </tr>
        <tr>
          <td>
            <code>google-veo-video</code>
          </td>
          <td>Google Gemini Veo</td>
          <td>video</td>
          <td>
            <code>google-generative-ai</code> / async
          </td>
          <td>veo-3.1-generate-preview</td>
        </tr>
        <tr>
          <td>
            <code>google-omni-video</code>
          </td>
          <td>Google Gemini Omni Flash</td>
          <td>video</td>
          <td>
            <code>omni</code> / async
          </td>
          <td>gemini-omni-flash-preview</td>
        </tr>
        <tr>
          <td>
            <code>google-gemini-omni-video</code>
          </td>
          <td>Gemini Omni Flash 官方</td>
          <td>video</td>
          <td>
            <code>google-generative-ai</code> / async
          </td>
          <td>gemini-omni-flash-preview</td>
        </tr>
        <tr>
          <td>
            <code>google-lyria-music</code>
          </td>
          <td>Google Gemini Lyria</td>
          <td>voice</td>
          <td>
            <code>google-generative-ai</code> / sync
          </td>
          <td>lyria-3-clip-preview</td>
        </tr>
        <tr>
          <td>
            <code>midjourney-gateway</code>
          </td>
          <td>Midjourney 网关</td>
          <td>image</td>
          <td>
            <code>midjourney</code> / async
          </td>
          <td>midjourney</td>
        </tr>
        <tr>
          <td>
            <code>kling-video</code>
          </td>
          <td>Kling 可灵视频</td>
          <td>video</td>
          <td>
            <code>kling</code> / async
          </td>
          <td>kling-video-3.0</td>
        </tr>
        <tr>
          <td>
            <code>minimax-image</code>
          </td>
          <td>MiniMax 图片</td>
          <td>image</td>
          <td>
            <code>minimax-hailuo</code> / sync
          </td>
          <td>image-01</td>
        </tr>
        <tr>
          <td>
            <code>minimax-hailuo-speech</code>
          </td>
          <td>MiniMax 语音</td>
          <td>voice</td>
          <td>
            <code>minimax-hailuo</code> / sync
          </td>
          <td>speech-2.8-hd</td>
        </tr>
        <tr>
          <td>
            <code>minimax-hailuo-music</code>
          </td>
          <td>MiniMax 音乐</td>
          <td>voice</td>
          <td>
            <code>minimax-hailuo</code> / sync
          </td>
          <td>music-2.6</td>
        </tr>
        <tr>
          <td>
            <code>minimax-hailuo-video</code>
          </td>
          <td>MiniMax Hailuo 视频</td>
          <td>video</td>
          <td>
            <code>minimax-hailuo</code> / async
          </td>
          <td>MiniMax-Hailuo-2.3</td>
        </tr>
        <tr>
          <td>
            <code>minimax-h3-video</code>
          </td>
          <td>MiniMax H3 视频</td>
          <td>video</td>
          <td>
            <code>minimax-hailuo</code> / async
          </td>
          <td>MiniMax-H3</td>
        </tr>
        <tr>
          <td>
            <code>minimax-video-agent</code>
          </td>
          <td>MiniMax 视频 Agent</td>
          <td>video</td>
          <td>
            <code>minimax-hailuo</code> / async
          </td>
          <td>video-agent</td>
        </tr>
        <tr>
          <td>
            <code>tencent-tokenhub-image</code>
          </td>
          <td>腾讯云</td>
          <td>image</td>
          <td>
            <code>tencent-tokenhub</code> / auto
          </td>
          <td>hy-image-v3.0</td>
        </tr>
        <tr>
          <td>
            <code>tencent-tokenhub-video</code>
          </td>
          <td>腾讯云</td>
          <td>video</td>
          <td>
            <code>tencent-tokenhub</code> / async
          </td>
          <td>hy-video-1.5</td>
        </tr>
      </tbody>
    </table>
    <p>预设里的默认 Base URL（可直接对照渠道文档核对）：</p>
    <pre>
      {`APIMart            https://api.apimart.ai/v1
xAI               https://api.x.ai/v1
OpenAI            https://api.openai.com/v1
Agnes AI          https://apihub.agnes-ai.com/v1
阿里百炼           https://dashscope.aliyuncs.com/api/v1/services/aigc
火山方舟           https://ark.cn-beijing.volces.com/api/v3
火山豆包语音        https://openspeech.bytedance.com（X-Api-Key，非方舟 Bearer）
Google Gemini     https://generativelanguage.googleapis.com/v1beta
Kling             https://api.klingai.com
MiniMax           https://api.minimaxi.com
腾讯云 TokenHub    https://tokenhub.tencentmaas.com
Midjourney 网关    https://your-midjourney-gateway.example/v1（占位，必须改成自建网关）`}
    </pre>

    <h2 id="defaults">5. 默认值、超时与重试</h2>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>默认值</th>
          <th>可配置范围</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>视频异步任务总时限</td>
          <td>
            48 小时（<code>DEFAULT_VIDEO_POLL_TIMEOUT_MS</code>）
          </td>
          <td>
            <code>mediaDefaults.timeoutMs</code> / <code>polling.timeoutMs</code>：1000 ~ 172800000
          </td>
        </tr>
        <tr>
          <td>轮询间隔</td>
          <td>5000 ms</td>
          <td>
            <code>polling.intervalMs</code>：250 ~ 300000
          </td>
        </tr>
        <tr>
          <td>单次轮询 HTTP 超时</td>
          <td>30 s</td>
          <td>不单独配置，且不会超过任务剩余总时限</td>
        </tr>
        <tr>
          <td>轮询间隔退避</td>
          <td>每次 ×1.3，上限 15 s</td>
          <td>代码内固定</td>
        </tr>
        <tr>
          <td>轮询请求的瞬时错误重试</td>
          <td>最多 3 次，退避 1 s 起、每次 ×2、上限 8 s</td>
          <td>
            manifest 的 <code>polling.retry</code>（maxAttempts 0~20、backoffMs 0~300000）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      重试只发生在<strong>异步轮询</strong>阶段：只有「网络层错误 / HTTP 5xx / 429」会重试，并会识别
      响应里的 <code>Retry-After</code>（秒数或时间戳，上限 8 s）；4xx 参数错误、{' '}
      <code>task_failed</code>、<code>task_timeout</code> 不重试。一次性提交请求（create/submit）
      本身不自动重试，失败会直接把错误交给调用方。
    </p>
    <p>
      历史配置的超时会被迁移脚本抬高到当前口径：<code>055_video_poll_timeout_30m.sql</code>、
      <code>056_image_poll_timeout_10m.sql</code>、<code>067_video_poll_timeout_48h.sql</code>。
      迁移只替换「仍等于旧默认值」的记录，你手填过的值不会被覆盖。
    </p>

    <h2 id="artifacts">6. 产物、任务与错误码</h2>
    <ul>
      <li>
        产物根目录是当前 workspace 下的 <code>.spark-artifacts/media</code>，按类型分成{' '}
        <code>images</code> / <code>audio</code> / <code>videos</code> / <code>text</code>{' '}
        （语音转写落 text）。落盘前会把 <code>.spark-artifacts</code>{' '}
        写进仓库本地忽略，避免被连带提交。
      </li>
      <li>
        每次调用都会被持久化成 <code>media_generation_tasks</code>（表在{' '}
        <code>029_media_generation_tasks.sql</code>，恢复所需字段由{' '}
        <code>066_media_task_recovery.sql</code> 补充）。运行时有 submit / inquire / cancel /
        materialize 四段接口。
      </li>
      <li>
        <code>media-task-recovery.service.ts</code>{' '}
        只按持久化的查询契约去问渠道「这个任务怎么样了」，
        <strong>不会重新提交 create/submit</strong>，所以重启应用不会重复计费。
      </li>
      <li>
        画布的模型调用详情面板会显示 Provider / Manifest / 模型 / 状态 / 反向提示词 / Request ID
        以及本次实际参数。
      </li>
    </ul>
    <p>
      代码里会出现的错误码（<code>MediaProviderError.code</code>）：
    </p>
    <ul>
      <li>
        <code>provider_not_configured</code>：渠道没配好，或该 <code>mediaProvider</code> 既没有专用
        适配器也没有匹配到 manifest。
      </li>
      <li>
        <code>capability_not_supported</code>：勾选的能力与实际调用不匹配。
      </li>
      <li>
        <code>api_key_missing</code> / <code>auth_required</code>：凭据缺失或渠道返回鉴权失败。
      </li>
      <li>
        <code>invalid_input</code>：参数被 manifest 校验拦下（常见于时长、分辨率越界）。
      </li>
      <li>
        <code>provider_http_error</code>：渠道返回非 2xx，附带 <code>statusCode</code>。
      </li>
      <li>
        <code>task_failed</code> / <code>task_timeout</code>：异步任务失败或超过总时限。
      </li>
      <li>
        <code>artifact_download_failed</code>：任务成功但产物 URL 下载失败（签名过期、需要鉴权头）。
      </li>
    </ul>
    <p>
      渠道错误响应还会被归一成 <code>unsupported_parameter</code> /{' '}
      <code>invalid_parameter_value</code> / <code>missing_required_input</code> /{' '}
      <code>auth_failed</code> / <code>quota_exceeded</code> / <code>rate_limited</code> /{' '}
      <code>content_policy_blocked</code> / <code>bad_provider_response</code> 这类语义码，便于判断
      该改参数还是该充值。
    </p>

    <h2 id="spark-media-mcp">7. spark_media MCP</h2>
    <p>
      会话只要存在可用的媒体 Provider，就会注入内部 stdio MCP server <code>spark_media</code>，共{' '}
      <strong>14 个工具</strong>：
    </p>
    <pre>
      {`mcp__spark_media__list_models       列出已配置的模型与能力（可用 capability 过滤）
mcp__spark_media__describe_model     查看单个模型的参数 schema 与调用元数据
mcp__spark_media__generate_image     文生图 / 图生图
mcp__spark_media__edit_image         图片编辑 / 多图合成
mcp__spark_media__generate_audio     语音合成或音乐生成（取决于所选模型）
mcp__spark_media__transcribe_audio   语音转写
mcp__spark_media__generate_video     文生视频 / 图生视频 / 参考图生视频 / 视频编辑 / 扩展
mcp__spark_media__upload_file        上传文件到渠道文件平台
mcp__spark_media__get_file           查询渠道文件元数据
mcp__spark_media__list_files         列出渠道文件
mcp__spark_media__delete_file        删除渠道文件（需用户确认）
mcp__spark_media__list_tasks         列出渠道异步任务（百炼支持官方 24 小时查询窗口）
mcp__spark_media__get_task           查询任务（支持生成工具返回的 taskId 或百炼 task id）
mcp__spark_media__cancel_task        取消排队中/运行中的任务（百炼仅 PENDING 可远程取消）`}
    </pre>
    <p>
      文件四件套只在路由到 <code>volcengine-ark</code> 或 <code>bailian</code> 时暴露；其余渠道
      工具列表里看不到它们。
    </p>
    <ul>
      <li>
        <strong>参数</strong>：<code>model</code> 支持「<code>selectionKey</code>（推荐）/ manifest
        id / 渠道模型 id」三种写法，<code>selectionKey</code> 形如{' '}
        <code>&lt;providerProfileId&gt;/&lt;manifestId&gt;</code>。常用参数（
        <code>size</code> / <code>aspectRatio</code> / <code>resolution</code> /{' '}
        <code>durationSeconds</code> / <code>mode</code> / <code>seed</code> /{' '}
        <code>output_format</code> / <code>prompt_optimizer</code> 等）直接暴露，渠道私有字段走{' '}
        <code>extraJson</code>，且会被按 manifest 裁剪，多余字段不会发给渠道。
      </li>
      <li>
        <strong>凭据隔离</strong>：运行时把 Provider 列表写进一个 0600 权限的临时配置文件（
        <code>SPARK_MEDIA_CONFIG_FILE</code>），API Key 不进文件，而是通过{' '}
        <code>SPARK_MEDIA_API_KEY_0</code>、<code>SPARK_MEDIA_API_KEY_1</code>…
        逐个注入子进程环境变量。 Agent 拿不到 Key，也没有工具能读出来。
      </li>
      <li>
        <strong>多档切换</strong>：每个模型保留自己 Provider 的 Key / endpoint / 适配器；生成工具靠{' '}
        <code>model</code> 参数切换实际路由，同名模型必须用唯一 <code>selectionKey</code> 指定。
      </li>
      <li>
        单 Provider 环境变量（<code>SPARK_MEDIA_PROVIDER</code> / <code>SPARK_MEDIA_MODEL</code> /{' '}
        <code>SPARK_MEDIA_API_TYPE</code> / <code>SPARK_MEDIA_BASE_URL</code> /{' '}
        <code>SPARK_MEDIA_OUTPUT_DIR</code>）与 <code>SPARK_MEDIA_MANIFESTS_JSON</code> /{' '}
        <code>SPARK_MEDIA_PROVIDERS_JSON</code> 仍作为兼容回退保留。
      </li>
      <li>
        图片的旧链路 <code>spark_image</code> 只在「没有可解析的统一媒体配置」时才注入，避免两套工具
        争抢模型选择；详见 <a href="/docs/image-providers">图片生成 Provider</a>。
      </li>
    </ul>

    <h2 id="custom-channel">8. 接入自定义渠道</h2>
    <p>两条路，先试第一条：</p>
    <ol>
      <li>
        <strong>UI 手工配置</strong>：Provider 表单里把「平台适配器」选成<strong>自定义</strong>，
        会多出「自定义渠道适配器 → 配置自定义适配器」入口，用{' '}
        <code>ProviderManifestContractEditor</code> 从 4 个基底模板改起（提交 / 鉴权 / Body / 上传 /
        轮询 / 参数 / 错误契约）。适合渠道是「JSON 提交 + 可选轮询 + URL/base64/binary 产物」。
      </li>
      <li>
        <strong>让 Agent 配置</strong>：Agent 侧有 5 个平台工具—— <code>providers_media_guide</code>
        （取能力枚举与起始契约）、 <code>providers_media_validate</code>（只读校验，不落库）、{' '}
        <code>providers_media_configure</code>（校验通过后写入正式 Provider，Key 进 Keychain）、{' '}
        <code>providers_media_discover_models</code>（打渠道 <code>/models</code>）、{' '}
        <code>providers_media_diagnose</code>（分阶段诊断 401/404/400/轮询/产物解析）。诊断里的真实
        生成调用需要用户显式确认。
      </li>
    </ol>
    <p>
      只有在渠道需要自定义鉴权、multipart、回调、文件型 job 或特殊取消语义时，才需要写专用适配器：
      新增{' '}
      <code>
        packages/agent-runtime/src/services/media/adapters/&lt;vendor&gt;-media.adapter.ts
      </code>
      ， 在 <code>MediaRouterService</code> 构造函数里 <code>register()</code>，并补{' '}
      <code>mediaProvider</code> 枚举、表单标签与预设。给这个渠道写 manifest
      的模型更适合走模板适配器。
    </p>

    <h2 id="troubleshoot">9. 常见报错与排查</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>原因与处理</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            会话里没有 <code>spark_media</code> 工具
          </td>
          <td>
            检查 Provider 是否 <code>enabled</code>、是否填了 Key、<code>modelType</code> 是否为
            image/voice/video 或声明了媒体能力、默认模型是否非空；任一不满足就不会注入。
          </td>
        </tr>
        <tr>
          <td>
            <code>No adapter for provider kind xxx</code>
          </td>
          <td>
            这个 <code>mediaProvider</code> 没有专用适配器也没匹配到
            manifest。改成模板能覆盖的渠道，或为该渠道补 manifest。
          </td>
        </tr>
        <tr>
          <td>Video 任务一直 pending 到超时</td>
          <td>
            确认 <code>polling.intervalMs</code> 与 <code>timeoutMs</code>；默认 48 小时。渠道返回的
            status 若不在 manifest 的 <code>statusMap</code> 里，默认按失败处理——除非把{' '}
            <code>unknownStatus</code> 设为 <code>running</code>，此时视为继续等待。
          </td>
        </tr>
        <tr>
          <td>任务成功但产物下载失败</td>
          <td>
            产物 URL 可能带签名时效或需要鉴权头。<code>artifact_download_failed</code>{' '}
            表示任务成功、下载失败，重试「查询」而不是重新提交。
          </td>
        </tr>
        <tr>
          <td>参数被静默丢弃</td>
          <td>
            manifest 的 <code>paramPolicy</code> 会裁剪当前模型不支持的字段；
            <code>describe_model</code> 能看到真实 schema。
          </td>
        </tr>
        <tr>
          <td>「测试连接」失败但生成正常</td>
          <td>测试连接 ping 的是文本端点，纯媒体渠道本来就没有。忽略它，用一次真实生成验证。</td>
        </tr>
      </tbody>
    </table>
  </>
)

export const mediaProviders: DocsPageContent = {
  slug: 'media-providers',
  toc: [
    { id: 'capabilities', title: '1. 能力枚举与适配器', level: 2 },
    { id: 'provider-kinds', title: '1.1 平台适配器枚举', level: 3 },
    { id: 'manifest', title: '2. Media Model Manifest', level: 2 },
    { id: 'config', title: '3. 配置步骤', level: 2 },
    { id: 'presets', title: '4. 内置预设清单', level: 2 },
    { id: 'defaults', title: '5. 默认值、超时与重试', level: 2 },
    { id: 'artifacts', title: '6. 产物、任务与错误码', level: 2 },
    { id: 'spark-media-mcp', title: '7. spark_media MCP', level: 2 },
    { id: 'custom-channel', title: '8. 接入自定义渠道', level: 2 },
    { id: 'troubleshoot', title: '9. 常见报错与排查', level: 2 },
  ],
  faq: [
    {
      question: '统一能力一共几个？我只看到 9 个的旧说法。',
      answer:
        '11 个。除 image.generate / image.edit / image.variations / audio.speech / audio.transcription / video.generate / video.image_to_video / video.edit / video.extend 之外，还有 audio.music（音乐生成）和 video.reference_to_video（参考图生视频）。',
    },
    {
      question: 'mediaProvider 和 imageProvider 是什么关系？',
      answer:
        'mediaProvider 是统一字段。保存 modelType=image 的 Provider 时，Spark 会按 imageProvider 推导并回写 mediaProvider / mediaApiType / mediaCapabilities，其中 openai→openai-compatible、seeddance→volcengine-ark、gemini→google-generative-ai，其余未知值兜底为 custom。',
    },
    {
      question: 'pixverse / wan / happyhorse 能选吗？',
      answer:
        '不能直接选。它们是 mediaProvider 枚举里的值，但 Provider 表单的适配器下拉不含这三项，也没有对应 manifest 种子；这些模型在 APIMart 渠道下以模型 id 的形式提供（如 pixverse-v6、happyhorse-1.1、wan2.7-image）。',
    },
    {
      question: 'API Key 存在哪里？Agent 能看到吗？',
      answer:
        'Key 通过 keystore 存储（macOS 上是单一 Keychain 条目 spark-agent / credential-vault-v1，Provider 只持有 keystore_ref）。调用时只注入到本地 MCP 子进程的环境变量，配置文件里不含 Key，Agent 与模型都看不到明文。',
    },
    {
      question: '应用重启后异步任务会重新提交吗？',
      answer:
        '不会。任务持久化在 media_generation_tasks，恢复逻辑只按已保存的查询契约去渠道查询状态，从不调用 create/submit 端点。',
    },
    {
      question: '内置预设一共有多少条？',
      answer: '64 条 Provider 预设，其中 35 条带多媒体配置（mediaProvider 非空）。',
    },
  ],
  quickReference: [
    {
      key: '统一能力 id',
      value:
        '11 个：image.generate/edit/variations · audio.speech/music/transcription · video.generate/image_to_video/reference_to_video/edit/extend',
    },
    {
      key: 'mediaProvider 枚举',
      value:
        '18 个：apimart/agnes/xai/openai-compatible/openai-images/google-generative-ai/bailian/volcengine-ark/volcengine-speech/kling/pixverse/minimax-hailuo/wan/happyhorse/omni/midjourney/tencent-tokenhub/custom',
    },
    { key: 'mediaApiType', value: 'sync / async / auto' },
    {
      key: '内置 manifest',
      value:
        '167 条 / 13 个 providerKind（表：media_model_manifests + media_provider_models，migration 033）',
    },
    { key: '多媒体预设', value: '35 条（Provider 预设共 64 条）' },
    {
      key: '视频轮询默认',
      value: '间隔 5s、退避 ×1.3 上限 15s、总时限 48h、瞬时错误最多重试 3 次（1s→8s）',
    },
    { key: '产物目录', value: '<workspace>/.spark-artifacts/media/{images,audio,videos,text}' },
    { key: 'MCP', value: 'spark_media（14 个工具；文件四件套仅 volcengine-ark / bailian）' },
  ],
  howTo: {
    name: '在 Spark Work 中接入 APIMart 多媒体服务',
    description: '从新建 Provider 到让 Agent 生成第一张图',
    totalTime: 'PT5M',
    steps: [
      '打开「设置 → Provider」，点「新建」',
      '「模型类型」选「生图模型」，预设选 APIMart',
      '确认「平台适配器」= APIMart、「调用方式」= auto、「支持能力」勾选「生图」与「图生图 / 图片编辑」',
      '在「模型清单」里勾选要用的 manifest（如 gpt-image-2），并设为默认调用模型',
      '填 API Key 并保存，检查下方「实际请求地址」是否为 https://api.apimart.ai/v1/images/generations',
      '新会话里让 Agent 生图，它会调用 mcp__spark_media__generate_image，产物落到 .spark-artifacts/media/images',
    ],
  },
  aiSummary:
    'Spark Work 多媒体 Provider：能力注册表（11 个统一能力）+ 平台适配器（18 个 mediaProvider 枚举，12 个已注册专用适配器，其余走 manifest 驱动的模板适配器）+ Media Model Manifest（167 条内置种子，覆盖 13 个 providerKind）。' +
    '关键字段：mediaProvider / mediaApiType（sync|async|auto）/ mediaCapabilities / mediaDefaults / mediaModelRefs。' +
    '内置 35 条多媒体预设（APIMart、xAI、阿里百炼、火山方舟、火山豆包语音、Google Gemini/Veo/Lyria、Kling、MiniMax Hailuo、Midjourney 网关、腾讯云 TokenHub、OpenAI、Agnes）。' +
    '默认值：轮询间隔 5s、退避 ×1.3 上限 15s、视频总时限 48h、瞬时错误最多重试 3 次。产物落 .spark-artifacts/media/{images,audio,videos,text}；任务持久化在 media_generation_tasks 且恢复时不重新提交。' +
    '运行时注入 spark_media MCP（14 工具，凭据只在子进程环境变量里）；自定义渠道可用 providers_media_validate/configure/diagnose 或 UI 的自定义适配器契约编辑器接入。',
  Body,
}

export default mediaProviders
