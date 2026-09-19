import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      视频工作台把画布上的一个视频节点变成一站式处理台：资源收集、关键帧提取、参数化剪辑、
      多轨拼接与导出，产物再回填成画布节点。它不是独立的剪辑软件，而是画布视频流水线的延伸；
      所有产物都落回画布，血缘关系保留。
    </p>

    <h2 id="entry">1. 进入视频工作台</h2>
    <p>入口只有一个：视频节点（或产物是视频的操作节点）上的「视频编辑」。</p>
    <ul>
      <li>
        <strong>节点悬浮工具条</strong>：选中视频节点后出现在节点顶部，按钮是「视频编辑」；
        旁边还有「尺寸与压缩」「分离音频」「提取首尾帧」。
      </li>
      <li>
        <strong>节点右键菜单</strong>：视频节点 / 视频工作台节点 / 产物为视频的操作节点上，
        菜单第一项就是「视频编辑」，下面是「尺寸与压缩」。
      </li>
    </ul>
    <div className="docs-callout">
      <strong>别混淆三个入口</strong>：
      <ul>
        <li>
          <strong>视频编辑</strong> → 打开全屏视频工作台（本文档的主题）。
        </li>
        <li>
          <strong>分离音频 / 提取首尾帧</strong> → 不打开工作台，而是在画布上创建对应的操作节点 （
          <code>extract_audio</code> / <code>extract_first_last_frames</code>）；
          「提取首尾帧」会直接开始运行，「分离音频」需要你在操作面板上确认后提交。
        </li>
        <li>
          <strong>尺寸与压缩</strong> → 独立的缩放与码率压缩弹窗，通过 ffmpeg 物化一个新子节点。
        </li>
      </ul>
    </div>
    <p>
      打开操作节点上的「视频编辑」时，应用会自动解析它的主产物视频；
      如果产物还没物化成真实节点，会先走一次幂等的「展开产物」流程再打开工作台。
    </p>

    <h2 id="tabs">2. 四个阶段与四个 Tab</h2>
    <p>
      工作台顶部有一条阶段条：<strong>00 资源 → 01 素材分析 → 02 剪辑处理 → 03 产物检查</strong>，
      它标出的是推荐工作顺序；真正切换面板的是下面的 Tab 组，四个 Tab 与阶段一一对应：
    </p>
    <table>
      <thead>
        <tr>
          <th>Tab</th>
          <th>内部值</th>
          <th>用途</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>资源</strong>
          </td>
          <td>
            <code>resources</code>
          </td>
          <td>收集上游产物、从画布选择、从本机导入素材，并设置主视频</td>
        </tr>
        <tr>
          <td>
            <strong>关键帧</strong>
          </td>
          <td>
            <code>frames</code>
          </td>
          <td>按策略抽帧、手动截取当前帧、批量导入画布</td>
        </tr>
        <tr>
          <td>
            <strong>剪辑</strong>
          </td>
          <td>
            <code>edit</code>
          </td>
          <td>转码、等分切割、音频分离、变速、倒放、画面裁剪</td>
        </tr>
        <tr>
          <td>
            <strong>产物</strong>
          </td>
          <td>
            <code>output</code>
          </td>
          <td>查看剪辑产物，导出轨道，回填画布</td>
        </tr>
      </tbody>
    </table>
    <p>
      工作台状态持久化在节点数据的 <code>videoWorkbench</code> 字段里（工程结构版本
      <code>schemaVersion: 2</code>）：当前 Tab、缩放、滚动位置、吸附开关、提取配置、
      关键帧、产物、资源面板、轨道与片段都在里面，关掉再打开会恢复现场。 编辑会以 300ms
      防抖写回节点，撤销历史最多保留 100 步。
      旧版本（v1）的工程会自动迁移；如果节点的工程版本高于当前应用支持的版本，
      工作台进入只读模式并提示「该工程来自更高版本，当前仅允许查看，不能覆盖保存」。
    </p>

    <h2 id="resources">3. 资源面板与多轨时间线</h2>
    <p>
      顶部「添加资源」下拉最多五项（按当前节点可用能力出现），对应三种资源来源；
      资源列表本身还有搜索框和 全部 / 视频 / 图片 / 音频 四个筛选 chip：
    </p>
    <table>
      <thead>
        <tr>
          <th>菜单项</th>
          <th>来源值</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>从本机添加资源</td>
          <td>
            <code>local</code>
          </td>
          <td>选择本地媒体文件，落到项目目录</td>
        </tr>
        <tr>
          <td>从画布选择资源</td>
          <td>
            <code>canvas</code>
          </td>
          <td>把画布上的图片 / 视频节点导入资源面板</td>
        </tr>
        <tr>
          <td>按上级连线自动收集</td>
          <td>
            <code>upstream</code>
          </td>
          <td>
            收集上游连线节点的首选产物；资源面板右上角的「自动收集上游」开关（默认开）会在打开工作台时自动执行一次
          </td>
        </tr>
        <tr>
          <td>从本机设置主视频 / 从画布设置主视频…</td>
          <td>—</td>
          <td>切换这个工作台的源视频，不影响已有轨道</td>
        </tr>
      </tbody>
    </table>
    <p>
      素材分三类：<code>video</code>、<code>image</code>、<code>audio</code>。
      图片按静帧使用，默认时长 8 秒（工程设置里的 <code>defaultImageDurationSec</code>，
      可以在轨道上拖动片段边缘改）。画布节点被删除后，引用它的资源会标记为 missing，
      轨道上的片段显示为红色缺失态。
    </p>
    <p>
      工作台的时间线是<strong>多轨时间线</strong>，默认只有一条 <code>video</code>{' '}
      轨（名为「主视频」）：
    </p>
    <ul>
      <li>
        <strong>轨道类型</strong>：<code>video</code> / <code>overlay</code> / <code>audio</code> /
        <code>text</code> / <code>subtitle</code>。工具栏提供「叠加轨」和「音频轨」两个新建按钮，
        命名规则是「叠加 2」「音频 2」这样的递增名。
      </li>
      <li>
        <strong>轨道操作</strong>：拖拽排序、折叠 / 展开、双击重命名、显示 / 隐藏、静音、
        独奏、锁定、删除轨道。
      </li>
      <li>
        <strong>放置规则</strong>：video / overlay 轨接受视频和图片素材；audio 轨接受音频素材，
        也可以接视频（取其音轨）；text / subtitle 轨放纯文本片段。 只有 video
        主轨不允许片段重叠，其他轨允许重叠。
      </li>
      <li>
        <strong>工程默认值</strong>：<code>1920×1080</code>、<code>30fps</code>、 背景{' '}
        <code>#000000</code>、图片默认 8 秒、音频采样率 48000。
      </li>
      <li>
        <strong>片段模型</strong>：每个片段记录所在轨道、时间线起点、源入点 / 出点、
        应用速度后的时长、启用状态，以及 speed / transform（位置、缩放、旋转、透明度、镜像、裁剪）、
        audio（增益、静音、声道平衡、保持音调）、淡入淡出和文本设置等字段。
      </li>
    </ul>

    <h2 id="depth">4. 深度视频转换（本地执行）</h2>
    <p>
      深度视频转换把视频逐帧转成深度图序列再编码回视频，输出「近白远黑」的灰度视频，
      常用在二次创作、景深特效和 3D 感视觉上。它是画布上的一个操作节点 （
      <code>video_depth_map</code>），也可以直接从节点右键的「特色功能 → 媒体工具」创建。
    </p>
    <p>
      <strong>完全本地</strong>，这是它和云端视频能力最大的差别：
    </p>
    <ul>
      <li>
        依赖可选功能组件 <code>local-depth</code>（本地深度处理），它包含推理 Runtime 与
        <code>model.depth-anything-v2-small-int8-*</code> 模型。首次提交任务时会自动开始安装，
        进度显示为「资源下载中：正在安装本地深度 Runtime 与模型」；装好后推理、解码、编码全部离线。
      </li>
      <li>视频文件不上传云端，不消耗任何多媒体 Provider 的额度。</li>
      <li>
        面板上没有 Prompt 输入、没有云端 Provider 与模型参数，只显示本地组件的状态，
        提交按钮是「生成深度视频转换」。
      </li>
      <li>
        <strong>同时只允许一个任务</strong>：正在跑时再次提交会直接报
        「已有深度视频转换任务正在运行，请等待完成或先取消当前任务」。
      </li>
      <li>
        输入路径必须在画布或已登记工作区目录内，否则会被拒绝
        （「深度视频转换输入路径不在允许的画布或工作区目录内」）。
      </li>
    </ul>
    <p>输出规格：</p>
    <ul>
      <li>保持源视频的分辨率与帧率（旋转 90° 的素材会自动交换宽高）。</li>
      <li>
        H.264（libx264）编码、<code>+faststart</code>；尺寸为偶数时用 <code>yuv420p</code>，
        否则回退 <code>yuv444p</code>，保证兼容性。
      </li>
      <li>
        <strong>默认移除音轨</strong>（编码参数带 <code>-an</code>）； 底层支持保留音频（此时音轨用
        AAC 重编码并按源时长截断），但面板默认不开启。
      </li>
      <li>
        产物写到 <code>userData/.spark-artifacts/media/canvas-depth/&lt;任务 id&gt;.mp4</code>，
        成功后作为视频节点落回画布，并带上任务信息。
      </li>
    </ul>
    <p>面板上的「深度渲染」参数（都能在提交前调）：</p>
    <table>
      <thead>
        <tr>
          <th>参数</th>
          <th>可选值 / 范围</th>
          <th>默认</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>反相深度</td>
          <td>开关</td>
          <td>关</td>
          <td>
            输出 <code>255 - 深度</code>，得到「近暗远亮」的经典 depth map 观感
          </td>
        </tr>
        <tr>
          <td>伪彩色</td>
          <td>灰度 / 热力彩虹（turbo）/ 青绿渐变（viridis）</td>
          <td>灰度</td>
          <td>灰度输出单通道；伪彩色输出 RGB</td>
        </tr>
        <tr>
          <td>时序平滑</td>
          <td>0% – 100%，步长 5%</td>
          <td>25%</td>
          <td>越大画面越稳定，过高会产生运动拖影</td>
        </tr>
        <tr>
          <td>对比度</td>
          <td>0 – 10，步长 0.5</td>
          <td>2</td>
          <td>归一化的分位裁剪百分比，越大明暗对比越强，低值偏雾状层次</td>
        </tr>
      </tbody>
    </table>

    <h2 id="keyframes">5. 关键帧提取</h2>
    <p>「关键帧」Tab 里选策略后点「提取关键帧」。三种策略的真实实现是：</p>
    <table>
      <thead>
        <tr>
          <th>策略</th>
          <th>界面名</th>
          <th>实现</th>
          <th>参数</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>scene</code>
          </td>
          <td>场景突变</td>
          <td>
            ffmpeg <code>select='gt(scene,阈值)'</code>，取画面变化大的瞬间
          </td>
          <td>灵敏度阈值 0.05 – 0.8（步长 0.05，默认 0.3，越小越敏感）</td>
        </tr>
        <tr>
          <td>
            <code>iframe</code>
          </td>
          <td>I 帧</td>
          <td>
            ffmpeg <code>select='eq(pict_type,I)'</code>，取编码关键帧
          </td>
          <td>无（数量由编码决定，速度最快）</td>
        </tr>
        <tr>
          <td>
            <code>uniform</code>
          </td>
          <td>均匀采样</td>
          <td>按固定时间间隔抽帧</td>
          <td>采样间隔 0.2 – 60 秒（步长 0.1，默认 10）</td>
        </tr>
      </tbody>
    </table>
    <p>
      三者共用「最大帧数」上限（滑杆 5 – 50，默认 20）。<strong>超限退化规则</strong>是： 如果 scene
      / iframe 抽出的帧数超过最大帧数，会丢弃这一轮产物， 自动改用均匀采样重跑一次，间隔取「时长 ÷
      最大帧数」；这是为了避免一次拉出几百张帧把画布挤爆。
    </p>
    <p>除了自动提取，还能手动补帧：</p>
    <ul>
      <li>
        播放到某一帧，点「截取当前帧到关键帧列表」按当前预览源截取单帧（预览哪个资源就截哪个）。
      </li>
      <li>
        列表里的缩略图默认点击跳转到该时间点；切到「多选」后可勾选、全选、删除选中、导入画布。
      </li>
    </ul>
    <p>
      <strong>导入画布的规则</strong>：只导入尚未导入过的帧，按时间戳升序排列； 节点标题是「关键帧
      01 / 关键帧 02 …」（两位补零），宽度固定 320， 高度按帧的原始像素比例计算，落点按 4
      列网格排布、间距 24 像素； 已经导入过的帧在缩略图上显示「已导入画布」标记。
    </p>

    <h2 id="edit">6. 剪辑处理</h2>
    <p>
      「剪辑」Tab 只做<strong>参数型处理</strong>
      ；时间裁剪、入出点和分割在下面的多轨时间线上直接操作 （面板顶部就有这条提示）。
    </p>
    <table>
      <thead>
        <tr>
          <th>功能</th>
          <th>参数</th>
          <th>说明 / 默认</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>转码 / 格式转换</td>
          <td>格式 MP4 / WebM / MOV / GIF 动图</td>
          <td>默认 MP4；选 GIF 时按钮变成「生成 GIF」，编码与 CRF 不参与</td>
        </tr>
        <tr>
          <td></td>
          <td>视频编码 H.264（libx264）/ H.265（libx265）/ VP9（libvpx-vp9）</td>
          <td>默认 H.264；GIF 模式下下拉不可用</td>
        </tr>
        <tr>
          <td></td>
          <td>质量 CRF 18 – 32（越小越高）</td>
          <td>默认 23；GIF 模式下此项隐藏</td>
        </tr>
        <tr>
          <td></td>
          <td>缩放比例 10% – 100%（步长 5）</td>
          <td>默认 100%；不为 100% 且已探测到尺寸时会显示目标分辨率预览</td>
        </tr>
        <tr>
          <td>等分切割</td>
          <td>每段时长 2 – 120 秒</td>
          <td>默认 10 秒；按总时长预估段数，一次操作产出多段文件</td>
        </tr>
        <tr>
          <td>音频分离</td>
          <td>原轨抽取（copy）/ MP3 / AAC-M4A / WAV</td>
          <td>默认原轨抽取（最快无损）；产物按扩展名回填为音频节点</td>
        </tr>
        <tr>
          <td>变速</td>
          <td>0.25x – 4x（步长 0.25）</td>
          <td>默认 2x；按钮随数值在「加速」「慢放」之间切换，结果是新文件</td>
        </tr>
        <tr>
          <td>视频倒放</td>
          <td>—</td>
          <td>生成倒放视频，音频一并倒放</td>
        </tr>
        <tr>
          <td>画面裁剪</td>
          <td>X / Y / 宽 / 高（像素），或预览区框选</td>
          <td>宽高至少 2×2，且不能超出原视频画面；框选会回填像素值</td>
        </tr>
      </tbody>
    </table>
    <p>
      所有剪辑操作走同一条 ffmpeg 处理通道（<code>video:process</code>）， 进度通过{' '}
      <code>stream:video:process-progress</code> 实时回传，执行期间显示百分比。
      产物会记进「产物」Tab，不会自动替换源视频。
    </p>

    <h2 id="timeline">7. 时间线的编辑与播放</h2>
    <p>多轨时间线的工具栏从左到右是：</p>
    <ul>
      <li>
        <strong>撤销 / 重做</strong>：<code>Cmd/Ctrl+Z</code> 与 <code>Cmd/Ctrl+Shift+Z</code>，
        历史最多 100 步。
      </li>
      <li>
        <strong>分割</strong>：必须恰好选中 1 个片段，在播放头位置切成两段。
      </li>
      <li>
        <strong>复制所选 / 删除所选</strong>：复制是 <code>Cmd/Ctrl+D</code>， 删除是{' '}
        <code>Delete</code> / <code>Backspace</code>；<code>Esc</code> 取消选中。
      </li>
      <li>
        <strong>叠加轨 / 音频轨</strong>：新增轨道。
      </li>
      <li>
        <strong>关键帧 / 单项处理 / 产物</strong>：跳到对应 Tab。
      </li>
      <li>
        <strong>磁吸主轨</strong>（默认开）：主视频轨上拖动或删除片段时自动排序并闭合空隙。
      </li>
      <li>
        <strong>吸附</strong>（默认开）：拖动时吸附播放头、标记点和片段边界。
      </li>
      <li>
        <strong>缩放</strong>：8 – 160 像素/秒（工程默认 48），只影响显示，不改变时长。
        标尺左侧显示当前「N 条轨道 / N 个素材」。
      </li>
    </ul>
    <p>片段上的操作：</p>
    <ul>
      <li>拖动片段左右移动位置，可以拖到其它兼容轨道上（类型不兼容或轨道锁定时会被拒绝）。</li>
      <li>拖动片段左 / 右边缘调整入点与出点。</li>
      <li>
        悬停片段出现「复制片段」「删除片段」两个快捷按钮；点击选中，支持多选（最后点选的那段是主选）。
      </li>
      <li>片段标题显示资源名与时长；资源缺失或上游任务失败会有独立的视觉状态。</li>
    </ul>
    <p>播放控制：</p>
    <ul>
      <li>空格键播放 / 暂停；播放头可以点击标尺定位，也可以直接拖动。</li>
      <li>
        上一帧 / 下一帧按钮，或 <code>←</code> / <code>→</code> 逐帧步进（帧长按源视频帧率换算）。
      </li>
      <li>
        <code>Shift</code> + <code>←</code> / <code>→</code> 前后跳 5 秒；<code>Home</code>{' '}
        回到开头；<code>Esc</code> 关闭工作台。
      </li>
      <li>播放速率 0.25x / 0.5x / 1x / 2x（含慢放）。</li>
    </ul>
    <p>
      选中片段后，播放器工具条上会出现四个针对该片段的动作
      （按钮文字分别是「复制」「添加到画布」「替换当前」「删除」）：
    </p>
    <ul>
      <li>
        <strong>复制</strong>：在同轨道复制一份该片段。
      </li>
      <li>
        <strong>添加到画布</strong>：把该片段落成新的画布视频节点（带入出点时先 trim）。
      </li>
      <li>
        <strong>替换当前</strong>：用该片段替换打开工作台时那个视频节点。
      </li>
      <li>
        <strong>删除</strong>：从轨道移除（不影响源资源）。
      </li>
    </ul>
    <p>
      多选片段时以「主选分段」为基准操作，工具条会显示当前选中了几段。
      连播预览按片段顺序在当前工程内播放，切段会重置 <code>&lt;video&gt;</code> 元素，
      应用会重新应用当前播放速率。
    </p>

    <h2 id="output">8. 产物回填与导出</h2>
    <p>
      「产物」Tab 列出最近的剪辑产物（最多保留 20 条，新的在最前）。 摘要是「转码 MP4 50%」「分割 ×
      10s」「变速 2x 加速」「倒放」「分离音频 (MP3)」 「画面裁剪 1280×720」「轨道合成（N
      段）」这类描述，每条带时间戳，并有三个动作：
    </p>
    <ul>
      <li>
        <strong>预览</strong>：在新窗口打开产物文件。
      </li>
      <li>
        <strong>添加到画布</strong>：在画布上新建一个节点承载该产物。
      </li>
      <li>
        <strong>替换当前</strong>：直接替换打开工作台的那个视频节点（原始素材仍在资源面板里）。
      </li>
    </ul>
    <p>
      落地节点的媒体类型不是写死的，而是按产物文件扩展名推断：
      <code>.mp4</code> / <code>.webm</code> / <code>.mov</code> / <code>.m4v</code> /
      <code>.avi</code> / <code>.mkv</code> → 视频节点，
      <code>.png</code> / <code>.jpg</code> / <code>.jpeg</code> / <code>.webp</code> /
      <code>.gif</code> → 图片节点，
      <code>.mp3</code> / <code>.wav</code> / <code>.m4a</code> / <code>.aac</code> /
      <code>.ogg</code> / <code>.flac</code> / <code>.ac3</code> / <code>.mka</code> → 音频节点。
      所以「分离音频」的产物直接是音频节点，GIF 转码产物是图片节点。
    </p>
    <p>
      产物面板顶部还有「导出当前轨道」：把轨道上的片段按顺序处理并合成一条视频，
      产物摘要写作「轨道合成（N 段）」。这里有两个必须知道的限制：
    </p>
    <ul>
      <li>
        <strong>导出只覆盖主视频轨</strong>。它走的是主轨到内部结构的映射，
        叠加轨与音频轨的片段不参与导出；主轨为空时点按钮不会有产物生成。
      </li>
      <li>
        <strong>主轨里不能含图片资源</strong>。导出会先把每个片段按入出点 trim，再 concat；
        遇到图片或缺失资源会直接报「当前轨道含有无法导出的图片或缺失资源」。
        图片片段适合当预览占位或分段单独落地，不适合参与整轨导出。
      </li>
    </ul>

    <h2 id="deps">9. 依赖与排错</h2>
    <ul>
      <li>
        <strong>FFmpeg 是可选组件</strong>。工作台探测到缺失时顶部会显示 「FFmpeg
        未安装，关键帧提取和本地剪辑暂不可用」并提供「下载并安装」按钮 （走{' '}
        <code>ffmpeg:install</code>，安装进度实时回传）；装完自动变为就绪， 也可以去「设置 →
        完整性」里安装、修复或做完整性校验。
      </li>
      <li>
        <strong>「正在探测视频信息…」长时间不动</strong>：多半是 FFmpeg 缺失或源文件路径不可访问。
        探测失败时面板会明确说「视频信息探测失败，剪辑 / 转码需要 FFmpeg，关键帧提取可能受限」。
      </li>
      <li>
        <strong>关键帧提取按钮点了没反应</strong>：按钮只在 FFmpeg 就绪时可用；
        视频信息还没探测完会提示「视频信息尚未就绪，请稍候再试」。
      </li>
      <li>
        <strong>工作台是只读的</strong>：说明这个节点的工程版本高于当前应用，
        只允许查看不能覆盖保存；升级应用后再编辑。
      </li>
      <li>
        <strong>深度视频转换失败</strong>：先看错误信息。涉及本地深度 Runtime 加载失败时，
        应用会自动上报组件健康状态，去「设置 → 完整性」修复 <code>local-depth</code> 即可；
        取消或失败不会留下半成品文件（临时产物会被清理）。
      </li>
      <li>
        <strong>产物过大</strong>：用「剪辑」Tab 的转码把缩放调到 50%–75%、CRF 调到 18–23，
        或用节点工具条的「尺寸与压缩」再压一次。
      </li>
    </ul>
  </>
)

