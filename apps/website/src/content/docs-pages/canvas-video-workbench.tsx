import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Work 的<strong>视频工作台</strong>把画布上的视频节点变成一个一站式处理台：从素材分析、
      深度视频转换、关键帧提取，到转码、剪辑、音频分离和多段拼接，都在工作台里完成，
      产物再回填为画布节点继续创作。它不是一个独立的视频编辑器，而是画布视频流水线的延伸。
    </p>

    <h2 id="entry">1. 怎么进入视频工作台</h2>
    <p>
      在画布上选中一个视频节点，节点悬浮工具栏会出现「视频编辑」和「分离音频」两个快捷按钮；
      也可以通过节点右键菜单进入。打开后是一个全屏工作台，顶部四个 Tab 对应视频处理的四个阶段。
    </p>

    <h2 id="tabs">2. 四个工作台 Tab</h2>
    <table>
      <thead>
        <tr><th>Tab</th><th>用途</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>资源</strong></td><td>多源资源面板：自动收集上游节点产物，也可从画布或本机导入素材。</td></tr>
        <tr><td><strong>素材分析（关键帧）</strong></td><td>从视频里提取关键帧，结果可批量回填为画布图片节点。</td></tr>
        <tr><td><strong>剪辑处理</strong></td><td>转码、切割、音频分离、变速、倒放、画面裁剪等参数化处理。</td></tr>
        <tr><td><strong>产物检查</strong></td><td>查看剪辑 / 转码产物，并把结果回填到画布。</td></tr>
      </tbody>
    </table>

    <h2 id="depth">3. 深度视频转换（本地 Depth Anything V2）</h2>
    <p>
      深度视频转换把视频交给本地的 <strong>Depth Anything V2</strong> 模型，生成「近白远黑」的深度视频——
      越靠近镜头越亮、越远越暗，常用于二次创作、景深特效和 3D 感视觉。
    </p>
    <p>它和其它视频能力最大的不同是<strong>完全本地执行</strong>：</p>
    <ul>
      <li>首次运行会自动下载模型包（通过可选资源安装中心），之后离线运行。</li>
      <li>视频文件<strong>不会上传云端</strong>，敏感素材不出本机。</li>
      <li>不消耗任何多媒体 Provider 的额度。</li>
    </ul>

    <h2 id="keyframes">4. 关键帧提取</h2>
    <p>在「素材分析」Tab 里选一种策略提取关键帧：</p>
    <table>
      <thead>
        <tr><th>策略</th><th>原理</th><th>适合</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>scene</strong></td><td>场景突变检测（阈值 0~1，默认 0.3）</td><td>剧情 / 分镜变化丰富的视频</td></tr>
        <tr><td><strong>iframe</strong></td><td>提取编码关键帧（I 帧）</td><td>结构性强的视频</td></tr>
        <tr><td><strong>uniform</strong></td><td>均匀采样（按固定时间间隔，最小 0.2 秒）</td><td>需要均匀分布的快照</td></tr>
      </tbody>
    </table>
    <p>
      当 scene / iframe 提取结果超过上限（默认 20 帧）时，会自动退化为均匀采样，避免一次拉出过多帧。
      提取出来的帧按时间戳排序，以固定宽度和原始比例计算高度，按 4 列网格批量回填到画布，
      供后续生图、反推或拼接继续使用。
    </p>

    <h2 id="edit">5. 剪辑处理</h2>
    <p>「剪辑处理」Tab 覆盖常见的参数化处理：</p>
    <ul>
      <li><strong>转码 / 格式转换</strong>：MP4 / WebM / MOV / GIF，编码可选 H.264 / H.265 / VP9，可调 CRF 质量和缩放比例。</li>
      <li><strong>等分切割</strong>：按固定时长把视频切成多段。</li>
      <li><strong>音频分离</strong>：输出 copy / MP3 / AAC / WAV，对应画布的「分离音频」能力。</li>
      <li><strong>画面处理</strong>：变速（0.25x ~ 4x）、视频倒放、画面裁剪（预览区框选或像素精确输入）。</li>
    </ul>

    <h2 id="timeline">6. 多段时间线轨道</h2>
    <p>
      工作台内置<strong>主时间线轨道</strong>，可以把多个片段按顺序拼接成一条轨道，支持排序、切分、
      调整时长和连播预览。适合把关键帧生成的多个短片段串成连续画面，或把剪辑产物组合成完整成片，
      再整体回填到画布。
    </p>

    <h2 id="capabilities">7. 对应的画布能力</h2>
    <p>视频工作台背后是画布的一组能力节点，也可以在 AI 操作面板里直接调用：</p>
    <ul>
      <li><code>video_depth_map</code> —— 深度视频转换（本地）</li>
      <li><code>video_edit</code> —— 视频编辑（转码 / 剪辑 / 裁剪等）</li>
      <li><code>extract_audio</code> —— 音频分离</li>
      <li><code>image-to-video</code> / <code>text-to-video</code> / <code>video-extend</code> —— 图生视频 / 文生视频 / 视频扩展</li>
    </ul>
  </>
)

