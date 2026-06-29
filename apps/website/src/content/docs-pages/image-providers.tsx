import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 通过 <code>modelType=image</code> 的 Provider 接入图片生成。
      图片模型不走默认 Anthropic 聊天协议，携带两个额外字段：<code>imageProvider</code>（图片 API 家族）
      与 <code>imageApiType</code>（调用方式）。
    </p>

    <h2 id="config">1. 配置步骤</h2>
    <ol>
      <li>打开「Provider」新建或编辑一条 Provider。</li>
      <li><strong>模型类型</strong>选「生图模型」。</li>
      <li>选图片 API 源：<code>openai</code> / <code>apimart</code> / <code>openrouter</code> /
          <code>gemini</code> / <code>seedance</code> / <code>bailian</code> / <code>zhipu</code> /
          <code>xai</code> / <code>custom</code>。</li>
      <li>填入 Model ID 与 API Key，保存。</li>
    </ol>
    <p>
      内置图片预设：OpenAI Images、APIMart Images、OpenRouter Images、Gemini Images、Volcengine Seedream/Seedance。
    </p>

    <h2 id="runtime">2. 运行时行为</h2>
    <p>在 Claude SDK 的一轮里，Spark 会：</p>
    <ol>
      <li>找第一条 <code>modelType=image</code> 且 Keychain 凭据可用的 Provider。</li>
      <li>注入内部 stdio MCP server <code>spark_image</code>，并允许工具：</li>
    </ol>
    <pre>{`mcp__spark_image__generate_image`}</pre>
    <p>产物落到 <code>.spark-artifacts/images</code>（在当前 workspace 内）。</p>
    <p>工具结果同时返回本地 <code>files</code> 和可展示的 <code>urls</code>（当 Provider 配置了 URL 前缀）。</p>

    <h2 id="agent-usage">3. Agent 使用</h2>
    <p>
      只有当存在可用的图片 Provider 时，Agent 才会追加「图片生成 system prompt」，
      告诉 Agent 调受控 MCP 工具完成显式图片请求，并严禁泄露 API Key。
    </p>
    <p>工具接受：</p>
    <ul>
      <li><strong>prompt</strong>：详细图片提示词。</li>
      <li><strong>size</strong>：像素尺寸、宽高比，或语义尺寸 <code>portrait</code> / <code>landscape</code> / <code>square</code>。</li>
      <li><strong>n</strong>：生成数量，1~4。</li>
      <li><strong>filename</strong>：可选输出文件名。</li>
      <li><strong>extraJson</strong>：供应商私有参数。</li>
    </ul>

    <h2 id="unified-stack">4. 与统一多媒体栈的关系</h2>
    <p>
      图片 <strong>编辑</strong>、<strong>语音</strong>（合成 + 转写）、<strong>视频</strong>请看
      <a href="/docs/media-providers">多媒体 Provider</a> 文档。统一栈引入 <code>spark_media</code> MCP、
      平台适配器（APIMart / xAI）与画布直连能力。
    </p>
    <p>
      历史 <code>imageProvider</code> / <code>imageApiType</code> 仍然兼容 — 保存图片 Provider 时会同步
      <code>mediaProvider</code> / <code>mediaApiType</code> / <code>mediaCapabilities</code>，
      让图片 Profile 参与统一能力注册表。
    </p>

    <h2 id="selection">5. Provider 选择</h2>
    <p>
      当前实现是「全局图片 Provider 选择」。后续可以在 Agent Runtime 配置里扩展 per-agent 图片模型绑定。
    </p>
  </>
)

export const imageProviders: DocsPageContent = {
  slug: 'image-providers',
  toc: [
    { id: 'config', title: '1. 配置步骤', level: 2 },
    { id: 'runtime', title: '2. 运行时行为', level: 2 },
    { id: 'agent-usage', title: '3. Agent 使用', level: 2 },
    { id: 'unified-stack', title: '4. 与统一多媒体栈的关系', level: 2 },
    { id: 'selection', title: '5. Provider 选择', level: 2 },
  ],
  faq: [
    {
      question: '图片模型参数和文本模型有什么区别？',
      answer:
        '图片模型携带 imageProvider / imageApiType 两个额外字段；保存非图片模型时会自动清空图片专属配置。',
    },
    {
      question: '生成的图存在哪里？',
      answer: '当前 workspace 下的 .spark-artifacts/images 目录。',
    },
    {
      question: '可以同时挂多个图片 Provider 吗？',
      answer: '当前是全局选择，按 Provider 启用顺序选第一条可用的。后续会支持 per-agent 绑定。',
    },
  ],
  quickReference: [
    { key: 'MCP 名称', value: 'spark_image' },
    { key: '工具', value: 'mcp__spark_image__generate_image' },
    { key: '图片 API 家族', value: 'openai / apimart / openrouter / gemini / seedance / bailian / zhipu / xai / custom' },
    { key: '调用方式', value: 'sync / async / auto' },
    { key: '产物目录', value: '.spark-artifacts/images' },
    { key: '向后兼容', value: '保存时自动同步 mediaProvider / mediaApiType / mediaCapabilities' },
  ],
  howTo: {
    name: '在 Spark Agent 中接入 OpenAI 图片生成',
    description: '从创建 Provider 到让 Agent 生成第一张图',
    totalTime: 'PT3M',
    steps: [
      '打开「设置 → Provider」，点「新建」',
      '「模型类型」选「生图模型」，preset 选 OpenAI Images',
      '填入 Model ID（如 dall-e-3）与 API Key',
      '保存后点「测试连接」确认可用',
      '新会话里给 Agent 发指令：「用 OpenAI Images 画一张…」',
    ],
  },
  aiSummary:
    'Spark Agent 图片生成 Provider：modelType=image 携带 imageProvider（openai/apimart/openrouter/gemini/seedance/bailian/zhipu/xai/custom）' +
    '与 imageApiType（sync/async/auto）。运行时注入 stdio MCP server spark_image，工具 mcp__spark_image__generate_image，' +
    '产物落到 .spark-artifacts/images。Agent 仅在存在可用图片 Provider 时追加图片生成 system prompt。' +
    '与统一栈的关系：图片编辑 / 语音 / 视频走 spark_media；保存图片 Provider 时自动同步 mediaProvider/mediaApiType/mediaCapabilities，' +
    '当前是全局 Provider 选择，后续扩展 per-agent 绑定。',
  Body,
}

export default imageProviders