const page: DocsPageContent = {
  slug: 'canvas-video-workbench',
  toc: [
    { id: 'entry', title: '1. 进入视频工作台', level: 2 },
    { id: 'tabs', title: '2. 四个阶段与四个 Tab', level: 2 },
    { id: 'resources', title: '3. 资源面板与多轨时间线', level: 2 },
    { id: 'depth', title: '4. 深度视频转换（本地执行）', level: 2 },
    { id: 'keyframes', title: '5. 关键帧提取', level: 2 },
    { id: 'edit', title: '6. 剪辑处理', level: 2 },
    { id: 'timeline', title: '7. 时间线的编辑与播放', level: 2 },
    { id: 'output', title: '8. 产物回填与导出', level: 2 },
    { id: 'deps', title: '9. 依赖与排错', level: 2 },
  ],
  faq: [
    {
      question: '深度视频转换会把视频上传到云端吗？',
      answer:
        '不会。它用本地的 local-depth 组件（Depth Anything V2 Small INT8 ONNX 模型 + 推理 Runtime）逐帧处理，首次提交任务时自动下载安装，之后可离线运行，也不消耗任何多媒体 Provider 额度。',
    },
    {
      question: '工作台支持多条轨道吗？',
      answer:
        '支持。时间线是多轨结构，默认一条 video 主视频轨，可以再加叠加轨（overlay）和音频轨（audio）；模型里还定义了 text / subtitle 轨。轨道可以排序、重命名、静音、独奏、隐藏、锁定和删除。',
    },
    {
      question: '导出会包含所有轨道吗？',
      answer:
        '不会。当前的「导出当前轨道」只覆盖主视频轨（走主轨到内部结构的映射），叠加轨和音频轨不参与导出；而且主轨里不能含图片资源，否则会直接报错。',
    },
    {
      question: '关键帧提取的策略怎么选？',
      answer:
        'scene（场景突变）适合教程 / 演示类视频，阈值越小越敏感；iframe（I 帧）最快但数量由编码决定；uniform（均匀采样）数量可控，最小间隔 0.2 秒，默认 10 秒。',
    },
    {
      question: '关键帧太多怎么办？',
      answer:
        'scene / iframe 抽出超过「最大帧数」（默认 20，可调 5–50）时会自动退化：丢弃本轮结果，改用均匀采样重跑，间隔取「时长 ÷ 最大帧数」。',
    },
    {
      question: '工作台是可撤销的吗？改动会立刻写进画布吗？',
      answer:
        '可撤销，历史最多 100 步（Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z）。改动会以 300ms 防抖写回节点数据，节点数据随画布保存机制落库，所以关掉工作台再打开会恢复现场。',
    },
  ],
  quickReference: [
    { key: '入口', value: '视频节点工具条 / 右键「视频编辑」（操作节点取主产物视频）' },
    { key: '阶段条', value: '00 资源 → 01 素材分析 → 02 剪辑处理 → 03 产物检查' },
    { key: 'Tab', value: '资源（resources）/ 关键帧（frames）/ 剪辑（edit）/ 产物（output）' },
    { key: '工程版本', value: 'schemaVersion 2（300ms 防抖保存，撤销历史 100 步）' },
    { key: '工程默认值', value: '1920×1080 / 30fps / 背景 #000000 / 图片静帧 8 秒 / 音频 48000Hz' },
    { key: '轨道类型', value: 'video / overlay / audio / text / subtitle' },
    { key: '时间轴缩放', value: '8 – 160 像素/秒，默认 48' },
    { key: '播放速率', value: '0.25x / 0.5x / 1x / 2x' },
    {
      key: '关键帧策略',
      value: 'scene（默认阈值 0.3）/ iframe / uniform（默认间隔 10s，最小 0.2s）',
    },
    { key: '最大帧数', value: '默认 20，可调 5 – 50；超限自动退化为均匀采样' },
    { key: '关键帧回填', value: '标题「关键帧 01」，宽 320 按原比例算高，4 列网格、间距 24' },
    {
      key: '转码选项',
      value: 'MP4/WebM/MOV/GIF，H.264/H.265/VP9，CRF 18–32（默认 23），缩放 10%–100%',
    },
    { key: '等分切割', value: '每段 2 – 120 秒（默认 10）' },
    { key: '音频分离格式', value: '原轨 copy / MP3 / AAC-M4A / WAV（默认 copy）' },
    { key: '变速与倒放', value: '0.25x – 4x（步长 0.25，默认 2）；倒放连带音频' },
    { key: '画面裁剪', value: '框选或像素输入，最小 2×2，不得越界' },
    { key: '深度视频输出', value: 'H.264 + faststart，默认移除音轨，默认灰度；并发上限 1' },
    { key: '深度渲染参数', value: '反相 / 伪彩色（turbo、viridis）/ 时序平滑 25% / 对比度 2' },
    { key: '导出限制', value: '只导出主视频轨；主轨含图片资源时导出失败' },
    {
      key: '产物落盘',
      value: 'userData/.spark-artifacts/media/ 下各功能子目录（canvas-depth、video-workbench 等）',
    },
  ],
  howTo: {
    name: '用视频工作台完成一次抽帧、剪辑与回填',
    description: '从视频节点进入工作台，抽取关键帧、剪辑产物并落回画布',
    totalTime: 'PT10M',
    steps: [
      '在画布上选中视频节点，点工具条或右键菜单的「视频编辑」打开工作台（FFmpeg 缺失时先点顶部「下载并安装」）',
      '在「资源」Tab 用「按上级连线自动收集」或「从本机添加资源」准备素材，再把素材拖到兼容的轨道上',
      '在多轨时间线上拖动片段排序、拖边缘调整入出点；需要切开就在播放头处点「分割」',
      '切到「关键帧」Tab，选 scene / I 帧 / 均匀采样，调好阈值与最大帧数后点「提取关键帧」',
      '在多选模式下勾选需要的帧，点「导入画布」批量落成图片节点',
      '切到「剪辑」Tab 做转码、等分切割、变速、倒放或画面裁剪',
      '在「产物」Tab 里点「添加到画布」或「替换当前」，把产物落回画布继续创作',
      '需要整段成片时，确认主视频轨里没有图片资源，再点「导出当前轨道」',
    ],
  },
  aiSummary:
    'Spark Work 视频工作台实测：入口为视频节点工具条 / 右键「视频编辑」（与「分离音频」「提取首尾帧」「尺寸与压缩」的区别）；阶段条 00 资源 / 01 素材分析 / 02 剪辑处理 / 03 产物检查与四个 Tab（resources / frames / edit / output）；' +
    '工程结构 schemaVersion 2（默认 1920×1080、30fps、图片静帧 8 秒、音频 48000Hz，300ms 防抖保存，撤销 100 步，旧 v1 自动迁移，更高版本只读）；' +
    '多轨时间线（轨道类型 video/overlay/audio/text/subtitle，默认一条主视频轨，可加叠加轨与音频轨，轨道支持排序/重命名/静音/独奏/隐藏/锁定/删除，主轨禁止重叠，缩放 8–160 px/s 默认 48，磁吸主轨与吸附开关，分割/复制/删除/撤销重做快捷键）；' +
    '资源面板三来源（upstream/canvas/local）与缺失资源态；深度视频转换完全本地（local-depth 组件含 depth-anything-v2-small-int8 模型，H.264 + faststart，默认 -an，并发上限 1，渲染参数反相/伪彩色/时序平滑 25%/对比度 2）；' +
    '关键帧三策略与超限退化、4 列网格回填；剪辑能力（转码 MP4/WebM/MOV/GIF + H.264/H.265/VP9 + CRF 18–32 + 缩放 10–100%、等分切割 2–120s、音频分离 copy/MP3/AAC/WAV、变速 0.25–4x、倒放、裁剪 ≥2×2）；' +
    '导出只覆盖主视频轨且不允许图片资源；产物按扩展名推断为视频/图片/音频节点回填；FFmpeg 可选组件与排错路径。',
  Body,
}

export default page
