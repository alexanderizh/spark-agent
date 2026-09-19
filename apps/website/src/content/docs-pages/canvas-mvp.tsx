import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      无限画布（Infinite Canvas）不是一张生图页面，而是以项目为单位的多模态创作工作台：
      你在一个可平移缩放的画布上摆文本、图片、视频、音频和 AI 操作节点，
      用连线表达「谁是谁的输入」，AI 产物自动落成新节点并保留来源关系。
      这一页讲清楚真实的节点枚举、菜单结构、任务链路、资产中心和持久化位置。
    </p>

    <h2 id="core-loop">1. 核心闭环</h2>
    <ol>
      <li>在画布模式的项目列表里新建（或打开）一个 Canvas 项目。</li>
      <li>进入画布，导入素材或直接双击空白处新建文本 / Prompt 节点。</li>
      <li>选中节点，用右键菜单或顶部工具条发起一个 AI 操作（例如「图片生成」）。</li>
      <li>操作节点有自己的配置面板；确认 Prompt、模型与参数后提交运行。</li>
      <li>
        主进程创建任务，走媒体路由（云端 Provider）或本地能力（深度视频、分离音频、提取首尾帧）。
      </li>
      <li>
        任务进度通过流式事件回写画布，操作节点上显示
        running，右侧面板「任务」tab（任务队列）里能看到明细。
      </li>
      <li>成功后自动生成结果节点，并在输入 / 输出之间建立血缘边。</li>
      <li>结果节点可以继续作为下一个操作的输入，整条流水线一直往前推。</li>
    </ol>

    <h2 id="project">2. 项目管理与画布</h2>
    <p>
      切到侧边栏的 <strong>「画布」</strong> 模式，没选项目时是欢迎页，列出最近打开的项目 （最多 8
      个，按更新时间倒序）。新建流程是：
    </p>
    <ol>
      <li>点「新建项目」，或在侧栏触发同一个创建信号。</li>
      <li>
        在「新建 Canvas 项目」对话框里填 <strong>项目名称</strong>（占位文案是 「例如：618
        商品主图」）、可选的 <strong>描述</strong>，以及
        <strong>封面图</strong>（占位提示「点击选择封面图（建议 16:9，&lt;= 8MB）」）。
      </li>
      <li>
        点「创建并进入画布」。之后在项目卡片上可以编辑、置顶、打开文件夹、导出、归档或删除；
        进入项目详情后，还可以在资产条目上右键「设为封面」把任意已有资产设为项目封面。
      </li>
    </ol>
    <p>
      每个项目会在磁盘上有一个真实目录，默认位置是应用数据目录下的
      <code>canvas-projects/</code>（可以在画布设置里改根路径），目录名是
      <code>&lt;项目名&gt;-&lt;项目 id&gt;</code>。目录里固定有：
    </p>
    <ul>
      <li>
        <code>assets/</code>，下面分 <code>images/</code>、<code>videos/</code>、<code>audio/</code>
        、<code>files/</code>；
      </li>
      <li>
        <code>thumbnails/</code>、<code>tasks/</code>、<code>exports/</code>；
      </li>
      <li>
        <code>snapshots/</code>，含 <code>latest.json</code> 与按时间戳命名的历史快照；
      </li>
      <li>
        <code>project.json</code>，是导出的项目包清单（<code>kind: spark.canvas.project</code>）。
      </li>
    </ul>
    <div className="docs-callout">
      <strong>一个项目就是一个可见画布</strong>。底层历史数据里可能还带 boardId， 但当前 UI
      没有挂载多画板侧栏；内置的画布助手提示词也明确要求不要创建 / 删除 / 复制 / 重命名 /
      切换画板，需要区分内容时用分组、区域和命名来组织。
    </div>

    <h2 id="node-types">3. 节点类型</h2>
    <p>
      画布节点分两类：<strong>内容节点</strong>承载素材，<strong>操作节点（任务节点）</strong>
      承载一次 AI 操作。操作节点的 <code>node.type</code> 与 <code>node.data.operation</code>{' '}
      一一对应， 下面是完整枚举（中文名取自应用里的节点标签映射）：
    </p>
    <table>
      <thead>
        <tr>
          <th>类型（type）</th>
          <th>界面名</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>image</code>
          </td>
          <td>图片</td>
          <td>本地上传、粘贴或 AI 产出</td>
        </tr>
        <tr>
          <td>
            <code>video</code>
          </td>
          <td>视频</td>
          <td>可内联预览，也是视频工作台的入口</td>
        </tr>
        <tr>
          <td>
            <code>audio</code>
          </td>
          <td>音频</td>
          <td>音频节点有独立的探测 / 截取 / 变速能力</td>
        </tr>
        <tr>
          <td>
            <code>text</code>
          </td>
          <td>文本</td>
          <td>文案、脚本、备注；也可作为 Prompt 载体</td>
        </tr>
        <tr>
          <td>
            <code>prompt</code>
          </td>
          <td>Prompt</td>
          <td>结构化提示词节点</td>
        </tr>
        <tr>
          <td>
            <code>group</code>
          </td>
          <td>分组</td>
          <td>把多个节点编组，可折叠成封面卡</td>
        </tr>
      </tbody>
    </table>
    <p>操作节点的类型枚举（共 19 个，另有 1 个已废弃类型）：</p>
    <table>
      <thead>
        <tr>
          <th>type / operation</th>
          <th>界面名</th>
          <th>产物</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>text_generate</code>
          </td>
          <td>文本生文</td>
          <td>文本</td>
        </tr>
        <tr>
          <td>
            <code>text_rewrite</code>
          </td>
          <td>文本改写</td>
          <td>文本</td>
        </tr>
        <tr>
          <td>
            <code>prompt_optimize</code>
          </td>
          <td>Prompt 优化</td>
          <td>Prompt</td>
        </tr>
        <tr>
          <td>
            <code>image_prompt_reverse</code>
          </td>
          <td>图片反推</td>
          <td>文本</td>
        </tr>
        <tr>
          <td>
            <code>text_to_image</code>
          </td>
          <td>文生图 / 图片生成</td>
          <td>图片</td>
        </tr>
        <tr>
          <td>
            <code>image_to_image</code>
          </td>
          <td>图生图</td>
          <td>图片</td>
        </tr>
        <tr>
          <td>
            <code>image_edit</code>
          </td>
          <td>图片编辑</td>
          <td>图片</td>
        </tr>
        <tr>
          <td>
            <code>image_compose</code>
          </td>
          <td>多图合成</td>
          <td>图片</td>
        </tr>
        <tr>
          <td>
            <code>storyboard_grid</code>
          </td>
          <td>故事板</td>
          <td>图片</td>
        </tr>
        <tr>
          <td>
            <code>panorama_360</code>
          </td>
          <td>全景图</td>
          <td>图片（2:1 等距圆柱投影）</td>
        </tr>
        <tr>
          <td>
            <code>text_to_video</code>
          </td>
          <td>视频生成</td>
          <td>视频</td>
        </tr>
        <tr>
          <td>
            <code>image_to_video</code>
          </td>
          <td>图生视频</td>
          <td>视频</td>
        </tr>
        <tr>
          <td>
            <code>video_edit</code>
          </td>
          <td>视频编辑</td>
          <td>视频</td>
        </tr>
        <tr>
          <td>
            <code>video_extend</code>
          </td>
          <td>视频扩展</td>
          <td>视频</td>
        </tr>
        <tr>
          <td>
            <code>video_depth_map</code>
          </td>
          <td>深度视频转换</td>
          <td>视频（本地推理）</td>
        </tr>
        <tr>
          <td>
            <code>extract_audio</code>
          </td>
          <td>分离音频</td>
          <td>音频</td>
        </tr>
        <tr>
          <td>
            <code>extract_first_last_frames</code>
          </td>
          <td>提取首尾帧</td>
          <td>图片</td>
        </tr>
        <tr>
          <td>
            <code>text_to_audio</code>
          </td>
          <td>文生音频</td>
          <td>音频</td>
        </tr>
        <tr>
          <td>
            <code>audio_transcribe</code>
          </td>
          <td>语音转写</td>
          <td>文本</td>
        </tr>
        <tr>
          <td>
            <code>task</code>（已废弃）
          </td>
          <td>任务</td>
          <td>旧通用任务节点，只保留读取兼容，新节点不再创建</td>
        </tr>
      </tbody>
    </table>
    <p>几条交互约定：</p>
    <ul>
      <li>
        <strong>
          标题格式是 <code>#编号 标题</code>
        </strong>
        ，例如 <code>#3 图片</code>、<code>#7 文生图</code>。编号按当前画布里现存节点的最大编号 + 1
        分配。
      </li>
      <li>
        <strong>双击</strong>：分组节点折叠 / 展开，其他节点打开编辑弹窗。
        操作节点还有自己的配置面板（Prompt、模型、参数），从节点或工具条打开。
      </li>
      <li>
        <strong>选中单个节点</strong>
        时顶部出现常驻工具条（提交运行、预览、展开产物、复制节点、视频编辑、分离音频、提取首尾帧、尺寸与压缩等，按节点能力出现）。
      </li>
      <li>取消任务用节点上的取消入口，或右侧任务队列里的取消按钮；批量取消在任务队列顶部。</li>
    </ul>

    <h2 id="ai-ops">4. AI 操作</h2>
    <p>
      发起操作有三个入口：<strong>空白画布右键</strong>、<strong>节点右键菜单</strong>，
      以及节点工具条 / 选中后的「AI 操作」面板（面板标题就是「AI
      操作」，副标题「基于画布选择创建任务」）。 菜单按用途分组，不是一长条平铺列表。
    </p>

    <h3 id="node-menu">4.1 右键菜单结构</h3>
    <p>右键一个节点，菜单按可用性拼装，稳定出现的部分有：</p>
    <ul>
      <li>
        <strong>视频编辑 / 尺寸与压缩</strong>：仅当节点是视频节点（或操作节点的产物是视频）时出现。
      </li>
      <li>
        <strong>影视创作</strong>（二级菜单）：按「文本编排 / 资产提取 / 视觉生成 / 视频生成」四组，
        放入流水线动作，例如「转剧本」「生成分镜脚本」「提取角色」「生成分镜关键帧图」
        「生成角色身份板」「生成场景图」「生成关键帧」「出视频(首尾帧)」「按剧情分集」 「场景 360
        全景图」等。这些动作按节点的流水线角色与内容类型筛选——
        没有角色的普通文本节点也能拿到剧本类入口，而不是所有节点都看到全部动作。
      </li>
      <li>
        <strong>特色功能</strong>（二级菜单）：
        <ul>
          <li>
            <strong>视觉工具</strong>：上下文专属动作——图片节点有「图片扩图」「提取风格」
            「细节设定图（九宫格）」；文本 / Prompt 节点有「提取风格」「细节设定图（九宫格）」；
            之后统一接「故事板」和「360 全景图」。
          </li>
          <li>
            <strong>媒体工具</strong>：深度视频转换、分离音频、提取首尾帧。
          </li>
          <li>
            <strong>图片工具</strong>（图片类节点且有产物时）：尺寸与压缩、图片标注、
            提取子视图、宫格切分。
          </li>
        </ul>
      </li>
      <li>
        <strong>基础任务</strong>（直接列在菜单里，不折叠）：文本生文、图片生成、
        图片反推、视频生成。注意「图片生成」是一个合并入口，运行时按所选模式和参考图数量 归到文生图
        / 图生图 / 多图合成。
      </li>
      <li>
        其余是节点管理动作：<strong>保存到资源库…</strong>、<strong>添加到 Agent 对话</strong>
        （把节点加进画布 Agent 的引用列表）、<strong>切换类型</strong>（仅图片 /
        文本等可切换子类型）、 分组节点上的「选中组内节点 / 折叠编组 / 多图合并 /
        解散组」、组内节点的「移出组」， 以及危险色的<strong>删除节点</strong>。
      </li>
    </ul>
    <p>
      选中两个以上节点再右键，走的是批量菜单（编组、批量配置任务、批量提交等），
      而不是上面这份单节点菜单。
    </p>
    <p>
      「文生音频」和「语音转写」这两个能力仍然存在（能力表里能查到，输入输出类型也定义了），
      但当前右键菜单的基础任务分组<strong>会过滤掉音频组</strong>； 需要它们时从操作面板的「AI
      操作」面板或预设中心选。
    </p>

    <h3 id="prompt-and-depth">4.2 图片反推与深度视频转换</h3>
    <p>这两个操作的配置面板形态和其它操作明显不同，值得单独记：</p>
    <ul>
      <li>
        <strong>图片反推</strong>：输入恰好一张图片，产物是文本。面板里没有自定义参数， Prompt
        区域改叫「反推要求」（占位示例是「只反推图中场景；只描述人物外观；…」），
        提交按钮是「生成提示词」。它走视觉理解模型，需要你配置一个支持图片输入的对话模型。
      </li>
      <li>
        <strong>深度视频转换</strong>：输入一段本地视频，输出近白远黑的深度视频。 面板里没有
        Prompt、没有云端 Provider 和模型参数，只显示本地深度组件的状态，
        提交按钮是「生成深度视频转换」。
      </li>
    </ul>

    <h3 id="panorama">4.3 360 全景图与环视预览</h3>
    <p>
      360 全景图产出 2:1 等距圆柱投影（equirectangular）图片，用来锁定一个场景的
      光照与物体布局；从同一张全景图取不同角度截图，多镜头之间天然一致。
      右键全景产物节点选「全景预览」打开查看器，工具栏上有：
    </p>
    <ul>
      <li>
        <strong>重置</strong>：把视角复位到默认朝向与默认 FOV。
      </li>
      <li>
        <strong>自动环视</strong>开关：自动水平旋转，适合审片和录屏。
      </li>
      <li>
        <strong>遥测读数</strong>：水平朝向、<code>Pitch</code>、<code>FOV</code> 三个值， FOV
        滑杆范围 30°～100°（默认 75°）。
      </li>
      <li>
        <strong>框选截图</strong>：在画面上拖框截取局部区域。
      </li>
      <li>
        <strong>截图生成场景图</strong>：把当前视角整帧落成新的画布图片节点。
      </li>
    </ul>
    <p>
      操作方式：拖拽或触屏滑动看方向，滚轮 / 滑杆缩放，方向键环视（<code>+</code> / <code>-</code>{' '}
      缩放）， 顶栏按钮进入「沉浸全屏」。图片标题栏会显示它是
      <code>2:1 equirectangular</code> 还是普通 <code>panorama image</code>
      （按宽高比判断，容差 0.22）。WebGL 不可用时查看器会明确提示，而不是黑屏。
    </p>
    <p>
      <img
        src="/docs/img/canvas-panorama.png"
        alt="360 全景预览查看器：沉浸全屏、遥测读数、自动环视、FOV 滑杆、框选截图与截图生成场景图"
        loading="lazy"
      />
    </p>

    <h2 id="tasks">5. 任务、队列与血缘</h2>
    <p>
      提交操作节点后，画布右侧面板的 <strong>「任务」</strong>{' '}
      tab（标题是「任务队列」）是任务的权威视图， 顶部有筛选：
      <strong>全部 / 运行 / 失败 / 完成</strong>， 并且提供「全部取消」和「清理无节点」两个批量动作
      （后者用于清理承载节点已被删除的残留任务）。
    </p>
    <p>任务状态是五个值：</p>
    <table>
      <thead>
        <tr>
          <th>状态</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>pending</code>
          </td>
          <td>已入队，尚未开始</td>
        </tr>
        <tr>
          <td>
            <code>running</code>
          </td>
          <td>执行中（节点上有 running 视觉态）</td>
        </tr>
        <tr>
          <td>
            <code>completed</code>
          </td>
          <td>成功，产物已落画布</td>
        </tr>
        <tr>
          <td>
            <code>failed</code>
          </td>
          <td>失败；节点上显示「失败：&lt;错误信息&gt;」，任务队列与任务详情里有完整错误</td>
        </tr>
        <tr>
          <td>
            <code>cancelled</code>
          </td>
          <td>被用户取消</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>血缘边</strong>是画布的基础数据结构，不是装饰。边的类型有五种：
      <code>derived_from</code>（派生自）、<code>used_as_input</code>（作为输入）、
      <code>generated</code>（由任务生成）、<code>group_contains</code>（分组包含）、
      <code>references</code>（引用）。一条边记录了 projectId、sourceNodeId、targetNodeId、
      type、可选的 taskId 和 metadata，所以你可以从任一产物一路回溯到最初的输入与任务。
    </p>
    <p>
      任务运行态会通过流式事件推给渲染端（媒体任务走
      <code>stream:canvas:media-task</code>），所以进度、阶段文案和终态都是实时显示的。
      另外注意一个硬限制：<strong>本地深度视频转换同时只允许 1 个任务</strong>，
      再提交会直接报错「已有深度视频转换任务正在运行」。
    </p>

    <h2 id="assets">6. 资产中心与项目资产库</h2>
    <p>画布底部工具栏的「项目资产中心」是项目级公用资产的入口，按 tab 组织：</p>
    <ul>
      <li>文稿（可下钻到章节正文）、剧本</li>
      <li>角色、场景、道具、特效</li>
      <li>分镜分组、提示词库</li>
      <li>Files：管理远端 Provider 的文件（例如火山方舟 / 百炼 / MiniMax 的 Files 接口）</li>
    </ul>
    <p>
      每个 tab 里都支持关键词搜索、标签筛选和排序（最近修改 / 最近创建 / 按名称 / 按使用次数），
      列表分批渲染（文稿类资产可能上千条）。资产条目可以编辑、用 AI 优化（走文本改写能力），
      或插入画布。
    </p>
    <p>
      左侧工作台里还有一个更偏治理的<strong>项目资产库</strong>（同一份数据的另一视图），
      分类是：全部资产、收藏、角色、场景、道具、特效、文稿、剧本、分镜分组、提示词库、Files。
      它支持：
    </p>
    <ul>
      <li>
        列表 / 网格两种视图，多选（<strong>单次上限 30 个</strong>，避免大量资产时卡死）。
      </li>
      <li>批量下载、批量插入画布、批量删除。</li>
      <li>查看资产被哪些节点引用、由哪个任务生成、以及落盘路径。</li>
      <li>
        从节点右键「保存到资源库…」把画布上的产物回存为资产； 资产条目可以直接拖进画布 Agent
        的对话（拖拽载荷带类型信息）， 也可以用批量动作「插入画布」把它放回画布。
      </li>
    </ul>

    <h2 id="persistence">7. 持久化与产物落盘</h2>
    <p>
      这一节是排查「我的画布还在不在」时最该看的。<strong>SQLite 才是画布的生产权威存储</strong>，
      localStorage 只是同会话内的热缓存。
    </p>
    <ul>
      <li>
        <strong>热缓存</strong>：所有画布交互先写内存与 localStorage（写入做了 500ms 防抖合并），
        只保证同一会话内打开快。
      </li>
      <li>
        <strong>落库</strong>：默认是<strong>手动保存模型</strong>——<code>Ctrl/Cmd+S</code>、
        保存按钮、或离开时的确认弹窗触发全量落库，写入 SQLite 的<code>canvas_projects</code> 与{' '}
        <code>canvas_snapshots</code>。
      </li>
      <li>
        <strong>自动保存</strong>：工具栏上有「自动保存」开关，开启后停止操作约 1.2 秒触发保存，
        且两次保存之间至少间隔 30 秒；失败会按 1.2s × 2ⁿ 退避（上限 30 秒）， 连续失败 5
        次后停止重试，避免把 CPU 打满。
      </li>
      <li>
        <strong>同时写项目文件</strong>：每次落库都会把项目快照写到项目目录， 即{' '}
        <code>project.json</code> 与 <code>snapshots/latest.json</code>，
        并追加一份时间戳快照；时间戳快照只保留最近 10 份，退出画布后收紧到 2 份，
        <code>latest.json</code> 永不删除。
      </li>
      <li>
        <strong>未保存改动有守卫</strong>：离开画布时会检查未落库的项目并弹确认，
        选「不保存」会把该项目回滚到上次落库状态（否则残留的 localStorage
        数据会在下次保存时被写回去）。
      </li>
    </ul>
    <p>生成产物与预览协议：</p>
    <ul>
      <li>
        画布媒体产物默认落在 <code>userData/.spark-artifacts/media/</code>， 按类型分子目录（
        <code>images</code> / <code>videos</code> / <code>audio</code> / <code>files</code>），
        各功能还有自己的子目录，例如 <code>video-workbench</code>、<code>canvas-depth</code>、
        <code>canvas-audio</code>、<code>canvas-frames</code>、<code>image-process</code>、
        <code>annotations</code>。
      </li>
      <li>
        渲染端用自定义协议读取本地文件：<code>safe-file://x/&lt;base64 绝对路径&gt;</code>， 响应带{' '}
        <code>Content-Type</code>、<code>Content-Length</code>、<code>Accept-Ranges</code>，
        所以视频可以拖动进度条 seek。
      </li>
      <li>
        该协议有严格白名单：只放行应用数据目录、系统临时目录、
        <code>~/.spark-agent/board-attachments</code>、已登记的工作区根目录，以及画布项目根目录；
        其它路径一律 403。
      </li>
    </ul>

    <h2 id="errors">8. 错误码与排错</h2>
    <p>媒体任务把各家 Provider 的报错归一成一套错误码，画布与 Inspector 展示的就是它们：</p>
    <table>
      <thead>
        <tr>
          <th>错误码</th>
          <th>含义 / 处理</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>provider_not_configured</code>
          </td>
          <td>没有可用 Provider；界面会提示去「模型 / Agent 配置」添加</td>
        </tr>
        <tr>
          <td>
            <code>capability_not_supported</code>
          </td>
          <td>已配置的 Provider 不支持这个能力（或缺对应模型）</td>
        </tr>
        <tr>
          <td>
            <code>api_key_missing</code>
          </td>
          <td>Provider 没有密钥，去「模型」页补填</td>
        </tr>
        <tr>
          <td>
            <code>invalid_input</code>
          </td>
          <td>输入不合法（缺必填输入、参数越界等）</td>
        </tr>
        <tr>
          <td>
            <code>provider_http_error</code>
          </td>
          <td>上游返回非 2xx，看任务详情里的请求摘要</td>
        </tr>
        <tr>
          <td>
            <code>auth_required</code>
          </td>
          <td>上游要求重新授权</td>
        </tr>
        <tr>
          <td>
            <code>task_failed</code>
          </td>
          <td>异步任务终态失败</td>
        </tr>
        <tr>
          <td>
            <code>task_timeout</code>
          </td>
          <td>异步任务轮询超时</td>
        </tr>
        <tr>
          <td>
            <code>artifact_download_failed</code>
          </td>
          <td>产物下载失败（链接过期、网络等）</td>
        </tr>
        <tr>
          <td>
            <code>local_depth_failed</code>
          </td>
          <td>本地深度视频转换失败（模型 / 运行时问题，可在完整性页修复）</td>
        </tr>
      </tbody>
    </table>
    <p>
      失败任务不会消失，节点保持 <code>failed</code> 状态：节点上显示
      「失败：&lt;错误信息&gt;」，任务队列卡片与任务详情弹窗里有完整错误内容。 如果看到{' '}
      <code>provider_not_configured</code> 且提示是「请先在『模型 / Agent 配置』中添加可用模型」，
      说明是通用的「一个 Provider 都没配」；如果消息更具体，就按消息本身排查。
    </p>

    <h2 id="limits">9. 当前限制</h2>
    <p>下面这些是能在代码里对上的真实限制，规划时先按这个预期走：</p>
    <ul>
      <li>
        <strong>一个项目一个可见画布</strong>：多画板侧栏组件未挂载，画布助手也被告知不要切换画板。
      </li>
      <li>
        <strong>深度视频转换串行</strong>：同一时间只允许一个本地深度任务。
      </li>
      <li>
        <strong>深度转换的输入路径受限</strong>：输入视频必须在画布或已登记工作区目录内，
        否则直接拒绝（路径不在允许范围）。
      </li>
      <li>
        <strong>右键菜单不提供音频能力</strong>：文生音频 / 语音转写要从操作面板的能力入口选。
      </li>
      <li>
        <strong>
          旧 <code>task</code> 节点只读兼容
        </strong>
        ：历史画布里的通用任务节点还能打开， 但新操作一律创建类型化操作节点。
      </li>
      <li>
        <strong>快照有保留上限</strong>：单项目时间戳快照 10 份、退出画布后 2 份，
        需要长期归档时用项目菜单里的「导出」（导出项目包）而不是靠快照堆积。
      </li>
    </ul>
  </>
)

