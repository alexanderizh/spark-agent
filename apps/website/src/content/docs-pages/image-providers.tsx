import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      图片生成有两条链路：旧的 <code>spark_image</code>（单 Provider、单工具、只生图）与统一的{' '}
      <code>spark_media</code>（多 Provider 路由、覆盖生图 / 编辑 / 语音 / 视频）。二者的取舍规则
      是确定的：
      <strong>
        只要能解析出统一媒体配置，就只注入 <code>spark_media</code>
      </strong>
      ；<code>spark_image</code>{' '}
      是兜底，不是主力。这篇讲清楚两条链路各管什么、字段怎么落、参数怎么被 归一。
    </p>

    <h2 id="config">1. 配置步骤与真实选项</h2>
    <ol>
      <li>
        打开 <strong>设置 → Provider</strong>，新建或编辑一条 Provider。
      </li>
      <li>
        <strong>模型类型</strong>选<strong>生图模型</strong>（存储字面量 <code>image</code>）。
        图片专属字段只有 <code>modelType=image</code> 时才会写入。
      </li>
      <li>
        选<strong>图片 API 源</strong>。表单里是下面 9
        个选项，括号内是真实枚举值、默认端点与默认调用方式：
        <table>
          <thead>
            <tr>
              <th>界面标签</th>
              <th>imageProvider</th>
              <th>默认端点</th>
              <th>默认 imageApiType</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>OpenAI Images</td>
              <td>
                <code>openai</code>
              </td>
              <td>https://api.openai.com/v1</td>
              <td>
                <code>sync</code>
              </td>
            </tr>
            <tr>
              <td>APIMart</td>
              <td>
                <code>apimart</code>
              </td>
              <td>https://api.apimart.ai/v1</td>
              <td>
                <code>async</code>
              </td>
            </tr>
            <tr>
              <td>OpenRouter</td>
              <td>
                <code>openrouter</code>
              </td>
              <td>https://openrouter.ai/api/v1</td>
              <td>
                <code>sync</code>
              </td>
            </tr>
            <tr>
              <td>Gemini / Imagen</td>
              <td>
                <code>gemini</code>
              </td>
              <td>https://generativelanguage.googleapis.com/v1beta</td>
              <td>
                <code>sync</code>
              </td>
            </tr>
            <tr>
              <td>火山方舟 Seedream / Seedance</td>
              <td>
                <code>seeddance</code>
              </td>
              <td>https://ark.cn-beijing.volces.com/api/v3</td>
              <td>
                <code>sync</code>
              </td>
            </tr>
            <tr>
              <td>阿里百炼</td>
              <td>
                <code>bailian</code>
              </td>
              <td>https://dashscope.aliyuncs.com/api/v1/services/aigc</td>
              <td>
                <code>async</code>
              </td>
            </tr>
            <tr>
              <td>智谱 GLM Image</td>
              <td>
                <code>zhipu</code>
              </td>
              <td>https://open.bigmodel.cn/api/paas/v4</td>
              <td>
                <code>sync</code>
              </td>
            </tr>
            <tr>
              <td>xAI Imagine</td>
              <td>
                <code>xai</code>
              </td>
              <td>https://api.x.ai/v1</td>
              <td>
                <code>sync</code>
              </td>
            </tr>
            <tr>
              <td>自定义兼容接口</td>
              <td>
                <code>custom</code>
              </td>
              <td>（空，自己填）</td>
              <td>
                <code>sync</code>
              </td>
            </tr>
          </tbody>
        </table>
      </li>
      <li>填 Model ID 与 API Key，保存。</li>
    </ol>
    <p>
      注意枚举拼写：是 <code>seeddance</code> 而不是 <code>seedance</code>。保存时 Spark
      会做兼容归一，
      <code>seedance</code> / <code>volcengine</code> 也会被映射成 <code>volcengine-ark</code>，
      但表单与预设写的是 <code>seeddance</code>。
    </p>
    <p>
      内置的生图预设共 9 条：<code>openai-images</code>（OpenAI，gpt-image-2）、
      <code>apimart-images</code>（APIMart，gpt-image-2）、<code>xai-imagine-image</code>（xAI，
      grok-imagine-image-quality）、<code>bailian-images</code>（阿里云百炼，wan2.7-image-pro）、
      <code>volcengine-seedream-image</code>（火山方舟，doubao-seedream-5-0-pro-260628）、
      <code>google-gemini-images</code>（Google Gemini，gemini-3.1-flash-image）、
      <code>midjourney-gateway</code>（Midjourney 网关，需改自建网关地址）、
      <code>minimax-image</code>（MiniMax 图片，image-01）、
      <code>tencent-tokenhub-image</code>（腾讯云，hy-image-v3.0）。
    </p>

    <h2 id="runtime">2. 运行时链路：spark_image 与 spark_media 的分界</h2>
    <p>每一轮对话开始时，Spark 按固定顺序解析：</p>
    <pre>
      {`1. resolveMediaGenerationContext()
     聚合所有 enabled 且凭据可用的图片 / 语音 / 视频 Provider
     → 有结果：注入 spark_media（14 个工具），不再注入 spark_image
2. 只有当上一步返回 null 时，才调用 resolveImageGenerationContext()
     找第一条 modelType=image 且凭据可用的 Provider
     → 注入 spark_image，只暴露 mcp__spark_image__generate_image`}
    </pre>
    <p>
      也就是说：<strong>一个 Provider 同时能生图、语音、视频时，图片请求也走 spark_media</strong>。
      只有「配了图片 Provider 但统一媒体栈解析不出任何可用配置」这种旧环境，才会落到{' '}
      <code>spark_image</code>。
    </p>
    <p>两条链路的差异：</p>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>spark_media</th>
          <th>spark_image</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>工具</td>
          <td>14 个（生图 / 编辑 / 语音 / 视频 / 文件 / 任务）</td>
          <td>
            1 个（<code>generate_image</code>）
          </td>
        </tr>
        <tr>
          <td>Provider 范围</td>
          <td>所有 enabled 的 image / voice / video Provider，可混用</td>
          <td>第一条可用的 image Provider</td>
        </tr>
        <tr>
          <td>模型选择</td>
          <td>
            靠 <code>model</code>（selectionKey / manifest id / 模型 id）路由
          </td>
          <td>固定用该 Provider 的默认模型</td>
        </tr>
        <tr>
          <td>产物目录</td>
          <td>
            <code>
              .spark-artifacts/media/{'{'}images,audio,videos,text{'}'}
            </code>
          </td>
          <td>
            <code>.spark-artifacts/images</code>
          </td>
        </tr>
        <tr>
          <td>能力</td>
          <td>11 个统一能力</td>
          <td>仅文生图</td>
        </tr>
      </tbody>
    </table>
    <p>
      图片<strong>编辑 / 变体 / 语音 / 视频</strong>不在 <code>spark_image</code> 的能力范围里，请看{' '}
      <a href="/docs/media-providers">多媒体 Provider</a>。
    </p>

    <h2 id="tool">3. spark_image 工具</h2>
    <p>注入时通过环境变量把配置传进本地 stdio 子进程：</p>
    <pre>
      {`SPARK_IMAGE_API_KEY      Provider 的 API Key（只在子进程里）
SPARK_IMAGE_MODEL        默认模型 id
SPARK_IMAGE_PROVIDER     imageProvider 值，缺省 openai
SPARK_IMAGE_API_TYPE     sync | async | auto，缺省 sync
SPARK_IMAGE_BASE_URL     仅当 Provider 配了 apiEndpoint 时传
SPARK_IMAGE_OUTPUT_DIR   固定为 <workspace>/.spark-artifacts/images`}
    </pre>
    <p>
      工具 <code>mcp__spark_image__generate_image</code> 的参数：
    </p>
    <table>
      <thead>
        <tr>
          <th>参数</th>
          <th>类型</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>prompt</code>
          </td>
          <td>string（必填）</td>
          <td>详细提示词</td>
        </tr>
        <tr>
          <td>
            <code>size</code>
          </td>
          <td>string</td>
          <td>
            像素尺寸或宽高比，如 <code>1024x1024</code>、<code>1:1</code>、<code>16:9</code>
            ，也接受语义值 <code>portrait</code> / <code>landscape</code> / <code>square</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>n</code>
          </td>
          <td>integer 1~4</td>
          <td>生成数量，默认 1，超出会被夹到 4</td>
        </tr>
        <tr>
          <td>
            <code>filename</code>
          </td>
          <td>string</td>
          <td>输出文件名，不要带路径</td>
        </tr>
        <tr>
          <td>
            <code>extraJson</code>
          </td>
          <td>object</td>
          <td>渠道私有参数</td>
        </tr>
      </tbody>
    </table>
    <p>执行细节：</p>
    <ul>
      <li>
        默认尺寸 <code>1024x1024</code>；同步请求超时 10 分钟；异步轮询间隔 5 秒，轮询{' '}
        <code>
          GET {`{baseUrl}`}/tasks/{`{taskId}`}
        </code>
        。
      </li>
      <li>
        结果解析会遍历整个响应体，抓 <code>url</code> / <code>image_url</code> /{' '}
        <code>imageUrl</code>、 <code>data:image/*;base64,</code> 以及长度大于 64 的{' '}
        <code>b64_json</code> / <code>base64</code>， 按内容去重后下载落盘。
      </li>
      <li>
        默认文件名形如 <code>img_&lt;时间戳&gt;_&lt;随机串&gt;</code>
        ；一次生成多张时会在基础名后追加 <code>_001</code> 这类三位序号，再拼扩展名。
      </li>
      <li>
        返回结构：<code>{`{ success, provider, mode, files, urls }`}</code>，其中{' '}
        <code>provider</code> 形如 <code>apimart/gpt-image-2</code>。只有配置了 URL 前缀时{' '}
        <code>urls</code> 才会是外链，否则与 <code>files</code>{' '}
        相同（都是本地路径）——应用当前不注入该 前缀变量，所以默认拿到本地路径。
      </li>
      <li>
        Agent 侧 system prompt 要求：成功后必须调用 <code>mcp__spark_files__present_files</code>{' '}
        把本地 图片文件交给应用渲染预览；返回纯 URL 不算完成；失败时<strong>不要自动重试</strong>
        ，要报错并建议 调整模型 / 提示词 / 尺寸 / Provider 配置。
      </li>
    </ul>

    <h2 id="params">4. 各渠道参数归一</h2>
    <p>
      <code>size</code> 会按渠道被改写成该渠道真正接受的字段，这是最容易踩坑的地方：
    </p>
    <table>
      <thead>
        <tr>
          <th>imageProvider</th>
          <th>提交路径</th>
          <th>size / 比例处理</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>openai</code>
          </td>
          <td>
            <code>/images/generations</code>
          </td>
          <td>比例映射成像素尺寸：1:1→1024x1024、3:2/16:9→1536x1024、2:3/3:4/9:16→1024x1536</td>
        </tr>
        <tr>
          <td>
            <code>xai</code>
          </td>
          <td>
            <code>/images/generations</code>
          </td>
          <td>
            <strong>
              删除 <code>size</code>
            </strong>
            （xAI 会报 Argument not supported: size），比例改写成 <code>aspect_ratio</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>apimart</code>
          </td>
          <td>
            <code>/images/generations</code>，异步
          </td>
          <td>比例或尺寸原样传递</td>
        </tr>
        <tr>
          <td>
            <code>bailian</code>
          </td>
          <td>
            同步 <code>/multimodal-generation/generation</code>；异步{' '}
            <code>/image-generation/generation</code>（带 <code>X-DashScope-Async: enable</code>）
          </td>
          <td>
            用星号尺寸（1:1→1280*1280、3:4→1104*1472、4:3→1472*1104、9:16→960*1696、16:9→1696*960）；body
            改写成 <code>input.messages</code> + <code>parameters</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>openrouter</code>
          </td>
          <td>
            <code>/chat/completions</code>
          </td>
          <td>
            比例写进 <code>image_config.aspect_ratio</code>；body 是 chat 格式并带{' '}
            <code>modalities</code>（默认 <code>["image","text"]</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>gemini</code> / <code>seeddance</code> / <code>zhipu</code>
          </td>
          <td>
            <code>/images/generations</code>
          </td>
          <td>
            把 <code>aspect_ratio</code> 与 <code>aspectRatio</code> 同时写进 <code>extraJson</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>custom</code>
          </td>
          <td>
            <code>/images/generations</code>
          </td>
          <td>
            比例或尺寸原样传递，其余靠 <code>extraJson</code>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="selection">5. Provider 选择规则</h2>
    <p>
      <code>spark_image</code> 自动挑选 Provider 的条件，四条缺一不可：
    </p>
    <ol>
      <li>
        <code>enabled = 1</code>；
      </li>
      <li>
        <code>config_json.modelType === "image"</code>；
      </li>
      <li>
        有 <code>keystore_ref</code>，且能真的从密钥库里解出非空 API Key；
      </li>
      <li>
        默认模型（<code>defaultModel</code>，回退 <code>model</code>）非空。
      </li>
    </ol>
    <p>
      命中条件时取「第一条」。查询语句是 <code>SELECT * FROM provider_profiles LIMIT 1000</code>
      ，没有 <code>ORDER BY</code>，
      实际就是数据库自然顺序（通常是创建顺序）。所以想固定用哪条，最简单的做法是只保留一条可用的
      图片 Provider。
    </p>
    <p>
      选择过程<strong>不检查健康状态</strong>：不会去 ping
      渠道。只要字段齐全就会注入，真实失败会在第一次 调用时暴露。
    </p>

    <h2 id="sync-media">6. 与统一媒体栈的字段同步</h2>
    <p>
      保存 <code>modelType=image</code> 的 Provider 时，Spark 会同步三个统一字段：
    </p>
    <table>
      <thead>
        <tr>
          <th>imageProvider</th>
          <th>写回的 mediaProvider</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>openai</code> / <code>openai-compatible</code>
          </td>
          <td>
            <code>openai-compatible</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>apimart</code> / <code>xai</code> / <code>bailian</code> / <code>custom</code>
          </td>
          <td>原值</td>
        </tr>
        <tr>
          <td>
            <code>seeddance</code> / <code>seedance</code> / <code>volcengine</code>
          </td>
          <td>
            <code>volcengine-ark</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>gemini</code> / <code>google</code>
          </td>
          <td>
            <code>google-generative-ai</code>
          </td>
        </tr>
        <tr>
          <td>
            其它（如 <code>zhipu</code>、<code>openrouter</code>）
          </td>
          <td>
            <code>custom</code> 兜底
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>mediaApiType</code> 取 <code>imageApiType</code> 的归一值；
      <code>mediaCapabilities</code> 保证至少包含 <code>image.generate</code>
      。运行时解析统一媒体配置时，遇到未知 <code>mediaProvider</code> 也会兜底成{' '}
      <code>openai-compatible</code>。
    </p>

    <h2 id="troubleshoot">7. 常见问题排查</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>排查</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>会话里没有图片生成工具</td>
          <td>
            先确认是否已有可用的统一媒体 Provider（有的话只会出现 <code>spark_media</code>
            ，这是预期行为）。若两套都没有，逐条对照第 5 节的四个条件。
          </td>
        </tr>
        <tr>
          <td>「测试连接」失败，但图片能生成</td>
          <td>
            正常。测试连接发的是文本 ping（OpenAI 兼容 <code>/chat/completions</code>
            ），纯生图渠道通常没有 chat 端点。
          </td>
        </tr>
        <tr>
          <td>
            xAI 报 <code>Argument not supported: size</code>
          </td>
          <td>
            说明 <code>size</code> 被透传了。走 <code>spark_image</code> 时会自动改写为{' '}
            <code>aspect_ratio</code>；如果你自己拼 HTTP 请求，请只传 <code>aspect_ratio</code> +{' '}
            <code>resolution</code>。
          </td>
        </tr>
        <tr>
          <td>异步渠道报「没有图片也没有 task id」</td>
          <td>
            渠道返回体结构与预期不符。代码按 <code>task_id</code> / <code>taskId</code> /{' '}
            <code>job_id</code> / <code>jobId</code> / <code>request_id</code> /{' '}
            <code>requestId</code> / <code>id</code> 顺序找任务号；都没有就只能报错。
          </td>
        </tr>
        <tr>
          <td>图片生成成功但界面没有预览</td>
          <td>
            Agent 需要在成功后调用 <code>mcp__spark_files__present_files</code> 把本地文件交给应用。
          </td>
        </tr>
        <tr>
          <td>想要图片编辑 / 变体 / 多图合成</td>
          <td>
            <code>spark_image</code> 只做文生图，配置统一媒体 Provider 后用 <code>spark_media</code>{' '}
            的 <code>generate_image</code> / <code>edit_image</code>。
          </td>
        </tr>
      </tbody>
    </table>
  </>
)

export const imageProviders: DocsPageContent = {
  slug: 'image-providers',
  toc: [
    { id: 'config', title: '1. 配置步骤与真实选项', level: 2 },
    { id: 'runtime', title: '2. 运行时链路：spark_image 与 spark_media', level: 2 },
    { id: 'tool', title: '3. spark_image 工具', level: 2 },
    { id: 'params', title: '4. 各渠道参数归一', level: 2 },
    { id: 'selection', title: '5. Provider 选择规则', level: 2 },
    { id: 'sync-media', title: '6. 与统一媒体栈的字段同步', level: 2 },
    { id: 'troubleshoot', title: '7. 常见问题排查', level: 2 },
  ],
  faq: [
    {
      question: '图片生成到底走 spark_image 还是 spark_media？',
      answer:
        '只要能解析出可用的统一媒体配置，就只注入 spark_media（图片也走它）；spark_image 仅在统一媒体栈解析为空时作为兜底注入，避免两个工具争抢模型选择。',
    },
    {
      question: '图片模型和文本模型有什么区别？',
      answer:
        'modelType=image 时会多写 imageProvider 与 imageApiType 两个字段，并把它们同步到 mediaProvider / mediaApiType / mediaCapabilities（至少含 image.generate）。非图片模型会清掉图片专属字段。',
    },
    {
      question: '生成的图存在哪里？',
      answer:
        'spark_image 是 <workspace>/.spark-artifacts/images；spark_media 是 <workspace>/.spark-artifacts/media/images。落盘目录会被写进仓库本地忽略。',
    },
    {
      question: '可以同时挂多个图片 Provider 吗？',
      answer:
        '可以。spark_media 会把所有可用 Provider 聚合起来，用 model 参数路由；但走旧的 spark_image 时只会取第一条满足条件的 Provider（数据库自然顺序，通常是创建顺序），且不检查健康状态。',
    },
    {
      question: '为什么「测试连接」通不过？',
      answer:
        '测试连接发的是文本协议 ping（/chat/completions 或 Anthropic messages），不校验图片端点。纯生图渠道没有 chat 端点会失败，这不代表图片功能不可用。',
    },
  ],
  quickReference: [
    {
      key: '图片 API 源',
      value:
        'openai / apimart / openrouter / gemini / seeddance / bailian / zhipu / xai / custom（注意是 seeddance）',
    },
    { key: '调用方式', value: 'sync / async / auto（缺省 sync）' },
    {
      key: '内建生图预设',
      value:
        '9 条：openai-images、apimart-images、xai-imagine-image、bailian-images、volcengine-seedream-image、google-gemini-images、midjourney-gateway、minimax-image、tencent-tokenhub-image',
    },
    {
      key: 'spark_image 工具',
      value: 'mcp__spark_image__generate_image（参数：prompt、size、n 1-4、filename、extraJson）',
    },
    { key: 'spark_image 产物目录', value: '<workspace>/.spark-artifacts/images' },
    { key: '超时', value: '同步 10 分钟；异步轮询间隔 5 秒' },
    {
      key: 'imageProvider → mediaProvider',
      value:
        'openai→openai-compatible · seeddance/seedance/volcengine→volcengine-ark · gemini/google→google-generative-ai · 其它→custom',
    },
  ],
  howTo: {
    name: '在 Spark Work 中接入 OpenAI 图片生成',
    description: '从创建 Provider 到让 Agent 生成第一张图',
    totalTime: 'PT3M',
    steps: [
      '打开「设置 → Provider」，点「新建」',
      '「模型类型」选「生图模型」，图片 API 源选 OpenAI Images，preset 选 OpenAI',
      '填入 Model ID（如 gpt-image-2）与 API Key',
      '保存后不需要依赖「测试连接」——它只 ping 文本端点',
      '新会话里让 Agent 画图；若同时配了统一媒体 Provider，它会改用 mcp__spark_media__generate_image',
      '产物文件在 <workspace>/.spark-artifacts/images（或 media/images）下',
    ],
  },
  aiSummary:
    'Spark Work 图片生成 Provider：modelType=image 携带 imageProvider（openai/apimart/openrouter/gemini/seeddance/bailian/zhipu/xai/custom）与 imageApiType（sync/async/auto，缺省 sync），保存时同步到 mediaProvider / mediaApiType / mediaCapabilities。' +
    '运行时优先注入统一媒体 MCP spark_media（14 工具，图片也走它）；只有统一媒体栈解析为空时才兜底注入 spark_image（单工具 mcp__spark_image__generate_image，参数 prompt/size/n/filename/extraJson，产物 .spark-artifacts/images）。' +
    '内置 9 条生图预设。各渠道 size 处理不同：OpenAI 比例映射像素尺寸、xAI 删除 size 改用 aspect_ratio、百炼用星号尺寸且同步/异步路径不同、OpenRouter 走 chat/completions 并写 image_config.aspect_ratio。' +
    'Provider 选择不看健康状态，取第一条 enabled + modelType=image + 有 Key + 有默认模型的记录。',
  Body,
}

export default imageProviders