const page: DocsPageContent = {
  slug: 'canvas-video-workbench',
  toc: [
    { id: 'entry', title: '怎么进入视频工作台', level: 2 },
    { id: 'tabs', title: '四个工作台 Tab', level: 2 },
    { id: 'depth', title: '深度视频转换（本地 Depth Anything V2）', level: 2 },
    { id: 'keyframes', title: '关键帧提取', level: 2 },
    { id: 'edit', title: '剪辑处理', level: 2 },
    { id: 'timeline', title: '多段时间线轨道', level: 2 },
    { id: 'capabilities', title: '对应的画布能力', level: 2 },
  ],
  faq: [
    {
      question: '深度视频转换会把视频上传到云端吗？',
      answer:
        '不会。深度视频转换使用本地 Depth Anything V2 模型，首次运行自动下载模型后完全离线执行，视频文件不出本机，也不消耗多媒体 Provider 额度。',
    },
    {
      question: '关键帧提取能批量变成画布节点吗？',
      answer:
        '能。提取的关键帧按时间戳排序、按原始比例计算高度，以 4 列网格批量回填为画布图片节点，可直接用于后续生图、反推或拼接。',
    },
    {
      question: '关键帧太多怎么办？',
      answer:
        'scene / iframe 策略提取结果超过上限（默认 20 帧）时会自动退化为均匀采样，避免一次拉出过多帧导致画布拥挤。',
    },
  ],
  aiSummary:
    'Spark Work 视频工作台：画布视频节点的全屏一站式处理台，四个 Tab（资源 / 关键帧 / 剪辑处理 / 产物检查）。深度视频转换基于本地 Depth Anything V2，首次下载模型后完全离线、视频不上云、不消耗 Provider 额度。关键帧提取支持 scene（场景突变）/ iframe（I 帧）/ uniform（均匀采样）三种策略，超 20 帧自动退化均匀，结果按 4 列网格回填画布。剪辑处理覆盖转码（MP4/WebM/MOV/GIF，H.264/H.265/VP9）、等分切割、音频分离（copy/MP3/AAC/WAV）、变速（0.25~4x）、倒放、画面裁剪。主时间线轨道支持多段拼接、排序、切分、连播。背后对应 video_depth_map / video_edit / extract_audio 等画布能力。',
  quickReference: [
    { key: '入口', value: '视频节点悬浮工具栏「视频编辑」/ 右键菜单' },
    { key: '四个 Tab', value: '资源 / 素材分析（关键帧）/ 剪辑处理 / 产物检查' },
    { key: '深度转换', value: '本地 Depth Anything V2，离线、不上云' },
    { key: '关键帧策略', value: 'scene / iframe / uniform（超 20 帧自动退化）' },
    { key: '剪辑能力', value: '转码、切割、音频分离、变速、倒放、裁剪' },
    { key: '时间线', value: '多段拼接、排序、切分、连播' },
  ],
  Body,
}

export default page
