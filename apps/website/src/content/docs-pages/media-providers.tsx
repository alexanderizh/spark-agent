import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 多媒体 Provider 采用「能力注册表 + 平台适配器」架构，覆盖图片、语音、视频
      三大类共 9 种能力（image.generate / image.edit / image.variations / audio.speech /
      audio.transcription / video.generate / video.image_to_video / video.edit / video.extend）。
    </p>

    <h2 id="concepts">1. 核心概念</h2>
    <p>每个多媒体 Provider Profile 在 <code>config_json</code> 里携带这些可选字段（全部向后兼容）：</p>
    <table>
      <thead>
        <tr><th>字段</th><th>类型</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr><td>mediaProvider</td><td>枚举</td><td>平台 / 适配器，如 apimart / xai / bailian / openai-compatible / openai-images / google-generative-ai / volcengine-ark / kling / pixverse / wan / hailuo / happyhorse / omni / custom</td></tr>
        <tr><td>mediaApiType</td><td>sync / async / auto</td><td>同步直出 / 异步轮询 / 自动适配</td></tr>
        <tr><td>mediaCapabilities</td><td>MediaCapabilityId[]</td><td>声明的能力（image.generate、audio.speech、video.generate …）</td></tr>
        <tr><td>mediaDefaults</td><td>对象</td><td>默认 size / voice / aspect / 轮询间隔 / 超时</td></tr>
        <tr><td>mediaModelRefs</td><td>数组</td><td>已启用的 MediaModelManifest 引用（驱动 schema 发现）</td></tr>
      </tbody>
    </table>

    <h2 id="manifest">2. Media Model Manifest</h2>
    <p>
      Spark 用 MediaModelManifest 作为「模型元数据单一来源」：
    </p>
    <ul>
      <li>类型与 zod schema 在 <code>packages/protocol/src/media-model-manifest.ts</code>。</li>
      <li>内置种子覆盖 APIMart、xAI、阿里百炼、OpenAI Images、Google Veo、火山 Seedance 2.0 / Fast、kling、pixverse、wan、happyhorse、omni、hailuo 等。</li>
      <li>SQLite 持久化：<code>media_model_manifests</code> + <code>media_provider_models</code>（migration 033）。</li>
      <li><code>MediaModelCatalogService</code> 负责种子化与 list / describe / link 操作。</li>
    </ul>
    <p>
      选中的 manifest capabilities 会镜像到旧的 <code>mediaCapabilities</code>，保证适配器仍能用。
    </p>

    <h2 id="config">3. 配置步骤（以 APIMart / xAI 为例）</h2>
    <ol>
      <li>打开「Provider」新建或编辑一条 Provider。</li>
      <li><strong>模型类型</strong>选「生图模型 / 语音模型 / 视频模型」。</li>
      <li>选预设（APIMart 图片 / xAI Imagine 视频 / APIMart 视频 VEO 3 …），预设会预填端点、默认模型、能力、轮询参数。</li>
      <li>在「多媒体能力」段：
        <ul>
          <li><strong>平台适配器</strong>：APIMart / xAI / OpenAI Compatible / Custom。</li>
          <li><strong>支持能力</strong>：勾选本 Provider 支持的能力。</li>
          <li><strong>调用方式</strong>：sync / async / auto。</li>
          <li><strong>参数默认值</strong>：size、n、quality、voice、format、aspect、duration、poll interval、poll timeout（全部可选）。</li>
        </ul>
      </li>
      <li>填入 Model ID 与 API Key，保存。</li>
    </ol>

    <h2 id="presets">4. 内置预设速查</h2>
    <pre>
{`apimart-images             — APIMart 图片 (GPT Image 1/1.5/2 + 全部 Gemini Nano Banana + Seedream 系列 + Wan 2.7 + Imagen 4.0 + Qwen Image 2.0/Pro + Z-Image-Turbo + Grok Imagine 1.5)
apimart-audio-whisper      — APIMart 语音转写 (Whisper)
apimart-audio-tts          — APIMart 语音合成 (TTS)
apimart-video-veo3         — APIMart 视频 VEO 3.x 系列 (veo3 / veo3.1-fast / veo3.1-quality / veo3.1-lite)
apimart-video-sora2        — APIMart 视频 Sora 2 / Sora 2 Pro
apimart-video-collection   — APIMart 视频合集（Kling 2.6/3.0/3.0 Turbo/v3 Omni/O1、Vidu Q3、Wan 2.5/2.6/2.7+R2V+VideoEdit、HappyHorse 1.0/1.1、SkyReels V4 fast/std、Pixverse v6、Gemini Omni Flash、Omni-Flash-Ext、MiniMax Hailuo 02/2.3、Grok Imagine 1.5 Video、Doubao Seedance 1.5/2.0 系列）
xai-imagine-image          — xAI Imagine 图片
xai-imagine-video          — xAI Imagine 视频 (async, generate/i2v/edit/extend)
xai-tts                    — xAI 语音合成
bailian-images             — 阿里云百炼 图片
bailian-video-happyhorse   — 阿里云百炼 HappyHorse 视频
bailian-video-wan-i2v      — 阿里云百炼 Wan 图生视频
bailian-audio-tts          — 阿里云百炼 语音合成
volcengine-seedance-video  — 火山方舟 Seedance 视频 (async)
kling-video                — Kling 可灵视频 (3.0 / 2.x, async)
hailuo-video               — Hailuo 2.3 视频 (async)`}
    </pre>

    <h2 id="param-coverage">5. 参数覆盖</h2>
    <p>
      Spark 的内置 manifest 定义在 <code>packages/protocol/src/media-model-manifest.ts</code> 的{' '}
      <code>BUILTIN_MEDIA_MODEL_MANIFESTS</code> 中；维护者按官方文档收集参数后直接改该文件，
      应用启动时由 <code>MediaModelCatalogService.seedBuiltinManifests()</code> seed 进 SQLite。
      <code>paramSchema</code> 是：
    </p>
    <ul>
      <li>Provider 编辑默认值：aspect、duration、resolution、format、mode 等枚举会变下拉框。</li>
      <li>画布 AI 操作节点的参数面板：根据 manifest 字段动态生成。</li>
      <li><code>spark_media</code> MCP 工具 schema：常用参数直接暴露，私有字段通过 <code>extraJson</code>。</li>
    </ul>
    <p>当前内置参数覆盖：</p>
    <ul>
      <li><strong>APIMart</strong>：GPT Image 1 / 1.5 / 2 / Wan 2.7 Image / Qwen Image 2.0 + Pro / Seedream 4.0 / 4.5 / 5.0 Lite / 5.0 Pro / Gemini Nano Banana 2/Pro/官方 / Imagen 4.0 / Z-Image-Turbo / Grok Imagine 1.5 Image / Sora 2 + Pro / Veo 3 + 3.1 fast/quality/lite / Kling v2.6 / v3 / v3 Omni / 3.0 Turbo / O1 / Vidu Q3 pro/turbo/mix/standard / Wan 2.5/2.6/2.7+R2V+VideoEdit / HappyHorse 1.0/1.1 / SkyReels V4 fast/std / Pixverse v6 / Gemini Omni Flash / Omni-Flash-Ext / MiniMax Hailuo 02/2.3 / Grok Imagine 1.5 Video / Doubao Seedance 1.5/2.0 系列 — size、aspect、resolution、count、format、顺序生成、搜索开关、视频时长、分辨率、首末帧、音频标志。</li>
      <li><strong>xAI</strong>：Grok Imagine Image Quality / Grok Imagine Video / Grok TTS — aspect、duration、resolution、first frame、format、voice、video edit / extend（duration 1-15s）。</li>
      <li><strong>阿里百炼</strong>：Wan 2.7 全系（Image Pro / T2V / I2V / R2V / VideoEdit）、HappyHorse 全系（1.0/1.1 T2V、1.1 I2V/R2V、1.0 Video Edit）、Qwen3 TTS Flash。</li>
      <li><strong>火山</strong>：Doubao Seedance 2.0 / 2.0 Fast。</li>
      <li><strong>Kling</strong>：Video 3.0 / 3.0 Omni / O1 / 2.6 Pro / 2.6 Standard / 2.5 Turbo。</li>
      <li><strong>Hailuo</strong>：Image 01 / Speech 2.8 HD/Turbo / Music 2.6 / Hailuo 2.3。</li>
    </ul>

    <h2 id="default-endpoints">6. 默认端点</h2>
    <table>
      <thead><tr><th>Provider</th><th>端点</th></tr></thead>
      <tbody>
        <tr><td>APIMart</td><td>https://api.apimart.ai/v1</td></tr>
        <tr><td>xAI</td><td>https://api.x.ai/v1</td></tr>
        <tr><td>阿里百炼</td><td>https://dashscope.aliyuncs.com/api/v1/services/aigc</td></tr>
        <tr><td>火山方舟</td><td>https://ark.cn-beijing.volces.com/api</td></tr>
      </tbody>
    </table>
    <p>
      xAI Grok Imagine Video 在不同模式下走不同端点（统一 <code>GET /videos/&#123;request_id&#125;</code> 轮询）：
    </p>
    <ul>
      <li><strong>Text-to-video / Image-to-video</strong>：<code>POST /videos/generations</code>，<code>image: &#123; url &#125;</code> 作为首帧。</li>
      <li><strong>Video edit</strong>：<code>POST /videos/edits</code>，<code>video: &#123; url &#125;</code> + prompt；输出继承输入 duration / aspect / resolution。</li>
      <li><strong>Video extend</strong>：<code>POST /videos/extensions</code>，<code>video: &#123; url &#125;</code> + prompt，<code>duration</code> [1,15]s 默认 6s。</li>
    </ul>

    <h2 id="spark-media-mcp">7. spark_media MCP</h2>
    <p>当会话存在启用的语音/视频 Provider（图片继续用 <code>spark_image</code>），Spark 注入内部 stdio MCP server <code>spark_media</code>：</p>
    <pre>
{`mcp__spark_media__generate_image     — 文生图 / 图生图
mcp__spark_media__edit_image         — 编辑 / 合成
mcp__spark_media__generate_audio     — 文生音
mcp__spark_media__transcribe_audio   — 音生文
mcp__spark_media__generate_video     — 文生视频 / 图生视频 / 视频编辑
mcp__spark_media__list_models        — 列出配置的 manifest
mcp__spark_media__describe_model     — 查看 manifest 与 param schema
mcp__spark_media__get_task           — 查询任务
mcp__spark_media__cancel_task        — 取消任务（如支持）`}
    </pre>
    <ul>
      <li>API Key 只注入到本地 MCP 子进程环境，Agent 永远看不到凭据。</li>
      <li>产物路径 <code>.spark-artifacts/media/&#123;images,audio,videos,text&#125;</code>。</li>
      <li>Agent system prompt 仅在「有可用 Provider」时附加模型信息。</li>
      <li>如果有 <code>mediaModelRefs</code>，会通过 <code>SPARK_MEDIA_MANIFESTS_JSON</code> 注入；
          否则 MCP 用最小化环境变量推导。</li>
      <li>通用参数 <code>aspectRatio</code> / <code>resolution</code> / <code>durationSeconds</code> / <code>mode</code> /
          <code>negative_prompt</code> / <code>seed</code> / <code>output_format</code> / <code>prompt_optimizer</code> /
          音频标志都直接暴露，私有参数走 <code>extraJson</code>。</li>
    </ul>

    <h2 id="extend">8. 扩展新平台</h2>
    <ol>
      <li>优先用 <code>MediaModelManifest</code>（当供应商是 JSON 提交 + 可选轮询 + URL/base64/binary/text 产物）。</li>
      <li>在 Provider 编辑 UI 的 <code>mediaModelRefs</code> 绑定 manifest。</li>
      <li>只有在需要自定义鉴权 / multipart / 回调 / 文件 job / 特殊取消时，才写
          <code>packages/agent-runtime/src/services/media/adapters/&lt;vendor&gt;-media.adapter.ts</code>。</li>
      <li>在 <code>MediaRouterService</code> 构造函数注册新适配器，补预设与 UI 元数据。</li>
    </ol>
  </>
)