export const canvasMvp: DocsPageContent = {
  slug: 'canvas-mvp',
  toc: [
    { id: 'core-loop', title: '1. 核心闭环', level: 2 },
    { id: 'project', title: '2. 项目管理与画布', level: 2 },
    { id: 'node-types', title: '3. 节点类型', level: 2 },
    { id: 'ai-ops', title: '4. AI 操作', level: 2 },
    { id: 'node-menu', title: '4.1 右键菜单结构', level: 3 },
    { id: 'prompt-and-depth', title: '4.2 图片反推与深度视频转换', level: 3 },
    { id: 'panorama', title: '4.3 360 全景图与环视预览', level: 3 },
    { id: 'tasks', title: '5. 任务、队列与血缘', level: 2 },
    { id: 'assets', title: '6. 资产中心与项目资产库', level: 2 },
    { id: 'persistence', title: '7. 持久化与产物落盘', level: 2 },
    { id: 'errors', title: '8. 错误码与排错', level: 2 },
    { id: 'limits', title: '9. 当前限制', level: 2 },
  ],
  faq: [
    {
      question: '画布上的「任务节点」和以前有什么不同？',
      answer:
        '现在一次 AI 操作就是一个类型化操作节点（例如 text_to_image、video_depth_map），它同时承载配置、运行状态和产物；旧的通用 type 为 task 的节点只保留读取兼容，新节点不再创建。',
    },
    {
      question: '画布数据存在哪里？',
      answer:
        'SQLite 的 canvas_projects 与 canvas_snapshots 是生产权威存储，默认手动保存（Cmd/Ctrl+S、保存按钮或离开确认），也可开自动保存。localStorage 只是同会话的 500ms 防抖热缓存。每次落库还会写项目目录里的 project.json 与 snapshots/latest.json。',
    },
    {
      question: '生成的图 / 视频落在哪个目录？',
      answer:
        '默认在 userData/.spark-artifacts/media/ 下，按类型分子目录（images / videos / audio / files），深度视频、视频工作台产物、抽帧结果等各有独立子目录。渲染端通过 safe-file:// 协议读取，白名单之外一律 403。',
    },
    {
      question: '为什么右键菜单里找不到文生音频 / 语音转写？',
      answer:
        '右键菜单的基础任务分组当前会过滤掉音频组。这两个能力仍在能力表里，从操作面板的「AI 操作」入口或预设中心选即可。',
    },
    {
      question: '可以同时跑多少个深度视频转换？',
      answer:
        '一次只能跑一个。已有任务在运行时再次提交会直接报「已有深度视频转换任务正在运行」，需要等它完成或先取消。',
    },
    {
      question: '一组节点之间的连线有什么用？',
      answer:
        '连线是血缘边，类型有 derived_from / used_as_input / generated / group_contains / references，记录了来源节点、目标任务和元数据。它决定了操作节点的可用输入，也是你回溯某个产物是怎么来的依据。',
    },
  ],
  quickReference: [
    { key: '内容节点类型', value: 'image / video / audio / text / prompt / group' },
    {
      key: '操作节点类型',
      value:
        'text_generate / text_rewrite / prompt_optimize / image_prompt_reverse / text_to_image / image_to_image / image_edit / image_compose / storyboard_grid / panorama_360 / text_to_video / image_to_video / video_edit / video_extend / video_depth_map / extract_audio / extract_first_last_frames / text_to_audio / audio_transcribe',
    },
    { key: '节点标题格式', value: '#编号 标题（编号 = 画布内最大编号 + 1）' },
    { key: '右键菜单分组', value: '影视创作 / 特色功能（视觉工具·媒体工具·图片工具）/ 基础任务' },
    { key: '任务状态', value: 'pending / running / completed / failed / cancelled' },
    {
      key: '血缘边类型',
      value: 'derived_from / used_as_input / generated / group_contains / references',
    },
    { key: '任务队列入口', value: '画布右侧面板「任务」tab（筛选：全部 / 运行 / 失败 / 完成）' },
    { key: '项目默认根目录', value: 'userData/canvas-projects/<项目名>-<项目 id>' },
    {
      key: '持久化',
      value: 'SQLite canvas_projects + canvas_snapshots（默认手动保存，可开自动保存）',
    },
    { key: '热缓存', value: 'localStorage，500ms 防抖合并写入' },
    { key: '产物目录', value: 'userData/.spark-artifacts/media/{images,videos,audio,files,...}' },
    { key: '本地文件协议', value: 'safe-file://x/<base64 绝对路径>（白名单之外 403）' },
    { key: '快照保留', value: '时间戳快照 10 份，退出画布后 2 份（latest.json 永不删）' },
  ],
  howTo: {
    name: '用无限画布完成一次文生图迭代',
    description: '从新建项目到产出第一个图片节点，并保留血缘',
    totalTime: 'PT8M',
    steps: [
      '切到侧边栏「画布」模式，点「新建项目」，填项目名称、描述与封面，点「创建并进入画布」',
      '在空白处右键新建一个文本或 Prompt 节点，写入提示词',
      '右键该文本节点，在「基础任务」里选「图片生成」，或在节点工具条的 AI 操作面板里选',
      '在操作面板里确认 Prompt、选择模型与参数，提交运行',
      '打开右侧面板「任务」tab 查看进度；节点会显示 running，完成后自动生成图片节点并建立血缘边',
      '在图片节点上继续右键发起「图片编辑」或「多图合成」等下一步操作',
      '需要长期归档时用项目菜单的「导出」生成项目包，而不是依赖快照堆积',
    ],
  },
  aiSummary:
    'Spark Work 无限画布实测：项目创建（名称 / 描述 / 封面 16:9）与项目目录结构（assets/{images,videos,audio,files}、thumbnails、tasks、exports、snapshots、project.json），一个项目一个可见画布；' +
    '真实节点枚举——内容节点 image/video/audio/text/prompt/group，操作节点 19 个（text_generate、text_to_image、image_edit、image_compose、storyboard_grid、panorama_360、image_prompt_reverse、video_depth_map、extract_audio、extract_first_last_frames、text_to_audio、audio_transcribe 等）与已废弃的 task；' +
    '右键菜单真实结构（影视创作 / 特色功能的三组 / 基础任务四项，音频组被过滤）；图片反推（反推要求 + 生成提示词）与深度视频转换（无 Prompt 与云端参数）的面板差异；360 全景预览（FOV 30~100、默认 75、自动环视、框选截图、截图生成场景图）；' +
    '任务状态机五值、任务队列筛选与本地深度任务串行限制、血缘边五种类型；资产中心（文稿/剧本/角色/场景/道具/特效/分镜分组/提示词库/Files）与项目资产库（多选上限 30、批量操作、引用与落盘溯源）；' +
    '持久化真相（SQLite 权威 + 手动保存 + 可选自动保存 1.2s 防抖/30s 节流 + localStorage 500ms 热缓存 + 项目目录快照保留 10/2 份）与 safe-file:// 白名单；MediaErrorCode 九码加 local_depth_failed。',
  Body,
}

export default canvasMvp