export const mediaProviders: DocsPageContent = {
  slug: 'media-providers',
  toc: [
    { id: 'concepts', title: '1. 核心概念', level: 2 },
    { id: 'manifest', title: '2. Media Model Manifest', level: 2 },
    { id: 'config', title: '3. 配置步骤', level: 2 },
    { id: 'presets', title: '4. 内置预设速查', level: 2 },
    { id: 'param-coverage', title: '5. 参数覆盖', level: 2 },
    { id: 'default-endpoints', title: '6. 默认端点', level: 2 },
    { id: 'spark-media-mcp', title: '7. spark_media MCP', level: 2 },
    { id: 'extend', title: '8. 扩展新平台', level: 2 },
  ],
  faq: [
    {
      question: 'mediaProvider 和 imageProvider 是什么关系？',
      answer: 'mediaProvider 是统一栈字段；imageProvider 是历史字段，保存 image Provider 时会自动同步到 mediaProvider / mediaApiType / mediaCapabilities。',
    },
    {
      question: 'spark_image 还能用吗？',
      answer: '可以。image.generate 仍走 spark_image；image.edit / audio / video 走新的 spark_media。',
    },
    {
      question: '需要真实 API Key 才能测试吗？',
      answer: '不需要。所有适配器都有 mock fetch 测试（packages/agent-runtime/src/__tests__/services/media/media-adapters.test.ts）。',
    },
    {
      question: '可以混合多平台吗？',
      answer: '可以。文本用 OpenAI，生图用 APIMart，视频用火山，语音用 xAI；按 Provider 自由组合。',
    },
  ],
  quickReference: [
    { key: '统一能力 id', value: 'image.generate/edit/variations · audio.speech/transcription · video.generate/image_to_video/edit/extend' },
    { key: 'Manifest 存储', value: 'media_model_manifests + media_provider_models（migration 033）' },
    { key: '默认端点', value: 'APIMart api.apimart.ai/v1 · xAI api.x.ai/v1 · 阿里百炼 dashscope.aliyuncs.com · 火山 ark.cn-beijing.volces.com' },
    { key: '图片 MCP', value: 'spark_image（兼容 imageProvider/imageApiType）' },
    { key: '统一 MCP', value: 'spark_media（image edit / audio / video）' },
    { key: '产物目录', value: '.spark-artifacts/media/{images,audio,videos,text}' },
  ],
  howTo: {
    name: '在 Spark Agent 中接入 APIMart 多媒体服务',
    description: '从创建 Provider 到生成第一张图',
    totalTime: 'PT5M',
    steps: [
      '打开「设置 → Provider」，点「新建」',
      '选「生图模型」，preset 选 APIMart 图片',
      '填入 Model ID（默认 GPT Image 2）与 API Key',
      '确认 mediaProvider=apimart、mediaApiType=auto、mediaCapabilities 含 image.generate',
      '保存后在新会话中可用，Agent 通过 mcp__spark_image__generate_image 调用',
    ],
  },
  aiSummary:
    'Spark Agent 多媒体 Provider：能力注册表 + 平台适配器，9 种能力（image.generate/edit/variations · audio.speech/transcription · ' +
    'video.generate/image_to_video/edit/extend）。核心字段：mediaProvider（apimart/xai/bailian/openai-images/google-generative-ai/volcengine-ark/kling/pixverse/wan/hailuo/happyhorse/omni/custom）、' +
    'mediaApiType（sync/async/auto）、mediaCapabilities、mediaDefaults、mediaModelRefs。MediaModelManifest 是模型元数据单一来源，' +
    '驱动 Provider 编辑默认值、画布 AI 操作参数面板、spark_media MCP 工具 schema。内置预设：apimart-images/tts/whisper/video-veo3/video-sora2、xai-imagine-image/video/tts、' +
    'bailian-images/video-happyhorse/video-wan-i2v/audio-tts、volcengine-seedance-video、kling-video、hailuo-video。' +
    '默认端点：APIMart api.apimart.ai/v1、xAI api.x.ai/v1、阿里百炼 dashscope.aliyuncs.com、火山 ark.cn-beijing.volces.com。' +
    '扩展新平台优先用 MediaModelManifest，需要自定义鉴权/回调时再写专属适配器。',
  Body,
}

export default mediaProviders
