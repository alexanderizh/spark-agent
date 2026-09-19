import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      电脑操作（Computer Use）是 SparkWork 里唯一允许 Agent <strong>直接操作你的真实桌面</strong>
      的能力： 看屏幕、读元素树、点击、输入、滚动、拖拽，以及把一整个多步目标委派给它自己跑。
      它的实现方式和其他能力都不同——
      <strong>不是纯 Electron/JS，而是一个独立的原生宿主子进程</strong>
      （macOS 是 Swift 写的 <code>SparkComputerHost</code>，Windows 是 Rust 写的{' '}
      <code>spark-computer-host</code>），主进程只能通过 stdio 帧协议指挥它。
    </p>
    <p>
      这一页按真实代码讲清六件事：两条使用路径（原子动作与委派任务）、权限为什么是
      <strong>两道独立闸门</strong>、
      策略引擎的实际强制力边界、原生宿主的信任与自愈、快照的加密与隐私边界、 以及{' '}
      <strong>10 个 V2 开关里哪 4 个其实没有任何消费者</strong>。
    </p>
    <p>
      <strong>先给结论</strong>：这套能力在代码层面是「可观测 + 可接管 + 有界预算」的， 但它
      <strong>不是沙箱</strong>——策略引擎对动作只做风险分级、不做内容拦截，
      多数「安全字段」是声明而非强制。下面逐条给出证据。
    </p>

    <h2 id="overview">1. 定位与真实入口</h2>
    <p>
      电脑操作是「会话内的即时能力」，不是长期资源：它绑定在某个 Agent 会话与某一轮的上下文里，
      没有独立的项目管理页。你能看到的界面只有三处：设置页、聊天流里的活动卡片、系统托盘。
    </p>

    <h3 id="entry">1.1 入口与界面文案</h3>
    <ul>
      <li>
        <strong>设置页</strong>：分组「<strong>系统</strong>」下的「<strong>电脑操作</strong>」， 项
        id 为 <code>computer-use</code>，图标 <code>Icons.Monitor</code>， 搜索关键词是{' '}
        <code>['辅助功能', '屏幕录制', '输入控制', '系统权限', 'computer use']</code>（
        <code>apps/desktop/src/renderer/design/views/SettingsView.tsx:449-457</code>）。 渲染的是{' '}
        <code>ComputerUseSettingsSection</code>（同文件 <code>:545</code>）。
      </li>
      <li>
        该页顶部说明原文是：
        <em>
          「系统授权集中在这里管理。授权完成后，Agent
          发起的电脑操作任务默认直接执行，不再逐步审批。」
        </em>
        （<code>design/computer-use/ComputerUseSettingsSection.tsx:154-157</code>）。
        这句话就是整套设计的核心口径。
      </li>
      <li>
        <strong>聊天流</strong>：电脑操作过程以卡片形式出现在消息之间，由{' '}
        <code>ComputerActivityProvider</code> / <code>ComputerActivitySegmentsBridge</code> /{' '}
        <code>ComputerActivitySegmentCard</code> 渲染 （
        <code>design/views/ChatView.tsx:5147-5168</code>）。
      </li>
      <li>
        <strong>系统托盘</strong>：<code>ComputerControlTrayService</code>，菜单里三条动作的文案是
        <strong>「暂停 Agent」/「立即接管」/「停止控制」</strong>（
        <code>apps/desktop/src/main/index.ts:685/693/701</code>）—— 注意这与聊天卡片里的「暂停 /
        接管 / 停止」<strong>不是同一套文案</strong>，别混用。
      </li>
    </ul>
    <p>
      一个容易踩的细节：设置页搜索框把关键词整串当子串匹配，而关键词里写的是带空格的{' '}
      <code>computer use</code>，所以搜带连字符的 <code>computer-use</code> <strong>搜不到</strong>
      这一项 （<code>SettingsView.tsx:517-521</code>）。
    </p>

    <h3 id="tools">1.2 27 个工具的全貌</h3>
    <p>
      电脑操作给模型暴露 <strong>27 个工具</strong>，名字都在 <code>mcp__spark_computer__</code>{' '}
      命名空间下， 清单硬编码在 <code>COMPUTER_USE_AGENT_TOOL_NAMES</code>（
      <code>apps/desktop/src/main/services/computer-use/ComputerUseMcpProvider.ts:6-37</code>），
      HTTP 桥侧还有一份完全相同的白名单 <code>ALLOWED_TOOLS</code>（
      <code>ComputerUseAgentBridge.ts:12-41</code>）。按职责分四组：
    </p>
    <table>
      <thead>
        <tr>
          <th>分组</th>
          <th>工具</th>
          <th>数量</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>观测</td>
          <td>
            <code>get_capabilities</code>、<code>diagnose_native_host</code>、<code>list_apps</code>
            、<code>list_windows</code>、<code>get_screen_state</code>、<code>get_app_state</code>、
            <code>capture_app_snapshot</code>、<code>screenshot</code>
          </td>
          <td>8</td>
        </tr>
        <tr>
          <td>原子动作</td>
          <td>
            <code>click</code>、<code>type_text</code>、<code>paste</code>、<code>set_value</code>、
            <code>invoke_element</code>、<code>press_key</code>、<code>scroll</code>、
            <code>drag</code>、<code>select_text</code>、<code>perform_secondary_action</code>
          </td>
          <td>10</td>
        </tr>
        <tr>
          <td>委派任务</td>
          <td>
            <code>start_task</code>、<code>get_status</code>、<code>wait_for_completion</code>、
            <code>open_app</code>、<code>bind_target</code>
          </td>
          <td>5</td>
        </tr>
        <tr>
          <td>控制</td>
          <td>
            <code>pause</code>、<code>resume</code>、<code>stop</code>、<code>takeover</code>
          </td>
          <td>4</td>
        </tr>
      </tbody>
    </table>
    <p>
      工具一旦挂载，会话权限层<strong>不会</strong>再对它逐次弹审批（见第 3 节）。 另外要注意：MCP
      服务器是<strong>无条件挂载给所有会话</strong>的，只判{' '}
      <code>computerUseMcpProvider != null</code>，并没有「本会话是否开启电脑操作」这个开关 （
      <code>packages/agent-runtime/src/services/session.service.ts:2926-2940</code>）。
      真正生效的门槛在每次调用时的能力预检。
    </p>

    <h3 id="two-paths">1.3 两条使用路径</h3>
    <p>
      同一个工具面里有两种<strong>架构完全不同</strong>的用法，这是理解整篇文档的关键：
    </p>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>原子动作路径</th>
          <th>委派任务路径</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>入口工具</td>
          <td>
            <code>click</code> / <code>type_text</code> 等 10 个
          </td>
          <td>
            <code>start_task</code>
          </td>
        </tr>
        <tr>
          <td>谁做决策</td>
          <td>
            <strong>会话模型自己</strong>（它就是电脑操作 agent）
          </td>
          <td>
            <strong>独立的决策循环</strong> <code>ComputerTaskOperator</code>
          </td>
        </tr>
        <tr>
          <td>决策模型</td>
          <td>当前会话的模型</td>
          <td>
            单独的 Provider，可按会话解析（<code>resolveDecisionModel</code>）
          </td>
        </tr>
        <tr>
          <td>节奏</td>
          <td>一次工具调用 = 一个动作，返回新树 + 新截图</td>
          <td>后台循环自己跑，直到完成 / 失败 / 需要接管</td>
        </tr>
        <tr>
          <td>会话对象</td>
          <td>
            <strong>隐式会话</strong>，每个 Agent 会话一个，空闲 5 分钟释放
          </td>
          <td>
            显式 <code>computerSession</code>，带任务契约与预算
          </td>
        </tr>
        <tr>
          <td>契约预算</td>
          <td>
            <code>maxSteps: 2000</code> / <code>maxRuntimeMs: 12h</code> /{' '}
            <code>maxConsecutiveNoops: 20</code>
          </td>
          <td>
            <code>maxSteps: 100</code> / <code>maxRuntimeMs: 20min</code> /{' '}
            <code>maxConsecutiveNoops: 8</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      两条路径共用同一个执行内核（<code>ComputerControlBroker</code> → 原生宿主）， 但
      <strong>
        原子动作不经过 <code>ComputerTaskOperator</code>
      </strong>
      。 契约常量分别在 <code>ComputerAtomicActionService.ts:52-69</code> 与{' '}
      <code>ComputerUseAgentController.ts:430-441</code>。
    </p>

    <h2 id="permissions">2. 系统权限与能力</h2>
    <p>
      电脑操作依赖操作系统级授权，这是<strong>唯一需要你手动参与</strong>的环节。
      代码里没有绕过系统授权的路径：拿不到权限就是能力不可用。
    </p>

    <h3 id="platform-matrix">2.1 平台支持矩阵</h3>
    <p>
      协议里声明了 macOS / Windows / Linux 三种平台与多种后端技术 （
      <code>packages/protocol/src/computer-use/native-wire.ts:38</code>：
      <code>screen_capture_kit</code> / <code>windows_graphics_capture</code> /{' '}
      <code>xdg_portal</code> / <code>x11</code>， 无障碍为 <code>axui_element</code> /{' '}
      <code>uia</code> / <code>at_spi</code>）， 但
      <strong>仓库里只实现了 macOS 与 Windows 两个宿主</strong>：<code>apps/desktop/native/</code>{' '}
      下只有 <code>macos/</code> 与 <code>windows/</code>， 且工厂函数把非 mac/win 或非 arm64/x64
      直接降级为不可用后端 （<code>NativeHostBackendFactory.ts:54-59</code>）。Linux
      目前没有任何可运行实现。
    </p>
    <table>
      <thead>
        <tr>
          <th>能力</th>
          <th>macOS（Swift）</th>
          <th>Windows（Rust）</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>截图</td>
          <td>ScreenCaptureKit（需 macOS 14+）</td>
          <td>Windows.Graphics.Capture</td>
        </tr>
        <tr>
          <td>元素树</td>
          <td>
            AX，深度 48、元素上限 <strong>2000</strong>
          </td>
          <td>
            UIA，深度 30、元素上限 <strong>100000</strong>
          </td>
        </tr>
        <tr>
          <td>后台输入</td>
          <td>
            AX 语义 + <code>CGEventPostToPid</code>
          </td>
          <td>
            <code>PostMessageW</code> + UIA 语义
          </td>
        </tr>
        <tr>
          <td>前台输入</td>
          <td>
            <code>CGEvent</code>
          </td>
          <td>
            <code>SendInput</code>
          </td>
        </tr>
        <tr>
          <td>视觉兜底</td>
          <td>✅ Vision OCR</td>
          <td>❌ 无（UIA 为空即报错）</td>
        </tr>
        <tr>
          <td>虚拟光标指示</td>
          <td>
            ✅ <code>MacVirtualCursor</code>
          </td>
          <td>❌ 无</td>
        </tr>
        <tr>
          <td>键盘布局自适应</td>
          <td>✅ 按当前布局解析</td>
          <td>❌ 硬编码 VK 表</td>
        </tr>
        <tr>
          <td>锁屏检测错误码</td>
          <td>
            有 <code>screen_locked</code> 分支
          </td>
          <td>无对应概念</td>
        </tr>
        <tr>
          <td>安全桌面检测</td>
          <td>无对应概念</td>
          <td>✅ 拒绝截图/输入</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>不要把两平台当能力对等。</strong>元素上限差 50 倍 （
      <code>MacControlPolicy.swift:19</code> vs <code>windows_host.rs:337</code>）， mac 有 OCR
      与虚拟光标兜底而 Windows 没有，Windows 有安全桌面概念而 mac 用锁屏错误码代替。 另外 macOS
      的树渲染文本预算是 48k （<code>NativeAXTreeRenderer.swift:62</code>，注释明确要求「必须 ≤ TS
      侧上限」）， 而 Windows 用的是 90k（<code>tree_render.rs:25</code>）， 但 TS 侧决策前只截
      48k（<code>ComputerDecisionAdapter.ts:23</code>）—— 也就是说{' '}
      <strong>Windows 侧超出的部分会被客户端静默截断</strong>，长界面可能丢尾部元素。
    </p>

    <h3 id="macos-permissions">2.2 macOS 的三项授权</h3>
    <p>macOS 需要三项系统权限，代码里都是「先 Preflight 探测、按需 Request 弹窗」：</p>
    <ul>
      <li>
        <strong>屏幕录制</strong>：<code>CGPreflightScreenCaptureAccess()</code> /{' '}
        <code>CGRequestScreenCaptureAccess()</code>（
        <code>MacScreenCaptureProvider.swift:38-39</code>、<code>:64</code>）； 缺权时报{' '}
        <code>screen_permission_denied</code>（可重试）。
      </li>
      <li>
        <strong>辅助功能</strong>：<code>AXIsProcessTrusted()</code> /{' '}
        <code>AXIsProcessTrustedWithOptions()</code>（<code>:70</code>、<code>:1130</code>
        ）；缺权时报 <code>accessibility_permission_denied</code>。
      </li>
      <li>
        <strong>事件投递</strong>：<code>CGPreflightPostEventAccess()</code> /{' '}
        <code>CGRequestPostEventAccess()</code>（<code>:71</code>、<code>:1135</code>）。
        注意这一项缺失
        <strong>
          也报 <code>accessibility_permission_denied</code>
        </strong>
        ， 没有独立错误码（<code>MacScreenCaptureProvider.swift:789</code>）。
      </li>
    </ul>
    <p>
      界面上的两项授权行对应关系是：<strong>「屏幕录制」= screen</strong>、
      <strong>「辅助功能与输入控制」= accessibility + input 两项同时满足</strong>（
      <code>ComputerUseSettingsSection.tsx:78-91</code>）。 这里有个组合态容易困惑：状态文字优先显示
      input 的状态，而「已授权」要求两个都 granted——
      于是「辅助功能已授权但输入控制未授权」时，会显示「待授权」但按钮变成「打开系统设置」 （因为
      state 已不是 <code>not_determined</code>）。
    </p>
    <p>
      点「请求授权」时，只有 <code>not_determined</code> 才会真正调系统弹窗 （
      <code>app-snapshot:request-permissions</code>）；其他状态直接跳系统设置页 （
      <code>computer-use:open-system-settings</code>）。 深链文案是：
      <em>
        「请前往“系统设置 → 隐私与安全性 → 屏幕录制/辅助功能”允许 SparkWork（开发模式下可能显示为
        Electron）。」
      </em>
      （<code>:264-265</code>）。
    </p>

    <h3 id="windows-permissions">2.3 Windows 的能力探测</h3>
    <p>
      Windows <strong>没有授权弹窗</strong>，也没有 <code>denied</code> /{' '}
      <code>not_determined</code> 状态： 它把三项能力按运行时探测结果直接映射成 <code>granted</code>{' '}
      或 <code>restricted</code>（<code>windows_host.rs:328-332</code>）。
      <code>request_permissions</code> 请求在 Windows 上只是重新探测一次 （
      <code>windows_host.rs:131-132</code>），不会弹任何系统界面。 UIA 不可用时执行动作报{' '}
      <code>environment_unavailable</code>（<code>windows_host.rs:367-372</code>）。
    </p>
    <p>
      协议层的权限状态枚举是五值：<code>granted</code> / <code>denied</code> /{' '}
      <code>not_determined</code> / <code>restricted</code> / <code>unsupported</code>（
      <code>native-wire.ts:19</code>），macOS 会用到前三者，Windows 只用前四者中的两个。
    </p>

    <h3 id="capabilities">2.4 能力探测的关键常量</h3>
    <p>
      客户端对 <code>get_capabilities</code> 结果做了缓存，刷新间隔是 <strong>1 秒</strong>（
      <code>NativeHostClient.ts:27</code>、<code>:185</code>），
      所以你在设置页改完权限、切回应用窗口时，界面会在下一个焦点事件后自动重测 （
      <code>ComputerUseSettingsSection.tsx:59-70</code> 监听 <code>focus</code> 与{' '}
      <code>visibilitychange</code>）。
    </p>
    <p>
      「已就绪」的判定是四项同时成立：
      <code>available === true</code> 且 screen / accessibility / input 三项都是{' '}
      <code>granted</code>（<code>:248-255</code>）。任一项不满足就显示「电脑操作尚未就绪」， 并展示{' '}
      <code>unavailableReason</code> 原文，或兜底文案「请完成下方系统授权并重新检测。」
    </p>

    <h2 id="governance">3. 权限与审批：两道闸门的真实关系</h2>
    <p>
      这是整篇最容易写错的地方。代码里存在<strong>两套</strong>与电脑操作有关的放行逻辑，
      但它们当前的实际效果是「<strong>都不逐动作拦</strong>」——原因却完全不同。先把结论摆出来：
    </p>
    <ul>
      <li>
        <strong>会话权限层</strong>里确实有一条 fail-closed 硬闸：
        <code>computer_direct_action</code> 与 <code>computer_unknown</code> 永不批准， 且
        <strong>连测试都锁死了这条语义</strong>。
      </li>
      <li>
        但生产路径上，电脑操作工具在<strong>到达这条硬闸之前</strong>就被引擎的自动放行名单放行了，
        所以它<strong>不会真的被这条规则拦到</strong>。
      </li>
      <li>
        <strong>执行层（Broker）</strong>不做逐动作审批： 策略引擎只做风险分级，动作以{' '}
        <code>approvalTicketId = null</code> 直接执行。
      </li>
    </ul>

    <h3 id="session-gate">3.1 第一道：会话权限层</h3>
    <p>
      动作名由 <code>resolveComputerPermissionAction</code> 映射 （
      <code>packages/agent-runtime/src/computer-use/computer-permission-action.ts:38-44</code>），
      规则表在 <code>permission.service.ts:41-50</code>，
      <strong>三个内置 profile 共用同一份</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>动作</th>
          <th>scope</th>
          <th>mode</th>
          <th>覆盖的工具</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>computer_observe</code>
          </td>
          <td>session</td>
          <td>allow</td>
          <td>10 个观测 / 查询类</td>
        </tr>
        <tr>
          <td>
            <code>computer_task_start</code>
          </td>
          <td>session</td>
          <td>allow</td>
          <td>
            <code>start_task</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>computer_pause</code>
          </td>
          <td>session</td>
          <td>allow</td>
          <td>
            <code>pause</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>computer_resume</code>
          </td>
          <td>session</td>
          <td>allow</td>
          <td>
            <code>resume</code>、<code>bind_target</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>computer_stop</code>
          </td>
          <td>session</td>
          <td>allow</td>
          <td>
            <code>stop</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>computer_takeover</code>
          </td>
          <td>session</td>
          <td>allow</td>
          <td>
            <code>takeover</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>computer_direct_action</code>
          </td>
          <td>any</td>
          <td>
            <strong>deny</strong>
          </td>
          <td>
            13 个低层动作名（<code>click</code>、<code>type_text</code>、<code>set_value</code> 等）
          </td>
        </tr>
        <tr>
          <td>
            <code>computer_unknown</code>
          </td>
          <td>any</td>
          <td>
            <strong>deny</strong>
          </td>
          <td>
            其余任何 <code>mcp__spark_computer__*</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>requestApproval</code> 开头有两条短路，位置在一切 profile 查询、会话记忆与{' '}
      <code>forcePrompt</code> 之前（<code>permission.service.ts:389-390</code>）：
    </p>
    <pre>
      <code>{`if (isUnapprovableComputerAction(action)) return false
if (isGovernedComputerTaskAction(action)) return true`}</code>
    </pre>
    <p>
      这个顺序很关键：<code>mode === 'deny'</code> 在更靠后的代码里是
      <strong>
        可以被 <code>forcePrompt: true</code> 绕过
      </strong>
      的，但上面这两条短路在它之前就返回了， 所以电脑操作的两条 deny 规则
      <strong>无法被任何配置绕开</strong>。 回归测试把这条语义写死：即使把{' '}
      <code>computer_direct_action</code> 配成 <code>allow</code>，
      <code>mcp__spark_computer__click</code> 依然被拒且<strong>不弹卡</strong>（
      <code>packages/agent-runtime/src/__tests__/services/permission.service.test.ts:365-380</code>
      ）。
    </p>
    <p>
      注释把这个意图写得很直白（<code>permission.service.ts:96-101</code>）： 受管 Computer Use
      的高层工具
      <em>
        「在 requestApproval 入口直接放行， 确保旧库、自定义 profile、会话记忆和 forcePrompt
        都不会重新引入应用内审批」
      </em>
      ； 内置规则版本号也为此升到 <code>3</code>（<code>:105</code>）。
    </p>

    <h3 id="auto-allow">3.2 但生产路径其实在更早处就放行了</h3>
    <p>
      这里有一个<strong>必须讲清、否则会误导</strong>的层次问题。工具在到达{' '}
      <code>PermissionService</code> 之前，会先经过执行引擎的 <code>canUseTool</code> 回调，
      而该回调里有一条「自动放行名单」的短路，位置在审批回调<strong>之前</strong>。
    </p>
    <p>
      Claude SDK 路径的实现（<code>packages/agent-runtime/src/sdk/claude-sdk-executor.ts</code>）：
      自动放行在 <code>:895-897</code>，而宿主审批回调在 <code>:922</code>：
    </p>
    <pre>
      <code>{`if (callbackAllowedTools.has(toolName)) {          // :895
  return allowTool(input, callbackOptions.toolUseID, 'user_temporary')
}
...
const approvalCallback = config.approvalCallback      // :922
if (approvalCallback == null) return denyTool('Permission check failed', ...)`}</code>
    </pre>
    <p>
      而电脑操作的全部 27 个工具名恰好就在这份名单里： MCP provider 把它们放进{' '}
      <code>allowedTools</code>（<code>ComputerUseMcpProvider.ts:66-68</code>
      ），并在紧邻的注释里写明了设计意图——
      <em>「Desktop task authorization is task-scoped and identical in every permission mode.」</em>
      （桌面任务授权是任务级的，<strong>在每个权限模式下都完全一致</strong>）。
    </p>
    <p>
      也就是说：
      <strong>会话权限层里那条 fail-closed 硬闸是一条兜底网，而不是生产路径上真正生效的闸门</strong>
      。 它保证「任何绕过引擎自动放行名单的路径（自定义 profile、旧数据库、会话记忆、
      强制弹卡）都无法批准一个低层电脑动作」，但正常使用时，
      <code>mcp__spark_computer__click</code> 并不会走到它。 Codex
      路径同理：其交互审批只覆盖命令执行与文件补丁两类，
      <code>mcpToolCall</code> 只是一条通知，不产生审批 （
      <code>codex-app-server-executor.ts:1473-1491</code>）。
    </p>
    <blockquote>
      <p>
        <strong>怎么理解这条设计</strong>：电脑操作的控制点被有意集中在<strong>执行层</strong>——
        即「用户同意开始一次桌面任务」这个动作本身就是授权，
        之后不再逐步打断。设置页那句「授权完成后默认直接执行，不再逐步审批」正是这个意思。
      </p>
    </blockquote>
    <p>
      动作风险等级另有一张映射表（<code>permission.service.ts:186-194</code>）：
      <code>computer_observe</code> / <code>computer_pause</code> / <code>computer_stop</code> /{' '}
      <code>computer_takeover</code> 为 <code>low</code>，<code>computer_task_start</code> /{' '}
      <code>computer_resume</code> / <code>computer_direct_action</code> /{' '}
      <code>computer_unknown</code> 为 <code>high</code>。
      由于上面两条短路的存在，这些等级在当前实现里不参与拦截决策。
    </p>

    <h3 id="broker-gate">3.3 执行层：Broker 做了什么、没做什么</h3>
    <p>
      真正执行动作的是 <code>ComputerControlBroker</code>。它在每次动作前做三件事：
    </p>
    <ol>
      <li>
        <strong>新鲜度校验</strong>：动作携带的 <code>frameId</code> 与 <code>treeVersion</code>{' '}
        必须与当前观测一致，否则抛 <code>stale_frame</code> / <code>stale_tree</code>（
        <code>ComputerControlBroker.ts:344-351</code>）。 这里有一个<strong>刻意的例外</strong>：
        <em>不校验前台应用/窗口</em>，
        注释写明理由是「绑定任务必须在用户切到别的应用时继续操作它的目标窗口」 （
        <code>:352-355</code>）——这正是「不抢焦点、后台操作」的实现基础。
      </li>
      <li>
        <strong>策略评估</strong>：调 <code>ComputerPolicyService.evaluate</code>{' '}
        得到风险等级与决策（见第 4 节）。
      </li>
      <li>
        <strong>动作落库</strong>：写入 <code>computer_actions</code>， 其中{' '}
        <code>approvalTicketId</code>{' '}
        <strong>
          硬编码为 <code>null</code>
        </strong>
        （<code>:389</code>）。<code>deny</code> 分支之后没有任何审批分支， 直接进入{' '}
        <code>startExecuting(..., null)</code>（<code>:211</code>）。
      </li>
    </ol>
    <p>
      有一个名字容易误读的错误码：<code>approval_mismatch</code>（<code>:374-378</code>）。 它
      <strong>与审批无关</strong>——触发条件是「同一个 <code>actionId</code> 被复用， 但动作参数 /
      风险等级 / 策略决策不同」，本质是<strong>幂等保护</strong>。
    </p>

    <h3 id="approval-deprecated">3.4 审批链为什么是停用的</h3>
    <p>
      仓库里有一整套完整的审批实现（<code>ComputerApprovalService</code>、
      <code>ComputerActionApprovalPresenter</code>、<code>NativeComputerActionApprovalPrompt</code>
      ）， 包含票证摘要、过期语义、远端只能批 L2 等细节，但在当前模型下
      <strong>整条链没有接到任何生产路径上</strong>。证据有四条：
    </p>
    <ul>
      <li>
        接口上直接标了废弃：
        <code>
          &#123;/** @deprecated Persisted approval UI compatibility; direct execution never creates
          this. */&#125;
        </code>
        （<code>ComputerTaskOperator.ts:90-91</code>）；构造参数同样标注 「
        <em>never read by direct execution</em>」（<code>:128-129</code>）， 且{' '}
        <code>takeApprovedTicket</code> 在算子体内<strong>从未被调用</strong>。
      </li>
      <li>
        <code>createComputerActionApprovalPresenter</code> 与{' '}
        <code>createNativeComputerActionApprovalPrompt</code>{' '}
        <strong>只有定义、零生产调用点</strong>，引用只出现在各自的测试文件里。
      </li>
      <li>
        <code>requiresUserPresence</code> 在策略决策里
        <strong>
          恒为 <code>false</code>
        </strong>
        （<code>ComputerPolicyService.ts:66-76</code> 两处 <code>decision(...)</code>{' '}
        的最后一个实参都是 <code>false</code>）， 而任务契约里的 <code>userPresence</code> 恒被写成{' '}
        <code>'required'</code>——两者从未被比较。
      </li>
      <li>
        策略层从不产出 <code>require_approval</code> / <code>require_handoff</code>：
        这两个值只出现在协议 schema、数据库 CHECK 约束与校验器里，
        <strong>
          没有任何 <code>decision(...)</code> 调用传过它们
        </strong>
        。
      </li>
    </ul>
    <p>
      渲染端还留着一个<strong>故意封死</strong>的通道：<code>computer-use:approve-action</code>{' '}
      永远抛错，文案是
      <em>
        「Computer actions can be approved only through the native one-time confirmation surface」
      </em>
      （<code>registerComputerUseIpc.ts:294-302</code>）。
      也就是说，即使未来要做逐动作审批，也不打算走渲染端界面。
    </p>
    <p>
      唯一与「完全放行」相关的判断是 <code>isFullAccess</code>： 它只认 <code>claude-bypass</code>{' '}
      与 <code>codex-full-access</code> 两个模式 （
      <code>ComputerActionApprovalPresenter.ts:51-53</code>，注意
      <strong>
        不含任何 <code>spark-*</code> 模式
      </strong>
      ）。但既然这条链已停用，它当前不产生实际差异。
    </p>

    <h2 id="policy">4. 策略引擎与它的真实边界</h2>
    <p>
      所有动作的风险判定都来自 <code>ComputerPolicyService.evaluate</code>（
      <code>apps/desktop/src/main/services/computer-use/ComputerPolicyService.ts:43-82</code>），
      它唯一的调用点是 Broker（<code>ComputerControlBroker.ts:181</code>）。 这个类
      <strong>只有 129 行</strong>
      ，但它的边界必须讲清楚，否则很容易写出「策略引擎会拦截危险动作」这种错误结论。
    </p>

    <h3 id="risk-levels">4.1 L0–L4 是怎么算出来的</h3>
    <p>
      风险等级由两个来源取<strong>较大值</strong>：动作基线风险，与策略上下文里的 effect 风险。
    </p>
    <p>
      动作基线表（<code>ComputerPolicyService.ts:26-41</code>）：
    </p>
    <table>
      <thead>
        <tr>
          <th>基线</th>
          <th>动作</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>L0</code>
          </td>
          <td>
            <code>observe</code>、<code>move</code>、<code>scroll</code>、<code>wait_for</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>L1</code>
          </td>
          <td>
            <code>focus_window</code>、<code>select_text</code>、<code>set_value</code>、
            <code>type_text</code>、<code>paste_text</code>、<code>invoke_element</code>、
            <code>click</code>、<code>drag</code>、<code>keypress</code>、<code>app_command</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      effect 风险表（<code>:10-16</code>）：<code>read_only</code>→L0、<code>reversible_local</code>
      →L1、<code>external_write</code>→L2、<code>high_impact</code>→L3、<code>restricted</code>→L4。
    </p>
    <p>
      三条升级规则（<code>:59-73</code>）：
    </p>
    <ul>
      <li>
        <code>policyContext.target.kind === 'unknown'</code> → 至少 L2。
      </li>
      <li>
        敏感文本写入 → 若数据类含 <code>credential</code> 则 <strong>L4</strong>，否则 L2。
      </li>
      <li>
        本地文本写入且数据类含非 <code>public</code> → 至少 L2。
      </li>
    </ul>
    <p>
      <strong>但要注意这些升级规则里有一部分在生产路径不可达</strong>， 因为{' '}
      <code>policyContext</code> 的唯一生产者是 <code>policyContextFor</code>（
      <code>ComputerActionPolicyContext.ts:9-59</code>，被算子与原子路径共用），而它：
    </p>
    <ul>
      <li>
        <strong>只产出 3 种 effect</strong>：<code>read_only</code>、<code>reversible_local</code>、
        <code>external_write</code>（<code>:45-52</code>）。 因此 <code>high_impact</code>（L3）与{' '}
        <code>restricted</code>（L4）<strong>无法从生产代码产生</strong>—— 它们只出现在测试里。
      </li>
      <li>
        <strong>
          只产出 <code>element</code> 或 <code>window</code>
        </strong>{' '}
        两种 target kind （<code>:53-55</code>），所以 <code>unknown</code> → L2 那条规则也不可达。
      </li>
      <li>
        <strong>只产出 3 种数据类组合</strong>：<code>[]</code>、<code>['public']</code>、
        <code>['credential']</code>（<code>:56</code>）。 所谓 personal / financial / health
        等分类在生产路径不会出现。
      </li>
    </ul>
    <p>
      还有一个设计上值得注意的点：<code>policyContextFor</code> 用一个
      <strong>
        正则匹配模型自己写的 <code>intent</code> 文本
      </strong>
      来决定 effect 是否升级为 <code>external_write</code>（<code>:26-29</code>，命中{' '}
      <code>send|submit|publish|post|purchase|buy|pay|delete|remove|confirm|book|order</code>{' '}
      或对应中文词即升级）。也就是说，<strong>风险等级有一部分取决于模型怎么描述自己的意图</strong>
      ， 而不是纯粹取决于动作本身。
    </p>
    <p>
      顺带一个反直觉的结论：<code>invoke_element</code> 在<strong>普通语义调用</strong>时 （
      <code>action</code> 为空或为 <code>'invoke'</code>）既不算 read_only、也不算
      reversible_local， 会落到 <code>external_write</code> → <strong>L2</strong>。
      也就是说最常用的「点按钮」动作拿到的是 L2，而带 <code>select</code>/<code>expand</code>{' '}
      等显式子动作时才是 L1（<code>:35-40</code> 与 <code>policyContextFor:35-43</code> 的差异）。
    </p>

    <h3 id="always-allow">4.2 唯一的硬拒绝是 focus_mismatch</h3>
    <p>
      这是本节最重要的结论：<code>evaluate</code>{' '}
      <strong>
        在所有分支上都返回 <code>'allow'</code>
      </strong>
      ，唯一的 <code>'deny'</code> 出现在开头—— 观测到的应用 id 与动作的目标应用 id 不一致时 （
      <code>ComputerPolicyService.ts:52-54</code>）：
    </p>
    <pre>
      <code>{`if (observedApp.id !== envelope.targetAppId) {
  return decision(envelope.actionId, 'L1', 'deny', 'focus_mismatch', false)
}`}</code>
    </pre>
    <p>
      其余所有情况都走到底部的 <code>allow</code>（<code>:75-81</code>），reason 只有两种： L0 时是{' '}
      <code>read_only_action</code>，其余是 <code>within_task_scope</code>。 连 L2
      的「外部写入」也一样放行——测试标题直接写着
      <em>「allows external writes and high-impact actions without per-action approval」</em>（
      <code>ComputerPolicyService.test.ts:87</code>）。
    </p>
    <p>
      <strong>换个说法</strong>：这个策略引擎的产出是「<strong>风险标签</strong>」，不是「拦截器」。
      它会告诉你某个动作多危险（写进 <code>computer_actions.risk_level</code>，
      并在活动卡片里展示），但不因此阻止它。 真正的刹车是<strong>预算</strong>、
      <strong>新鲜度校验</strong>、<strong>用户接管</strong>与 <strong>kill switch</strong>
      ，而不是内容策略。
    </p>
    <p>
      另外 <code>focus_mismatch</code> 在原子路径上几乎不会出现， 因为 envelope 的{' '}
      <code>targetAppId</code> 就是 <code>observation.foreground.app.id</code>（
      <code>ComputerAtomicActionService.ts:208</code>），<strong>必然自洽</strong>。
      实际抛这个码的是原生宿主与快照服务，不是策略层。
    </p>

    <h3 id="task-contract">4.3 任务契约里哪些字段真的生效</h3>
    <p>
      <code>start_task</code> 会构造一个 <code>ComputerTaskContract</code>（
      <code>ComputerUseAgentController.ts:430-441</code>）。 这个契约有 10 个字段，但
      <strong>策略引擎完全不用它</strong>——
      <code>evaluate</code> 的形参名是 <code>_taskContract</code>（下划线表示未使用，
      <code>ComputerPolicyService.ts:46</code>）。实测各字段的强制力：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>生产值</th>
          <th>是否真的生效</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>objective</code>
          </td>
          <td>用户目标</td>
          <td>✅ 进决策提示词与日志</td>
        </tr>
        <tr>
          <td>
            <code>successCriteria</code>
          </td>
          <td>由目标/验收条件推导</td>
          <td>✅ 验收引擎实际使用</td>
        </tr>
        <tr>
          <td>
            <code>maxSteps</code>
          </td>
          <td>
            <code>100</code>
          </td>
          <td>
            ✅ 超限抛 <code>task_step_limit_exceeded</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>maxRuntimeMs</code>
          </td>
          <td>
            <code>1200000</code>（20 分钟）
          </td>
          <td>
            ✅ 超限抛 <code>task_runtime_exceeded</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>maxConsecutiveNoops</code>
          </td>
          <td>
            <code>8</code>
          </td>
          <td>✅ 连续无变化即中止</td>
        </tr>
        <tr>
          <td>
            <code>allowedApps</code>
          </td>
          <td>
            恒 <code>[]</code>
          </td>
          <td>
            ❌ <strong>无任何读取点</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>allowedDomains</code>
          </td>
          <td>
            恒 <code>[]</code>
          </td>
          <td>
            ❌ <strong>无任何读取点</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>allowedDataClasses</code>
          </td>
          <td>
            恒 <code>['public','internal','personal']</code>
          </td>
          <td>
            ❌ <strong>无任何读取点</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>forbiddenActions</code>
          </td>
          <td>
            恒 <code>[]</code>
          </td>
          <td>
            ❌ <strong>无任何读取点</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>userPresence</code>
          </td>
          <td>
            恒 <code>'required'</code>
          </td>
          <td>
            ❌ 从不与 <code>requiresUserPresence</code> 比较
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      后 5 个字段的声明本身就在协议里写了理由——它们标注为桌面执行<strong>不使用</strong>应用白名单
      （<code>packages/protocol/src/computer-use/session.ts:55-57</code> 的注释）。 所以文档里
      <strong>不能写「任务契约限制了可操作的应用/域名/动作」</strong>，
      当前实现里没有这个约束。生产者只有两处，且写的都是空值/常量：
      <code>ComputerAtomicActionService.ts:61-68</code> 与{' '}
      <code>ComputerUseAgentController.ts:433-440</code>。
    </p>
    <p>
      同理，<code>bind_target</code> 的工具描述里写着
      <em>
        「bind to a new window whose strong application identity is already allowed by the task
        contract」
      </em>
      （<code>ComputerUseAgentBridge.ts:516-517</code>），但代码
      <strong>
        从不校验 <code>allowedApps</code>
      </strong>
      。照工具描述写文档会出错。
    </p>

    <h2 id="atomic">5. 原子动作链路</h2>
    <p>
      这条路径让<strong>会话模型自己成为电脑操作 agent</strong>：一次工具调用只下发一个动作，
      返回新的元素树与截图，模型据此决定下一步。这是 Codex 风格的决策架构， 与{' '}
      <code>start_task</code> 的委派模型并存 （<code>ComputerAtomicActionService.ts:74-80</code>{' '}
      的类注释）。
    </p>

    <h3 id="atomic-tools">5.1 十个原子工具</h3>
    <p>
      原子工具名记录在 <code>ATOMIC_TOOL_NAMES</code>，控制器据此分流 （
      <code>ComputerUseAgentController.ts:190-192</code> → <code>:487-501</code>）：
      <code>click</code>、<code>type_text</code>、<code>paste</code>、<code>set_value</code>、{' '}
      <code>invoke_element</code>、<code>press_key</code>、<code>scroll</code>、<code>drag</code>、{' '}
      <code>select_text</code>、<code>perform_secondary_action</code>。 每次调用都会
      <strong>重做一次能力预检</strong>（<code>:493-496</code>）， 所以中途撤销系统权限会立刻生效。
    </p>
    <p>
      工具优先级在系统提示词里有明确排序（<code>computer-use-system-prompt.ts</code> 的{' '}
      <code>## Tool priority</code> 段）：语义元素动作 &gt; 元素定向点击 &gt; 原始截图坐标 &gt;
      键盘。 坐标是最后手段，且是<strong>最新截图里的像素坐标、左上角原点</strong>。
    </p>

    <h3 id="click-rewrite">5.2 click 的语义改写与坐标换算</h3>
    <p>两个容易踩的实现细节：</p>
    <ul>
      <li>
        <strong>元素左键单击会被改写成语义调用</strong>，不是合成鼠标事件：当 <code>at</code> 是{' '}
        <code>elementId</code>、按钮为左键（默认）、点击次数为 1 时， 实际下发的是{' '}
        <code>invoke_element</code>（<code>ComputerAtomicToolHandlers.ts:250-268</code>）。
        这也是「不抢焦点」能成立的原因——走的是无障碍语义，不是全局鼠标事件。
      </li>
      <li>
        <strong>坐标要按模型看到的图换算</strong>：模型收到的截图可能已被降采样，
        所以坐标换算用的是「返回给模型那张图的尺寸」而非原始截图尺寸， 并且会被 <code>clamp01</code>{' '}
        夹到 [0,1] 的归一化窗口坐标 （<code>:532-545</code>、<code>:584</code>）。
      </li>
    </ul>
    <p>
      另一个反直觉的点：<code>type_text</code> / <code>paste</code> 带 <code>into</code> 时， 会
      <strong>
        先额外下发一次 <code>invoke_element(action: 'focus')</code>
      </strong>
      ； 若再带 <code>submit: true</code>，还会
      <strong>
        追加一次 <code>keypress ['Enter']</code>
      </strong>
      （<code>:411-443</code>、<code>:445-477</code>）。
      也就是说一次「工具调用」在时间线与动作表里可能是<strong>三条记录</strong>。
      排查时按工具名数动作会数错。
    </p>

    <h3 id="atomic-session">5.3 隐式会话与空闲释放</h3>
    <p>
      原子路径为每个 Agent 会话维护<strong>一个隐式电脑会话</strong>， 复用的状态是{' '}
      <code>preflighting</code> / <code>observing</code> / <code>planning</code> /{' '}
      <code>waiting_approval</code> / <code>acting</code>（
      <code>ComputerAtomicActionService.ts:27-33</code>）。 空闲 <strong>5 分钟</strong>（
      <code>IDLE_RELEASE_MS = 300_000</code>，<code>:50</code>）后释放， 下次调用再透明重建。
    </p>
    <p>
      空闲计时器有两个细节：用 <code>unref()</code> 不阻塞进程退出（<code>:125</code>）， 且{' '}
      <code>observe</code>/<code>dispatch</code>{' '}
      <strong>进入时先清掉计时器、finally 再重新装</strong>（<code>:147</code>、
      <code>:186-191</code>）——注释解释了原因： 计时器若在动作中途触发，会伪造出一个{' '}
      <code>session_canceled</code>。
    </p>
    <p>
      为什么释放要这么久？源码注释给了解释：推理模型在两次工具调用之间常常思考数分钟，
      太短的计时器会让任务卡片在过程中反复消失又出现（原文用了「断断续续」这个词），
      并强制每次调用都重启截图流。macOS 的持久捕获另有 90 秒帧空闲停放，
      用来在不打断会话的前提下熄灭系统的「屏幕共享」指示。
    </p>
    <p>
      陈旧错误会<strong>自动自愈一次</strong>：<code>stale_frame</code> / <code>stale_tree</code> /{' '}
      <code>focus_mismatch</code> 命中后， 会自动重新观测、重建动作并重试一次（<code>:19</code>、
      <code>:173-185</code>）。 所以模型看到 <code>stale_tree</code> 时更可能应该
      <strong>换一个新元素 id</strong>， 而不是重复同一个调用。
    </p>

    <h2 id="start-task">6. 委派任务链路</h2>
    <p>
      <code>start_task</code> 让 Agent 把一整个目标交出去，由独立的决策循环在后台跑到结束。 它走的
      <strong>不是渲染端 IPC</strong>，而是主进程内置的 HTTP MCP 服务器。
    </p>

    <h3 id="start-chain">6.1 从 MCP 调用到算子循环</h3>
    <p>完整链路（每一步都有对应的失败收敛）：</p>
    <ol>
      <li>
        <strong>MCP 桥</strong>：<code>ComputerUseAgentBridge</code> 校验 bearer 令牌后， 把{' '}
        <code>tools/call</code> 转成 <code>controller.invoke(sessionId, toolName, args)</code>（
        <code>ComputerUseAgentBridge.ts:677-683</code>）。 令牌是 32 随机字节的 base64url，
        <strong>TTL 30 分钟且每次鉴权滑动续期</strong>（<code>:551-559</code>、<code>:708-722</code>
        ）。
      </li>
      <li>
        <strong>能力预检</strong>：<code>start_task</code> 先取 <code>getCapabilities()</code>，
        不支持执行就直接抛（<code>ComputerUseAgentController.ts:409-412</code>），
        并检查本轮上下文是否存在（<code>:413-414</code>）。
      </li>
      <li>
        <strong>环境校验</strong>：只接受 <code>my_desktop</code>，其余抛
        <em>「This build currently provides governed execution only on My Desktop」</em>（
        <code>:416-418</code>）。工具入参的 Zod 也把 <code>environment</code> 收成{' '}
        <code>z.literal('my_desktop')</code>（<code>:659</code>）。
      </li>
      <li>
        <strong>目标解析</strong>：给了 <code>targetApp</code> 就按应用标识解析并直接前台化； 否则用{' '}
        <code>targetWindowId</code>，都没有则报错（<code>:419-424</code>）。
      </li>
      <li>
        <strong>决策模型解析</strong>：<code>resolveDecisionModel(sessionId)</code>（
        <code>:425</code>）。
      </li>
      <li>
        <strong>建会话</strong>：写 <code>computer_sessions</code> 行并记{' '}
        <code>computer_session_started</code> 事件（<code>ComputerSessionManager.ts:123-147</code>
        ）。
      </li>
      <li>
        <strong>占用桌面通道</strong>：<code>coordinator.claim(computerSession.id, sessionId)</code>
        （<code>:459</code>）。
      </li>
      <li>
        <strong>激活并起循环</strong>：<code>sessions.activate()</code> 把状态置{' '}
        <code>observing</code>，然后 <code>launchOperator</code> 在后台跑{' '}
        <code>ComputerTaskOperator.run()</code>（<code>:460-463</code>）。
      </li>
    </ol>
    <p>
      失败会回滚：除 <code>session_canceled</code> 外的异常都会 <code>broker.stop</code> +{' '}
      <code>coordinator.release</code>（<code>:468-476</code>）。
    </p>

    <h3 id="coordinator">6.2 桌面独占通道</h3>
    <p>
      同一时刻只能有一个任务真正驱动桌面，由 <code>ComputerDesktopExecutionCoordinator</code>{' '}
      串行化（<code>ComputerDesktopExecutionCoordinator.ts:30-69</code>）。规则是
      <strong>非对称</strong>的：
    </p>
    <ul>
      <li>
        <strong>同一个 Agent 会话</strong>再次 claim：只是<strong>转移</strong>通道，
        不杀兄弟会话——这样 <code>start_task</code> 与原子截图/点击可以并存（<code>:38-41</code>）。
      </li>
      <li>
        <strong>不同的 Agent 会话</strong>claim：会停掉前一个持有者<strong>及其全部同名会话</strong>
        （<code>:46-63</code>）。
      </li>
    </ul>
    <p>
      值得注意的是 <code>sessions.activate()</code> <strong>不创建持久化 actuator lease</strong>（
      <code>ComputerSessionManager.ts:231-255</code>，注释说明 lease 由主进程的 coordinator 接管）。
      所以 <code>computer_actuator_leases</code> 表与 <code>actuator_lease_conflict</code>{' '}
      错误码在这条路径上主要作为兜底存在。
    </p>

    <h3 id="lifecycle">6.3 状态与事件枚举</h3>
    <p>
      会话状态共 <strong>11 个</strong>（
      <code>packages/protocol/src/computer-use/session.ts:16-28</code>， 数据库侧是同一份）：
    </p>
    <pre>
      <code>{`preflighting | observing | planning | waiting_approval | acting
| verifying | paused | handoff_required | completed | failed | canceled`}</code>
    </pre>
    <p>其中要区分三组不同用途的子集：</p>
    <ul>
      <li>
        <strong>后端认的执行态只有 4 个</strong>：<code>observing</code> / <code>planning</code> /{' '}
        <code>waiting_approval</code> / <code>acting</code>（<code>EXECUTABLE_STATUSES</code>，
        <code>ComputerSessionManager.ts:26-31</code>）—— 注意<strong>不含</strong>{' '}
        <code>preflighting</code> 与 <code>verifying</code>。
      </li>
      <li>
        主进程可写入的 phase 有 7 个（<code>:33-40</code>）。
      </li>
      <li>
        对 Agent 可见的算子运行态是另一层：
        <code>running</code> / <code>completed</code> / <code>failed</code> /{' '}
        <code>handoff_required</code> / <code>not_running</code>（
        <code>ComputerUseAgentController.ts:34-37</code>、<code>:575</code>）。
      </li>
    </ul>
    <p>
      <code>waiting_approval</code> 这个状态虽然被列进可执行集合与 phase 类型，但
      <strong>没有任何生产代码把会话置为该状态</strong>，与第 3.4 节「审批链停用」是同一个事实。
    </p>
    <p>
      时间线事件共 <strong>14 种</strong>（
      <code>packages/protocol/src/computer-use/events.ts:24-142</code>）：
      <code>session_started</code>、<code>observation_created</code>、<code>action_requested</code>
      、<code>action_blocked</code>、<code>action_executed</code>、<code>action_failed</code>、
      <code>approval_requested</code>、<code>approval_resolved</code>、
      <code>verification_started</code>、<code>verification_completed</code>、
      <code>handoff_required</code>、<code>session_completed</code>、<code>session_failed</code>、
      <code>session_canceled</code>。 其中 <code>approval_requested</code> 同样
      <strong>没有任何生产发出点</strong>。
    </p>
    <p>
      还有一个排查陷阱：<strong>暂停不产生时间线事件</strong>。
    </p>
    <p>
      所以活动卡片的状态徽标只看<strong>最后一条事件</strong>， 非终态一律显示「进行中」（
      <code>ComputerActivityBlock.tsx:381-396</code>）—— 你按了暂停，卡片可能仍显示「进行中」。
    </p>

    <h2 id="controls">7. 五个控制工具的真实语义</h2>
    <p>
      这五个工具的名字都很好懂，但代码行为与名字的暗示有两处明显偏差。 入口在{' '}
      <code>ComputerUseAgentController</code> 的 <code>switch</code>。
    </p>

    <h3 id="pause-takeover">7.1 pause 与 takeover 在主进程路径上逐行等价</h3>
    <p>
      两者都是「硬暂停」：调 <code>broker.pause</code>、释放通道、作废本次运行记录。
    </p>
    <pre>
      <code>{`case 'pause': {                                    // :320-326
  const paused = await services.broker.pause(computerSession.id)
  services.coordinator.release(computerSession.id)
  this.invalidateRun(services, computerSession.id)
  return { computerSession: paused }
}
case 'takeover': {                                 // :334-340
  const paused = await services.broker.pause(computerSession.id)
  services.coordinator.release(computerSession.id)
  this.invalidateRun(services, computerSession.id)
  return { computerSession: paused }
}`}</code>
    </pre>
    <p>
      <strong>唯一的差别在渲染端 IPC 路径</strong>：<code>computer-use:takeover</code> 会额外记录
      owner 归属，供后续 <code>resume</code> / <code>bind-target</code> 做归属校验 （
      <code>registerComputerUseIpc.ts:245-254</code>）。 但无论哪条路径，
      <strong>它都不会把窗口或输入交给用户，也不激活任何窗口</strong>—— 「接管」的实际含义是「停下
      Agent，让用户自己接手」。
    </p>
    <p>
      底层 <code>broker.pause</code> 做三件事（<code>ComputerControlBroker.ts:314-320</code>）：
      清观测缓存、撤销待审批、<code>executor.cancelSession()</code> <strong>中断在途动作</strong>
      ；随后会话状态置 <code>paused</code> 并 abort 掉当前 controller （
      <code>ComputerSessionManager.ts:319-336</code>）。 在途打字会被停在半途，拖拽会松开按键。
    </p>

    <h3 id="resume">7.2 resume 只有一条路能真正恢复运行</h3>
    <p>
      MCP 路径的 <code>resume</code> 会<strong>重新拉起算子循环</strong>（<code>:341-368</code>
      ）：校验必须是 <code>paused</code> → 重新解析决策模型 → 重新 claim 通道 →{' '}
      <code>broker.resume</code> → <code>launchOperator</code>。 失败会把会话重新暂停并释放通道（
      <code>:360-367</code>）。
    </p>
    <p>
      而
      <strong>
        渲染端 IPC 版的 <code>resume</code> 只调 <code>broker.resume</code>，不重启算子
      </strong>
      （<code>registerComputerUseIpc.ts:208-232</code>）。 如果它被调用，会话会停在{' '}
      <code>observing</code> 而没有任何驱动。 好消息是渲染端当前<strong>根本没有调用它</strong>（见
      12.2）。
    </p>

    <h3 id="wait">7.3 wait_for_completion 是有界等待，超时不算失败</h3>
    <p>
      它的实现是「先看当前状态，若已是会返回的状态就直接返回，
      否则挂到会话状态订阅上等，直到超时」（<code>:591-629</code>）。 会立即返回的状态集合是 6 个（
      <code>:39-46</code>）：
      <code>completed</code> / <code>failed</code> / <code>canceled</code> / <code>paused</code> /{' '}
      <code>waiting_approval</code> / <code>handoff_required</code>。
    </p>
    <ul>
      <li>
        超时参数默认 <strong>120 秒</strong>，允许范围 100–300000 毫秒（<code>:707-712</code>）。
      </li>
      <li>
        超时返回体里带 <code>timedOut: true</code>，<strong>不代表任务失败</strong>。
      </li>
      <li>
        命中终态时还会<strong>等算子收尾完成</strong>再返回（<code>finishAfterCleanup</code>，
        <code>:609-615</code>），所以返回值里的 <code>operator</code> 字段是可信的。
      </li>
      <li>
        任务失败时额外附带一条 continuation 提示，让 Agent 向用户报告失败并询问兜底方案 （
        <code>:571-589</code>）。
      </li>
    </ul>

    <h3 id="bind-target">7.4 bind_target 的先决条件是「已暂停」</h3>
    <p>
      这是<strong>唯一能显式更换目标窗口</strong>的工具，而且必须在会话 <code>paused</code>{' '}
      状态下调用，否则抛错
      <em>「Pause the Computer Use task before changing its bound target window」</em>（
      <code>ComputerUseAgentController.ts:303-319</code>）。
    </p>
    <p>
      绑定后的行为变化（<code>NativeHostComputerUseBackend.ts:370-376</code>）：
    </p>
    <ul>
      <li>清掉该会话的观测缓存，强制下一步必须重新观测。</li>
      <li>
        后续观测<strong>不再跟随前台窗口变化</strong>，而是锁定绑定的窗口与所属应用。
      </li>
    </ul>
    <p>
      这正好解释了系统提示词里那句「你的会话绑定在它自己的应用上：
      用户中途切到别的应用也继续干」——绑定是<strong>默认行为</strong>（<code>start_task</code>{' '}
      时建立），
      <code>bind_target</code> 是中途改绑。 界面上对应的是卡片里的「更换窗口」按钮，它
      <strong>只在暂停态出现</strong>（<code>ComputerActivityBlock.tsx:318-327</code>
      ），窗口列表会过滤掉最小化的窗口。
    </p>
    <p>
      另外 <code>stop</code> 的请求体里有一个 <code>reason</code> 字段， schema 接受但在 handler 里
      <strong>未被解构使用</strong>
      （协议 <code>ipc.ts:88-93</code> vs <code>registerComputerUseIpc.ts:234</code>）——传了也没用。
    </p>

    <h2 id="verification">8. 验收是怎么判定的</h2>
    <p>
      委派任务不会「跑完就算成功」：它必须通过 <code>ComputerVerificationEngine</code> 对{' '}
      <code>successCriteria</code> 的逐条判定（<code>ComputerVerificationEngine.ts:19-30</code>）。
      判定结果只有 4 种 reason：<code>assertion_passed</code>、<code>assertion_failed</code>、
      <code>unsupported_evidence</code>、<code>model_visual_assertion</code>。 整体通过的条件是「
      <strong>至少一条判据且全部通过</strong>」。
    </p>

    <h3 id="three-kinds">8.1 三种 kind 的判定规则</h3>
    <table>
      <thead>
        <tr>
          <th>kind</th>
          <th>支持的断言</th>
          <th>判定方式</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>accessibility</code>
          </td>
          <td>
            <code>exists</code> / <code>visible</code> / <code>enabled</code> / <code>focused</code>{' '}
            / <code>value_equals</code> / <code>text_contains</code>
          </td>
          <td>
            在元素树里筛匹配元素，<strong>只看第一个</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>visual</code>
          </td>
          <td>
            <code>text_present</code> / <code>text_absent</code>
          </td>
          <td>
            把树文本 + 无障碍文本拼成字符串做 <code>includes</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>application_state</code>
          </td>
          <td>
            <code>frontmost</code> / <code>window_exists</code> / <code>running</code> /{' '}
            <code>window_title_contains</code>
          </td>
          <td>比对前台应用 id 或窗口清单</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>accessibility</code> 的 selector 是「填了的字段都需匹配」的 AND 关系， 且
      <strong>只检查第一个匹配元素</strong>（<code>:136</code> 的 <code>elements[0]</code>）——
      如果界面里有同名的多个元素，判定只看第一个。
      <code>visible</code> 的判定是「存在且宽高都大于 0」（<code>:121-152</code>）。
    </p>
    <p>
      <code>application_state</code> 里有一条<strong>非对称</strong>规则值得记住：
      <code>running</code> 在 <code>expected: true</code> 时用「存在窗口」证明它在运行； 但在{' '}
      <code>expected: false</code> 时，<strong>没有窗口并不能证明它没在运行</strong>， 于是返回{' '}
      <code>null</code> → 归为 <code>unsupported_evidence</code>（<code>:85-91</code>
      ）。写判据时不要依赖「应用未运行」这种否定断言。
    </p>

    <h3 id="visual-fallback">8.2 visual 判定有一条模型兜底</h3>
    <p>
      这是整套验收里最需要讲清楚的一条。当一条 <code>visual</code> 判据的字符串匹配
      <strong>没有通过</strong>，但同时满足另外两个条件时，引擎会判<strong>通过</strong>， reason
      记为 <code>model_visual_assertion</code>（<code>:48-69</code>）：
    </p>
    <ul>
      <li>
        <code>modelVisualApproval === true</code>——由决策模型主动声明「可以验收了」时传入；
      </li>
      <li>
        <strong>原生树没有可用证据</strong>——即树版本不是 <code>visual-</code> 开头、
        元素为空、且树文本是空 / <code>[]</code> / 空的 diff。
      </li>
    </ul>
    <p>
      这条兜底的用意是：Canvas、Electron 自绘界面等场景可能<strong>完全没有无障碍元素</strong>，
      此时不能因为「字符串匹配不到」就永远判失败。 但它也意味着
      <strong>视觉类验收在无树可读时依赖模型自述</strong>——
      <code>modelVisualApproval</code> 由算子在模型说「ready_for_verification」时传{' '}
      <code>true</code>（<code>ComputerTaskOperator.ts:278</code>）， 而自动校验路径传{' '}
      <code>false</code>（<code>:193</code>）。
    </p>
    <p>
      判据的来源有三层兜底：显式 <code>successCriteria</code> → 文本形式的{' '}
      <code>acceptanceCriteria</code>（会被翻译成 visual 的 <code>text_present</code>）→ 从 goal
      里抽引号内文本 → 都拿不到时退化为 <code>application_state</code> 的{' '}
      <code>frontmost(desktop)</code>（<code>ComputerUseAgentController.ts:770-816</code>）。
    </p>

    <h3 id="verification-gaps">8.3 验收的两个现存缺口</h3>
    <p>
      <strong>缺口一：三种 kind 声明了但引擎不支持。</strong>
    </p>
    <p>
      协议里的 <code>VerificationSpec</code> 允许 <code>dom</code> / <code>file</code> /{' '}
      <code>external_readback</code> 三种 kind （
      <code>packages/protocol/src/computer-use/verification.ts:164-207</code>）， 但{' '}
      <code>ComputerVerificationEngine</code> 里<strong>没有任何分支处理它们</strong>：
      <code>passed</code> 保持 <code>null</code> → 归为 <code>unsupported_evidence</code> →{' '}
      <code>passed = false</code>，任务将<strong>永远无法通过验收</strong>，
      只会一直把失败反馈给模型、直到步数或时长预算耗尽。
    </p>
    <p>
      好消息是 MCP 侧 <code>start_task</code> 的入参 schema <strong>只暴露了三种可用 kind</strong>（
      <code>ComputerUseAgentBridge.ts:70-157</code>），所以正常调用不会踩到。 但「schema
      支持」不等于「能验收」这个区别要记住。
    </p>
    <p>
      <strong>缺口二：验收结果不落库。</strong>
    </p>
    <p>
      <code>ComputerTaskOperator</code> 的 <code>verifications</code> 依赖在构造函数里赋值后
      <strong>全文再无读取</strong>（声明于 <code>:117</code>、赋值于 <code>:144</code>
      ，仅此三处），
      <code>ComputerVerificationRepository.create/complete</code> 也<strong>零生产调用</strong>。
      结果是 <code>computer_verifications</code> 表在生产路径恒为空， 会话完成事件里的{' '}
      <code>verificationIds</code> 恒为 <code>[]</code>（
      <code>ComputerSessionManager.ts:394-400</code>）， 而{' '}
      <code>computer-use:get-verification</code> 必然返回 <code>null</code>
      （该通道在渲染端也零调用）。
    </p>
    <p>
      也就是说：<strong>验收判定在本次运行内生效（决定任务是否算完成），但不留档</strong>。
      事后要复现「为什么判通过」只能看活动时间线里的 <code>verification_completed</code> 事件。
    </p>

    <h2 id="native-host">9. 原生宿主</h2>
    <p>
      这是电脑操作与其他所有能力最大的架构差异：真正的观测与输入
      <strong>不在 Electron 进程里</strong>， 而在一个独立的原生子进程中完成。
    </p>

    <h3 id="why-native">9.1 为什么必须有原生宿主</h3>
    <p>
      代码里<strong>不存在纯 Electron/JS 的替代实现</strong>——后端只有两个类： 真实现{' '}
      <code>NativeHostComputerUseBackend</code>（<code>NativeHostComputerUseBackend.ts:171</code>
      ）与占位
      <code>UnavailableComputerUseBackend</code>（<code>ComputerUseBackend.ts:58</code>）。
      平台/架构不匹配时<strong>直接降级为不可用</strong>，没有 JS 兜底 （
      <code>NativeHostBackendFactory.ts:54-59</code>）。
    </p>
    <p>
      原因从协议枚举就能看出来——它把后端技术写死成原生 API 名： screen 只能是{' '}
      <code>screen_capture_kit</code> / <code>windows_graphics_capture</code> /{' '}
      <code>xdg_portal</code> / <code>x11</code>， accessibility 只能是 <code>axui_element</code> /{' '}
      <code>uia</code> / <code>at_spi</code>， input 只能是 <code>cg_event</code> /{' '}
      <code>send_input</code> / <code>xdg_remote_desktop</code>（
      <code>packages/protocol/src/computer-use/native-wire.ts:38</code>）。 macOS 宿主实际调用的 API
      包括 ScreenCaptureKit（<code>SCScreenshotManager</code>、 <code>SCContentFilter</code>）、
      <code>CGEventPostToPid</code>、Vision OCR， 以及一个用 <code>dlsym</code> 动态解析的私有 SPI{' '}
      <code>_AXUIElementPostNotification</code>（<code>MacFocusForger.swift:16-18</code> 说明该符号
      「存在于所有已发布的 macOS 的 HIServices 中，但不在公开 SDK 头文件里」）。 Windows 宿主用
      Windows.Graphics.Capture、UIA COM 与 <code>PostMessageW</code>。 这些都是 JS 拿不到的能力。
    </p>
    <p>
      macOS 上还有一条实践证据解释了为什么必须做原生无障碍读取：Electron/Chromium 应用
      <strong>
        必须设置私有属性 <code>AXManualAccessibility</code> 才会暴露内容树
      </strong>
      ， 否则只能读到一个几乎空的树 （<code>MacAccessibilityController.swift:42-44</code>
      ，注释把这件事称作「竞争对手能读到 Electron 应用结构树而我们之前只看到空树」的最大原因）。
    </p>

    <h3 id="trust">9.2 双向签名校验</h3>
    <p>
      主进程用 <code>spawn</code> 拉起宿主，<code>shell: false</code>、stdio 管道 （
      <code>NativeHostClient.ts:147</code>）。信任是<strong>双向</strong>的：
    </p>
    <p>
      <strong>主进程 → 宿主</strong>（校验可执行文件）：
    </p>
    <ul>
      <li>
        macOS：要求宿主的 Team ID 与<strong>当前 App 自己的签名 Team ID 一致</strong>，
        并逐项核对标识符、SHA-256、文件名、平台、架构 （<code>NativeHostArtifact.ts:282-288</code>、
        <code>NativeHostBackendFactory.ts:163-171</code>）； 还会用{' '}
        <code>codesign --verify --strict</code> 并生成 requirement 复核（<code>:473</code>、
        <code>:607</code>）。
      </li>
      <li>
        Windows：用 PowerShell 取签名者证书 SHA-256，同样与 App 自身指纹绑定 （
        <code>NativeHostArtifact.ts:592-596</code>、<code>NativeHostBackendFactory.ts:111-118</code>
        ）。
      </li>
      <li>
        文件级约束：manifest ≤ 64 KiB、可执行 ≤ 256 MB、必须是常规文件且非符号链接、 POSIX 下不得
        group/world 可写、版本不得低于 <code>0.1.0</code>（<code>NativeHostArtifact.ts:11-14</code>
        、<code>:412-425</code>）。
      </li>
    </ul>
    <p>
      <strong>宿主 → 父进程</strong>（校验谁拉起了自己）：
    </p>
    <ul>
      <li>
        macOS 的 <code>ParentProcessTrustPolicy</code> 要求：宿主标识符为{' '}
        <code>com.spark-agent.desktop.computer-host</code>、父标识符为{' '}
        <code>com.spark-agent.desktop</code>、
        <strong>
          双方都必须 <code>anchor apple generic</code>
        </strong>
        、 且双方 Team ID 非空且相等（<code>ParentProcessTrustPolicy.swift:49-74</code>）。
        校验在宿主启动最前面执行，失败即 <code>exit(EX_NOPERM)</code>（=77） （
        <code>HostMain.swift:10-13</code>）。
      </li>
      <li>
        Windows 同样先验自己、再验父进程签名者指纹，并要求父进程产品名为 <code>SparkWork</code>{' '}
        且镜像路径以 <code>sparkwork.exe</code> 结尾 （<code>runtime_auth.rs:45-80</code>、
        <code>parent_auth.rs:91-102</code>）。 它用 <code>WinVerifyTrust</code>{' '}
        且只接受缓存内的吊销检查（可离线）， 并且只信任已验证的叶子证书——注释明确说明
        <strong>绝不扫描未认证的 PKCS#7 证书袋</strong>， 因为攻击者可以往里面追加东西（
        <code>runtime_auth.rs:221-235</code>）。
      </li>
      <li>
        两端都做了<strong>防 PID 复用</strong>：取父进程 id 前后各一次并比对进程创建时间 （
        <code>ParentProcessAuthorizer.swift:99-109</code>、<code>parent_auth.rs:81-84</code>）。
      </li>
    </ul>
    <p>
      有一套<strong>「本地信任」旁路</strong>需要你知道：当 <code>trustMode === 'local'</code> 时，
      主进程会向宿主注入环境变量 <code>SPARK_COMPUTER_LOCAL_TRUST=1</code>（
      <code>NativeHostClient.ts:143-146</code>），宿主读到后<strong>直接跳过全部校验</strong>（
      <code>ParentProcessAuthorizer.swift:15-19</code>）； Rust 侧只在 <code>debug_assertions</code>{' '}
      或 <code>local-trust</code> feature 下认它。 而且有一条保护：
      <strong>本地信任 + 已签名 App 会被拒绝</strong>（抛 <code>native_host_untrusted</code>
      ），只有未签名 App（开发态）才允许 （<code>NativeHostBackendFactory.ts:130-139</code>）。
      所以不要把这个分支当成生产链路的常态。
    </p>
    <p>
      两个退出码在两平台是一致的：<strong>77 = 认证失败</strong>、<strong>76 = 协议失败</strong>（
      <code>HostMain.swift:13</code>、<code>:29</code>；<code>windows_host.rs:28</code>、
      <code>:39</code>）。
    </p>

    <h3 id="protocol">9.3 通信协议</h3>
    <p>帧格式非常简单，三份实现完全一致：</p>
    <ul>
      <li>
        <strong>5 字节定长帧头</strong>：4 字节大端长度 + 1 字节 kind （
        <code>NativeHostFrameCodec.ts:1-3</code>、<code>NativeFrameCodec.swift:40-42</code>、{' '}
        <code>frame_codec.rs:4</code>）。
      </li>
      <li>
        kind 只有两种：<code>1 = json</code>、<code>2 = binary</code>。 宿主
        <strong>只接受 JSON 帧作为请求</strong>，收到二进制即致命错误 （
        <code>HostMain.swift:47</code>、<code>windows_host.rs:53-54</code>）。
      </li>
      <li>
        <strong>载荷上限 64 MiB</strong>（<code>67_108_864</code>）， 三份实现各有一个常量名（
        <code>MAX_NATIVE_HOST_FRAME_PAYLOAD_BYTES</code> /{' '}
        <code>maxNativeHostFramePayloadBytes</code> / <code>MAX_FRAME_PAYLOAD_BYTES</code>）。
        注意帧头里的长度是<strong>载荷长度、不含那 5 字节头</strong>（
        <code>frame_codec.rs:106</code>），且空载荷被视为协议错误。
      </li>
      <li>
        <strong>二进制帧必须紧邻它的 JSON 描述符</strong>：客户端在收到二进制时若不在等待状态，
        直接抛 <code>Native Host binary payload was not adjacent to its descriptor</code>（
        <code>NativeHostClient.ts:498-500</code>）。
      </li>
    </ul>
    <p>
      请求 <strong>8 种</strong>（<code>native-wire.ts:167-213</code>，Swift / Rust 侧同名）：
      <code>get_capabilities</code>、<code>request_permissions</code>、<code>list_windows</code>、
      <code>capture_window</code>、<code>observe</code>、<code>execute_action</code>、
      <code>cancel_session</code>、<code>ping</code>。 响应 <strong>8 种</strong>：
      <code>capabilities</code>、<code>windows</code>、 <code>capture_result</code>、
      <code>observation</code>、<code>action_result</code>、<code>ack</code>、<code>pong</code>、
      <code>error</code>。 协议版本 <code>1</code>，三处常量一致（<code>native-version.ts:3</code>、{' '}
      <code>NativeHostProtocol.swift:4</code>、<code>protocol.rs:9</code>）。
    </p>
    <p>超时与取消是这个协议里最容易误解的部分：</p>
    <table>
      <thead>
        <tr>
          <th>机制</th>
          <th>行为</th>
          <th>证据</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>默认请求超时</td>
          <td>20 秒</td>
          <td>
            <code>NativeHostClient.ts:26</code>
          </td>
        </tr>
        <tr>
          <td>超时上限</td>
          <td>180 秒</td>
          <td>
            <code>:29</code>
          </td>
        </tr>
        <tr>
          <td>动作类超时</td>
          <td>按动作时长 + 宽限 + 6 秒 skyshot 预算动态计算</td>
          <td>
            <code>:636-651</code>
          </td>
        </tr>
        <tr>
          <td>超时后果</td>
          <td>
            <strong>整个宿主进程被 SIGKILL</strong>
          </td>
          <td>
            <code>:402-404</code>
          </td>
        </tr>
        <tr>
          <td>AbortSignal 触发</td>
          <td>
            同样是<strong>杀进程</strong>，不是取消单个请求
          </td>
          <td>
            <code>:407-411</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>cancel_session</code> 请求
          </td>
          <td>只让宿主「忘记该会话状态」，不杀进程</td>
          <td>
            <code>:298-300</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>进程内没有请求级取消</strong>——这是必须讲清的一点：
      取消一个动作的代价是重启整个宿主进程。为此客户端做了一个兜底： 终止前先{' '}
      <code>stdin.end()</code>，让宿主的输入守卫有机会补发鼠标/按键抬起事件， 避免按键卡住（
      <code>:623-625</code>，宽限 300 毫秒，<code>:30</code>）。
    </p>
    <p>
      并发模型是<strong>单 FIFO 车道</strong>（<code>operationTail</code>）， 但有容量上限：
      <strong>64 个在飞 + 64 个排队</strong>（<code>:31-32</code>）。超限返回{' '}
      <code>environment_unavailable</code> 并附诊断码{' '}
      <code>native_host_request_capacity_reached</code> /{' '}
      <code>native_host_operation_capacity_reached</code>（<code>:352-357</code>、
      <code>:392-397</code>）。
    </p>
    <p>
      会话取消在宿主侧是<strong>粘性</strong>的：取消后再执行会被拒 （
      <code>NativeHostRequestHandler.swift:203-204</code>、<code>:232</code>）。
      两个平台的饱和策略不同：macOS 用有界 FIFO 驱逐（上限 64，{''}
      <code>MacScreenCaptureProvider.swift:828-830</code>）， Windows 则在超过{' '}
      <strong>10000</strong> 条后<strong>清空并进入饱和态、全部拒绝</strong>（
      <code>cancellation_policy.rs:3-25</code>）。别把两者写成同一套语义。
    </p>
    <p>
      另外 macOS 的请求解析比客户端的 Zod <strong>更严</strong>： 它用{' '}
      <code>requireKeys(..., exactly: [...])</code> 做逐字段白名单，
      <strong>
        多一个字段就报 <code>invalidRequestFields</code>
      </strong>
      （<code>NativeHostProtocol.swift:81-166</code>）。
    </p>

    <h3 id="health">9.4 健康检查与自愈</h3>
    <p>
      宿主是长驻子进程，主进程用心跳保护它：
      <strong>每 5 秒</strong>用 <code>get_capabilities</code> 探活 （
      <code>NativeHostHealthService.ts:31</code>、
      <code>NativeHostComputerUseBackend.ts:238-240</code>），
      <strong>连续 3 次</strong>失败才判定不健康（<code>:32</code>、<code>:96-104</code>）。
      注释解释了为什么是 3 次而不是 1 次——单次抖动不该触发重启。
    </p>
    <p>
      「宿主死了」有<strong>两条不同路径</strong>，处理方式不同：
    </p>
    <ul>
      <li>
        <strong>心跳连续失败</strong> → 立刻尝试重连（<code>NativeHostSupervisor.ts:280-281</code>
        ）。
      </li>
      <li>
        <strong>某次操作报硬错误</strong> → 记录终态失败但<strong>不</strong>同步重连， 等下一次{' '}
        <code>acquire()</code> 再说（<code>:159-165</code>）。
      </li>
    </ul>
    <p>
      重启预算是<strong>每个会话 1 次</strong>（<code>DEFAULT_MAX_RESTARTS_PER_SESSION = 1</code>，
      <code>:74</code>）， 预算耗尽后进入 <code>failed</code>，之后所有获取都直接失败（
      <code>:173-174</code>）。 预算只在<strong>会话取消</strong>时重置（
      <code>NativeHostComputerUseBackend.ts:586-603</code>）——
      注释解释了原因：否则一次旧的崩溃会把电脑操作<strong>永久锁死</strong>。
    </p>
    <p>重连后的状态恢复策略很讲究：</p>
    <ul>
      <li>
        <strong>清空观测缓存</strong>——新进程没有旧状态，强制调用方重新绑定并重新观测。
      </li>
      <li>
        <strong>保留目标绑定</strong>——<code>targetBindings</code> 不被清除（<code>:370-376</code>
        ）。
      </li>
    </ul>
    <p>
      能让连接作废的错误只有<strong>5 个</strong>（<code>:889-895</code>）：
      <code>native_host_missing</code>、 <code>native_host_untrusted</code>、
      <code>native_host_incompatible</code>、 <code>action_timeout</code>、
      <code>session_canceled</code>。 反过来说，
      <strong>
        <code>stale_frame</code> / <code>stale_tree</code> / <code>focus_mismatch</code>{' '}
        都不会作废连接
      </strong>
      ——它们只是「这次动作没成，重新看一眼」。
    </p>
    <p>
      只有<strong>幂等操作</strong>会被透明重试，最多 3 次，且必须宿主标了 <code>retryable</code>：
      即 <code>observe</code> / <code>list_windows</code> / <code>get_capabilities</code>。
      <code>execute_action</code> 与 <code>capture_window</code> <strong>首次失败即抛出</strong>（
      <code>:45</code>、<code>:676-677</code>）。
    </p>
    <p>
      还有一个独立于运行时心跳的<strong>部署期自检</strong>： 用{' '}
      <code>--spark-verify-native-host</code> 参数启动，配合{' '}
      <code>SPARK_NATIVE_HOST_SMOKE_REPORT</code> 环境变量输出报告，
      只读、不开窗、不发任何动作，报告以 0600 独占方式写入 （
      <code>ComputerUsePackagedSmoke.ts:5</code>、<code>:51-53</code>；接线在{' '}
      <code>apps/desktop/src/main/index.ts:1125-1131</code>）。
    </p>

    <h2 id="element-tree">10. 元素树与 stale 语义</h2>
    <p>
      模型「看到」的界面不是截图，而是一份 Markdown 大纲；截图是辅助。 理解这份树的 id
      与版本语义，是排查 <code>stale_tree</code> 的前提。
    </p>

    <h3 id="tree-render">10.1 树如何渲染成 Markdown</h3>
    <p>
      格式在两侧的注释里都给了示例（<code>NativeAXTreeRenderer.swift:10-15</code>、
      <code>tree_render.rs:5-6</code>）：
    </p>
    <pre>
      <code>{`- window "Settings" [1]
  - group "Sidebar" [2]
    - textField "Search" = "vpn" [focused] [5]`}</code>
    </pre>
    <p>
      两条实现要点：<strong>元素 id 是渲染出来的行号</strong>（
      <code>NativeAXTreeRenderer.swift:87</code>、<code>tree_render.rs:65</code>）， 所以
      <strong>跨帧不可复用</strong>；缩进用前序扁平列表 + depth 还原层级。
    </p>
    <p>渲染时会做几类取舍：</p>
    <ul>
      <li>
        <strong>丢弃「噪声叶子」</strong>：无名称、无值、无可用动作、也未聚焦的叶子节点 （
        <code>NativeAXTreeRenderer.swift:116-120</code>）。
      </li>
      <li>
        <strong>超预算即截断并留标记</strong>：超出文本预算时输出{' '}
        <code>[truncated: N elements omitted]</code>（<code>:94-107</code>）。
      </li>
      <li>
        <strong>容器子元素过多时只显示前若干个</strong>并标注总数 （<code>:153-154</code>）。
      </li>
      <li>
        <strong>敏感值被抹掉</strong>：macOS 侧 secure 元素的 value 直接置空 （
        <code>MacControlPolicy.swift:309</code>）； Windows 侧密码/安全字段的 value 清空、name
        统一替换为 <code>Sensitive field</code>（<code>uia_policy.rs:213-215</code>）。
        两端都把每个元素的 <code>actions</code> 截断到 20 条（<code>:222</code>、{' '}
        <code>MacControlPolicy.swift:313</code>）。
      </li>
    </ul>
    <p>
      macOS 还额外做了两件 Windows 没有的事：<strong>强制打开 Chromium/Electron 的无障碍树</strong>
      （<code>MacAccessibilityController.swift:45</code>、<code>:159</code>）， 以及
      <strong>合并已展开的菜单</strong>（<code>:106</code>、<code>:142</code>）。
    </p>

    <h3 id="tree-version">10.2 treeVersion 与 stale_tree</h3>
    <p>
      <code>treeVersion</code> 是<strong>渲染文本的内容哈希</strong>（不是单调计数器）—— 这意味着
      <strong>界面没变时版本号也不变</strong>，注释明确说明了这个设计 （
      <code>MacControlPolicy.swift:230-231</code>）。
    </p>
    <p>
      <code>stale_tree</code> 有两种触发条件：
    </p>
    <ol>
      <li>
        动作携带的 <code>treeVersion</code> ≠ 宿主当前版本（<code>MacControlPolicy.swift:286</code>
        、<code>uia_policy.rs:195-196</code>）。
      </li>
      <li>
        元素 id 在当前版本里解析不到，或元素已被销毁 / PID 不匹配（
        <code>MacAccessibilityController.swift:519-523</code>）。
      </li>
    </ol>
    <p>
      客户端侧还有一层<strong>更外层</strong>的 <code>stale_frame</code>： 校验观测身份的 frameId（
      <code>NativeHostComputerUseBackend.ts:441-462</code>）。 两者都被映射为<strong>可重试</strong>
      （<code>NativeHostRequestHandler.swift:373-376</code>、 <code>windows_host.rs:950-955</code>
      ）。
    </p>
    <p>
      宿主在动作结束后会<strong>主动作废自己的观测绑定</strong>， 所以下一个动作必须先重新观测（
      <code>MacScreenCaptureProvider.swift:299-301</code>、 <code>windows_host.rs:789</code>）。
      还有一种兜底：当帧/树版本变了但<strong>窗口身份没变</strong>时，
      宿主会尝试重建一次缓存树而不是直接失败 （<code>MacScreenCaptureProvider.swift:556-567</code>
      ）。
    </p>
    <p>
      <strong>正确的处理方式</strong>（也是系统提示词里写的）：
    </p>
    <ul>
      <li>
        看到 <code>stale_tree</code> / <code>stale_frame</code>：<strong>重新读取一次状态</strong>（
        <code>screenshot</code> 或 <code>get_app_state</code>），用<strong>新 id</strong> 重试。
      </li>
      <li>
        <strong>不要原样重复同一个调用</strong>——旧 id 不会自己变有效。
      </li>
      <li>
        如果返回里说「树的帧没有变化」，说明这个动作<strong>没产生任何变化</strong>
        ，应该换策略而不是重试。
      </li>
    </ul>

    <h3 id="platform-tree-diff">10.3 两个平台的树差异</h3>
    <p>这段容易写错，逐条对照：</p>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>macOS</th>
          <th>Windows</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>文本预算</td>
          <td>48 000 UTF-16 单元</td>
          <td>90 000 UTF-16 单元</td>
        </tr>
        <tr>
          <td>元素上限</td>
          <td>2000</td>
          <td>100000</td>
        </tr>
        <tr>
          <td>树版本哈希输入</td>
          <td>
            渲染文本 <strong>+ 元素个数</strong>
          </td>
          <td>仅渲染文本</td>
        </tr>
        <tr>
          <td>超预算时</td>
          <td>截断 + 明确标记</td>
          <td>同样截断 + 标记</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>两个不一致值得记下来</strong>： 其一，Windows 的 90k 预算<strong>高于</strong> TS
      侧决策前的 48k 截断 （<code>ComputerDecisionAdapter.ts:23</code>、<code>:373</code>）， 而
      macOS 的注释明确要求「必须保持在 TS 侧上限以下，否则尾部 <code>[n]</code> 会被切掉」——
      这意味着 <strong>Windows 侧长界面确实可能丢尾部元素</strong>。 其二，两端的哈希输入不同，所以
      <strong>不要断言两端算法一致</strong>。
    </p>
    <p>
      还有一个已被废弃但代码里还留着的机制：<code>NativeHostTreeReconciler</code> 同时支持{' '}
      <code>full</code> 与 <code>diff</code> 两种模式 （
      <code>NativeHostTreeReconciler.ts:9-11</code>）， 但<strong>两个宿主现在都只发 full</strong>：
      macOS 已在 <code>MacControlPolicy.publish</code> 里删掉了 wire diff （
      <code>MacControlPolicy.swift:236-240</code> 明确写 diff mode gone）， Rust 侧永远走{' '}
      <code>TreeMode::Full</code>（<code>uia_policy.rs:188</code>）。 所以不要因为 V2 开关里有{' '}
      <code>incrementalTree</code> 就写「增量树已上线」， 真实状态是「diff 通道已废弃，full
      无条件生效」。
    </p>

    <h2 id="snapshots">11. 快照、隐私与留存</h2>
    <p>
      电脑操作会产生大量截图。这一节讲清它们<strong>怎么产生、存哪里、谁能看、什么时候删</strong>。
    </p>

    <h3 id="capture">11.1 截图路径与三套尺寸</h3>
    <p>
      所有截图都走<strong>原生宿主</strong>。仓库里 <code>desktopCapturer</code>{' '}
      <strong>零命中</strong>——Electron 只提供 <code>nativeImage</code> 的解码与编码能力。
    </p>
    <p>
      <strong>三种尺寸是三样不同的东西，不要混为一谈</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>产物</th>
          <th>尺寸</th>
          <th>编码</th>
          <th>是否落盘</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>image</code> blob（<code>capture_app_snapshot</code>）
          </td>
          <td>
            <strong>原始分辨率，不缩放</strong>
          </td>
          <td>PNG</td>
          <td>✅ 加密落盘</td>
        </tr>
        <tr>
          <td>
            <code>preview</code> blob
          </td>
          <td>宽 &gt; 1200 才缩到 1200</td>
          <td>PNG</td>
          <td>✅ 加密落盘</td>
        </tr>
        <tr>
          <td>模型帧（决策输入）</td>
          <td>长边 ≤ 1600</td>
          <td>JPEG 质量 85</td>
          <td>❌ 只在内存</td>
        </tr>
        <tr>
          <td>证据帧（观测审计）</td>
          <td>宽 ≤ 1200，且已打码</td>
          <td>PNG</td>
          <td>✅ 加密落盘</td>
        </tr>
      </tbody>
    </table>
    <p>
      常量与理由（<code>ElectronSnapshotImageProcessor.ts:4-13</code>）：
    </p>
    <pre>
      <code>{`const MAX_IMAGE_DIMENSION = 16_384
const MAX_PREVIEW_WIDTH = 1_200
const MAX_MODEL_IMAGE_LONG_EDGE = 1_600
const MODEL_IMAGE_JPEG_QUALITY = 85`}</code>
    </pre>
    <p>
      模型帧那条注释把动机讲得很清楚：视觉模型内部会把超过约 2 MP 的图降采样， 所以传完整 Retina
      截图只会<strong>白白增加上传量与首字延迟</strong>
      （一张 5120×2880 的 PNG 编码成 base64 后每步有 7–14 MB）。 1600 长边的 JPEG
      既保留小控件可读性，又把载荷压掉约 20 倍。
    </p>
    <p>
      另外两组硬限额：单张截图 ≤ 64 MiB、像素数 ≤ 50 000 000 （
      <code>NativeApplicationSnapshotCaptureService.ts:19-20</code>）， 且宿主
      <strong>只允许返回 PNG</strong>（<code>:282-301</code> 校验{' '}
      <code>payload.kind === 'image_png'</code>）。 两端截图都<strong>不包含物理光标</strong>
      ——因为光标会破坏静态界面的 frameId 去重 （<code>MacScreenCaptureProvider.swift:157-160</code>
      、<code>capture.rs:126</code>）。
    </p>

    <h3 id="vault">11.2 加密存储与清理</h3>
    <p>
      blob 落在 <code>userData/snapshot-vault/blobs/</code>，文件名是{' '}
      <strong>
        24 随机字节的 hex + <code>.svb</code>
      </strong>
      （48 位十六进制）， 与 blobId / snapshotId <strong>无任何字面关联</strong>—— 对应关系只存在
      SQLite 的 <code>computer_snapshot_blobs.storage_key</code> 里 （
      <code>SnapshotVault.ts:12</code>、<code>:71</code>）。
    </p>
    <p>
      加密参数（<code>SnapshotVault.ts:7-11</code>、<code>:61-70</code>）：
    </p>
    <ul>
      <li>
        算法 <strong>AES-256-GCM</strong>，nonce 12 字节、认证标签 16 字节。
      </li>
      <li>
        文件头有魔数 <code>SPKSVLT</code> 与格式版本，AAD 绑定 blobId 与 kind （
        <code>:268-273</code> 的{' '}
        <code>
          JSON.stringify(&#123; domain: &apos;spark.snapshot-vault&apos;, formatVersion, blobId,
          kind &#125;)
        </code>
        ）。
      </li>
      <li>
        <strong>密钥是 32 字节安装级密钥</strong>，存在操作系统钥匙串里 （引用名{' '}
        <code>snapshot-vault-installation-key-v1</code>，<code>SnapshotVaultKeyProvider.ts:4</code>
        、<code>:43-50</code>）； 首次使用时随机生成并写入。密钥长度不是 256 位直接抛错（
        <code>SnapshotVault.ts:200-204</code>）。
      </li>
      <li>
        目录权限 <code>0700</code>、文件 <code>0600</code>， 写入走「临时文件 + fsync +
        rename」的原子替换（<code>:206-226</code>）。
      </li>
    </ul>
    <p>保留与清理规则（这里有反直觉的地方）：</p>
    <ul>
      <li>
        <strong>没有任何数量或总体积上限</strong>——<code>SnapshotVault</code> 里不存在磁盘配额、blob
        计数或 LRU 逻辑。磁盘占用没有兜底保护。
      </li>
      <li>
        只有 <code>retention_mode = 'ttl'</code> 的行会被过期扫描清掉 （
        <code>application-snapshot.repository.ts:192-199</code>）。
      </li>
      <li>
        <strong>证据帧的 TTL 是 24 小时</strong>（
        <code>ComputerObservationEvidenceStore.ts:16</code>、<code>:121</code>）。
      </li>
      <li>
        <code>capture_app_snapshot</code> 产出的快照<strong>没有 TTL</strong>： 带会话时是{' '}
        <code>session</code> 模式（靠外键级联删除）， 不带会话时是 <code>manual</code> 模式，
        <strong>永不自动删除</strong>（<code>NativeApplicationSnapshotCaptureService.ts:252</code>
        ）。
      </li>
      <li>
        清理任务启动时立即跑一次、之后每 <strong>6 小时</strong>一次 （
        <code>SnapshotVaultMaintenance.ts:12</code>、<code>:49-54</code>）， 单批 200 条（
        <code>:13</code>）；孤儿文件有 <strong>24 小时</strong>宽限期 （
        <code>SnapshotVault.ts:13</code>）。
      </li>
    </ul>
    <p>
      所以「删了会话磁盘就会立刻干净」是错的：<code>.svb</code> 文件最多会滞留到下一轮清理 （≤ 6
      小时）。反过来，「快照会自动保留 N 天后删除」也是错的—— 只有证据帧有 24 小时 TTL，
      <code>manual</code> 模式的快照不会自动消失。
    </p>

    <h3 id="preview">11.3 预览令牌</h3>
    <p>
      界面里的截图通过自定义协议 <code>spark-snapshot://</code> 读取， 路径形如{' '}
      <code>spark-snapshot://snapshot/&lt;id&gt;/preview?cap=&lt;token&gt;</code>（
      <code>SnapshotPreviewCapability.ts:115-119</code>）。
    </p>
    <ul>
      <li>
        <strong>令牌默认 5 分钟有效</strong>（<code>DEFAULT_TTL_MS = 5 * 60_000</code>，
        <code>:3</code>）， 合法区间 1 秒到 60 分钟；令牌是 32 随机字节的 base64url，格式为{' '}
        <code>/^[A-Za-z0-9_-]&#123;43,128&#125;$/</code>（<code>:5</code>、<code>:36</code>）。
      </li>
      <li>
        协议侧校验<strong>极其严格</strong>：URL 必须<strong>逐字符等于</strong>重新拼出的结果，
        <code>cap</code> 只能出现一次，且不允许任何其他 query 参数 （
        <code>SnapshotProtocol.ts:130-134</code>）。
      </li>
      <li>
        只允许 <code>GET</code> / <code>HEAD</code>（其他方法 405）， 只允许读取 <code>image</code>{' '}
        与 <code>preview</code> 两类 blob （
        <strong>
          <code>text</code> 类型拿不到
        </strong>
        ）， 并按魔数嗅探 PNG/JPEG/WebP/GIF，否则 415 （<code>:51-65</code>、<code>:160-182</code>
        ）。
      </li>
      <li>
        失败一律返回 404 / 500，不泄漏路径或加密细节（<code>:55</code>、<code>:74-77</code>）；
        响应头带 <code>cache-control: private, no-store</code> 与{' '}
        <code>content-security-policy: default-src 'none'; sandbox</code>（<code>:18-23</code>）。
      </li>
      <li>
        授权判定只看「令牌存在 + 未过期 + snapshotId 相等」（<code>:66-75</code>）。
      </li>
    </ul>
    <p>
      撤销有两个维度：按会话撤销（<code>:77-81</code>）与按快照撤销（<code>:83-87</code>）。
      <strong>turn 边界确实会按会话撤销</strong>——会话收尾的三个分支都会调{' '}
      <code>revokeComputerUseSession</code>（
      <code>packages/agent-runtime/src/services/session.service.ts:4221</code>、<code>:4255</code>、
      <code>:4288</code>）， 最终落到 <code>ComputerUseMcpProvider.ts:73-76</code> 的{' '}
      <code>revokeSession</code>。
    </p>
    <p>两个容易理解错的点：</p>
    <ul>
      <li>
        <strong>撤销只废掉「已发出」的令牌</strong>，不等于预览永久失效—— 渲染端只要再调一次{' '}
        <code>app-snapshot:get</code> 就能拿到新令牌 （
        <code>ApplicationSnapshotPreviewCard.tsx:43-50</code>、<code>:70</code>{' '}
        在图片加载失败时自动续签）。
      </li>
      <li>
        <strong>
          <code>sessionId</code> 为空的授权无法被 turn 边界撤销
        </strong>
        ， 只能等 5 分钟 TTL 过期——<code>manual</code> 模式的快照就属于这种。
      </li>
    </ul>

    <h3 id="privacy">11.4 隐私边界：实际做了什么</h3>
    <p>
      这里必须按代码写，不能写成理想设计。实际有<strong>两道独立的保护</strong>，
      覆盖面比直觉窄得多。
    </p>
    <p>
      <strong>第一道：凭据类应用黑名单（17 项）</strong>
    </p>
    <p>
      名单硬编码在 <code>NativeApplicationSnapshotCaptureService.ts:21-39</code>： macOS 侧是{' '}
      <code>com.apple.securityagent</code>、<code>com.apple.loginwindow</code>、
      <code>com.apple.passwords</code>、<code>com.apple.keychainaccess</code>、{' '}
      <code>securityagent</code>；Windows 侧是 <code>logonui.exe</code>、{' '}
      <code>credentialuibroker.exe</code>、<code>consent.exe</code>、<code>lockapp.exe</code>；
      外加密码管理器 <code>1password</code> / <code>bitwarden</code> / <code>keepass</code>{' '}
      各自的可执行名（含 <code>.exe</code> 变体）。 命中时抛 <code>sensitive_input_blocked</code>（
      <code>:304-327</code>）。
    </p>
    <p>三条必须说清的边界：</p>
    <ul>
      <li>
        它是<strong>精确 identity 匹配</strong>（小写 + 反斜杠归一化 + 取 basename），
        <strong>不做子串匹配</strong>。
      </li>
      <li>
        名单<strong>只覆盖凭据与系统认证类应用</strong>——浏览器、聊天软件、
        任何可能显示密码的普通窗口<strong>都不在名单里</strong>。
      </li>
      <li>
        这道检查
        <strong>
          只作用于 <code>capture_app_snapshot</code>（主动截某个应用）这条路
        </strong>
        （<code>:192</code>），观测路径不经过它。
      </li>
    </ul>
    <p>
      <strong>第二道：敏感区域打码（只作用于观测证据帧）</strong>
    </p>
    <p>
      敏感区域来自原生宿主上报的 AX secure 元素边界 （<code>MacControlPolicy.swift:281</code> 的{' '}
      <code>sensitiveRegions: bounded.filter(\.secure).map(\.bounds)</code>）。 TS
      侧在落盘前把这些区域<strong>涂成灰色</strong> （RGBA <code>128,128,128,255</code>，
      <code>ElectronSnapshotImageProcessor.ts:108-117</code>、<code>:191-194</code>），
      坐标要先按缩放比从窗口坐标换算到图像坐标（<code>:105-116</code>）。 打码情况会记进元数据（
      <code>ComputerObservationEvidenceStore.ts:253-258</code>）。
    </p>
    <p>
      与之相对的一个<strong>反向事实</strong>：<code>capture_app_snapshot</code> 的快照
      <strong>完全不打码</strong>——<code>redaction</code> 字段被硬编码为{' '}
      <code>&#123; applied: false, reasonCodes: [], regionCount: 0 &#125;</code>（
      <code>NativeApplicationSnapshotCaptureService.ts:251</code>、<code>:277</code>）。
      所以「所有快照都打码」是错的：打码只发生在观测证据帧上。
    </p>
    <p>
      另外，纯视觉兜底路径（OCR 回退）产出的树<strong>不带敏感区域信息</strong>， 两处都是{' '}
      <code>sensitiveRegions: []</code>（<code>MacScreenCaptureProvider.swift:439</code>、
      <code>:1044</code>）。
    </p>
    <p>
      最后一道工程约束在渲染端：CSP 只允许 <code>spark-snapshot:</code> 作为图片源 （
      <code>apps/desktop/src/renderer/index.html:19</code>）， 且渲染前用正则强校验 URL 形状 （
      <code>design/services/event-mapper.ts:2749-2752</code>）。
    </p>

    <h2 id="ui">12. 界面能做什么、不能做什么</h2>
    <p>
      这一节不讲功能清单，而是讲<strong>哪些能力在界面上真的可达</strong>——
      因为这个子系统的界面覆盖度远低于后端能力覆盖度。
    </p>

    <h3 id="settings-gap">12.1 设置页只有授权与诊断，没有开关</h3>
    <p>
      <code>ComputerUseSettingsSection</code> 一共 280 行，渲染的内容只有四块：
      状态摘要条、两行系统授权、一个诊断块，以及「重新检测 / 请求授权 / 打开系统设置 / 运行诊断 /
      复制诊断」这几个按钮。
      <strong>它没有任何一个开关或复选框。</strong>
      文案是硬编码中文、不走 i18n（与聊天卡片相反，那张卡走 <code>t()</code>）。
    </p>
    <p>
      授权行的原文与状态文案（<code>ComputerUseSettingsSection.tsx:78-91</code>、<code>:198</code>、
      <code>:256-260</code>）：
    </p>
    <table>
      <thead>
        <tr>
          <th>界面文案</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>屏幕录制</td>
          <td>读取当前应用窗口画面，用于识别按钮、输入框和操作结果。</td>
        </tr>
        <tr>
          <td>辅助功能与输入控制</td>
          <td>读取可访问性结构，并执行点击、键盘输入、滚动和窗口切换。</td>
        </tr>
        <tr>
          <td>已授权 / 未授权 / 受系统限制 / 当前不可用 / 待授权</td>
          <td>分别对应 ready / denied / restricted / unsupported / not_determined</td>
        </tr>
        <tr>
          <td>电脑操作已就绪 / 电脑操作尚未就绪</td>
          <td>四项能力探测全通过才算就绪</td>
        </tr>
      </tbody>
    </table>
    <p>
      诊断块的文案是「Native Host 与核心链路」，说明写着
      <em>「检查运行时、权限、协议状态及观察/动作各阶段延迟，不包含截图或输入内容」</em>（
      <code>:215-218</code>）——这句话是准确的，指标收集器确实不含内容（见 13.2）。 诊断结果会显示{' '}
      <code>diagnosticCode</code> 与三个延迟数值： 观测、动作、动作后观测（<code>:222-227</code>、
      <code>:243-253</code>）。
    </p>
    <p>
      <strong>
        关键落差：那套 <code>ComputerUseSettings</code> 设置没有任何界面。
      </strong>
    </p>
    <p>
      代码里定义了一份完整的设置结构，存在 <code>app_settings</code> 表的 category{' '}
      <code>computer-use</code> / key <code>settings</code> 下（
      <code>registerComputerUseIpc.ts:34-35</code>）：
    </p>
    <pre>
      <code>{`{
  enabled: true,
  environments: { safeBrowser: false, safeDesktop: false, myDesktop: true },
  allowedApps: [],
  redactSensitiveContent: true,
  fullRecordingEnabled: false,
  evidenceRetentionDays: 30,
  killSwitch: 'CommandOrControl+Shift+Esc',
  remote: { observe: false, approveL2: false, control: false },
}`}</code>
    </pre>
    <p>
      但
      <strong>
        渲染端从不调用 <code>computer-use:get-settings</code> 与{' '}
        <code>computer-use:update-settings</code>
      </strong>
      （这两个通道各注册了 handler， 但全仓渲染端零引用）。于是有四个字段
      <strong>除了默认值之外没有任何生产读取点</strong>：
    </p>
    <ul>
      <li>
        <code>redactSensitiveContent</code>（默认 <code>true</code>）
      </li>
      <li>
        <code>fullRecordingEnabled</code>（默认 <code>false</code>）
      </li>
      <li>
        <code>evidenceRetentionDays</code>（默认 <code>30</code>）
      </li>
      <li>
        整个 <code>remote</code> 对象，含 <code>observe</code> / <code>approveL2</code> /{' '}
        <code>control</code>
      </li>
    </ul>
    <p>
      它们会被 schema 校验、会被持久化、会被读回界面——但
      <strong>没有任何代码根据它们改变行为</strong>。 这一点如果写成「可以配置敏感内容打码 /
      保留天数 / 远程审批」就是错的。
    </p>
    <p>
      <strong>由此还引出一个关于 kill switch 的重要事实。</strong>
    </p>
    <p>
      紧急停止的快捷键确实是真实注册的——主进程启动时注入了 Electron 的 <code>globalShortcut</code>（
      <code>apps/desktop/src/main/index.ts:1119-1124</code> 的{' '}
      <code>shortcutRegistrar: globalShortcut</code>，位于正常的数据库初始化路径上，
      不是只在冒烟测试分支里）。未注入时用的是 fail-closed 实现：
      <code>register</code> 恒返回 <code>false</code>（<code>ComputerUseServices.ts:326-329</code>
      ）。
    </p>
    <p>
      但<strong>武装（arm）动作只有两条路径</strong>： (a) 启动时的{' '}
      <code>reconcilePersistedKillSwitch</code>； (b) <code>computer-use:update-settings</code>{' '}
      handler 内的 <code>armKillSwitchBestEffort</code>。 而 (a){' '}
      <strong>读的是原始持久化行，没有默认值兜底</strong>（
      <code>registerComputerUseIpc.ts:446-454</code> 直接 <code>safeParse(store.get(...))</code>，
      与 <code>loadSettings</code> 的 <code>?: structuredClone(DEFAULT...)</code> 不同）。
      由于没有任何界面写这一行，全新安装时该记录不存在 → <code>safeParse</code> 失败 → 直接 return。
    </p>
    <p>
      <strong>结论</strong>：默认值里的 <code>CommandOrControl+Shift+Esc</code> 在全新安装上
      <strong>不会被注册</strong>。不要写「默认快捷键 Cmd/Ctrl+Shift+Esc 可随时紧急停止」。
      想启用它，需要让那一行设置被真正写入（例如通过平台工具的 <code>settings_set</code> 写入该
      category/key， 它不校验 category/key，
      <code>packages/agent-runtime/src/services/settings.service.ts:29-31</code>）， 之后
      <strong>下次启动</strong>才会武装。
    </p>
    <p>
      一旦武装，它的行为是<strong>取消所有活跃会话</strong>，与界面上的「停止」走同一条代码路径 （
      <code>ComputerUseServices.ts:224-241</code> 对每个活跃会话调 <code>broker.killSwitch</code>，
      后者即 <code>stop</code>，<code>ComputerControlBroker.ts:335-342</code>）。
      两个细节：重复按键会被合并（一次 kill 未完成时后续按键被吞掉，{' '}
      <code>ComputerKillSwitchService.ts:21</code>）；被 kill 的会话<strong>不能 resume</strong>——
      <code>canceled</code> 不是 <code>paused</code>，恢复只能起一个新会话 （
      <code>ComputerSessionManager.ts:338-343</code>）。 另外代码里<strong>没有</strong>
      用任何标记把「kill switch 中止」与「用户点停止」区分开， 时间线上看不出是哪一种。
    </p>
    <p>
      还要区分两个完全不同的「Esc」：
      <strong>kill switch</strong> 是 <code>CommandOrControl+Shift+Esc</code>，停掉所有会话；
      <strong>物理 Esc 键</strong>只是取消<strong>当前这一个动作</strong>， 让调用方收到{' '}
      <code>handoff_required</code>（<code>NativeInterruptionToken.swift:6-10</code>{' '}
      有完整语义说明）。 系统提示词特别强调：模型自己通过 <code>press_key</code> 发 Esc{' '}
      <strong>不会</strong>触发它， 因为合成按键不算用户输入。
    </p>

    <h3 id="chat-card">12.2 聊天里的活动卡片</h3>
    <p>
      卡片由 <code>ComputerActivitySegmentsBridge</code> 按消息切段渲染（
      <code>ChatView.tsx:5147-5168</code>）。 每段的构成：
    </p>
    <ul>
      <li>
        <strong>状态徽标</strong>：取该段最后一条事件推断（
        <code>ComputerActivityBlock.tsx:381-396</code>），文案有「已完成 / 失败 / 已停止 / 需要接管
        / 等待确认 / 进行中」。
      </li>
      <li>
        <strong>行</strong>：事件标签 + 时间（<code>HH:mm:ss</code>，<code>:297-298</code>）。
      </li>
      <li>
        <strong>耗时</strong>：按整条会话时间线的首末事件差计算，小于 1 秒不显示（
        <code>:501-510</code>）。
      </li>
      <li>
        <strong>控制按钮</strong>：暂停 / 接管 / 停止 / 更换窗口，
        <strong>只在「本段是最新一段、有会话、且非终态」时出现</strong>（<code>:305-374</code>）。
      </li>
    </ul>
    <p>两个显示上的取舍值得知道：</p>
    <ul>
      <li>
        <code>computer_observation_created</code> 事件被<strong>显式过滤掉不显示</strong>（
        <code>:216</code>），所以卡片不会列出每一次观测。
      </li>
      <li>
        同一 <code>actionId</code> 的 <code>requested</code> 事件在出现终态后会被
        <strong>折叠</strong>（<code>:403-417</code>），所以不是「每个动作两行」。
      </li>
    </ul>
    <p>
      错误码在卡片里会做一次中文映射，但<strong>这张映射表只有 7 个键</strong>， 且其中三个键
      <strong>不是协议枚举里的码</strong>（<code>:482-493</code> 用的 <code>permission_denied</code>{' '}
      / <code>native_host_not_found</code> / <code>target_lost</code>， 而枚举里是{' '}
      <code>screen_permission_denied</code> / <code>native_host_missing</code> /{' '}
      <code>focus_mismatch</code>）。 结果是<strong>绝大多数真实错误会原样显示英文错误码</strong>（
      <code>?? errorCode</code> 兜底）。 排查时直接按英文码查本页第 14 节更可靠。
    </p>
    <p>
      托盘里的按钮失败<strong>只写日志、界面无提示</strong>（
      <code>apps/desktop/src/main/index.ts:717</code>），这也是一个排查盲区。
    </p>

    <h3 id="tray-pip">12.3 托盘与画中画（PIP）</h3>
    <ul>
      <li>
        <strong>托盘</strong>：<code>ComputerControlTrayService</code>，在 <code>createTray()</code>{' '}
        里构造（<code>main/index.ts:565-575</code>），订阅会话状态刷新菜单。菜单文案是 「暂停 Agent
        / 立即接管 / 停止控制」——与卡片里的「暂停 / 接管 / 停止」<strong>不是同一套</strong>。
      </li>
      <li>
        <strong>PIP 面板</strong>：<code>ComputerUsePipService</code>， 但它
        <strong>不是渲染端 React 组件</strong>——它是主进程创建的
        <code>BrowserWindow</code>，内容是一段内联的 <code>data:text/html</code> 页面 （
        <code>ComputerUsePipService.ts:91-116</code>、HTML 常量在 <code>:151-216</code>）。 只有{' '}
        <code>pipPanel</code> 这个 V2 开关为真时才创建 （<code>ComputerUseServices.ts:185-206</code>
        ），该开关默认<strong>为真</strong>。
      </li>
    </ul>
    <p>
      渲染端实际调用的电脑操作通道只有 11 个（<code>get-capabilities</code>、{' '}
      <code>diagnose-native-host</code>、<code>open-system-settings</code>、{' '}
      <code>list-windows</code>、<code>list-sessions</code>、<code>get-timeline</code>、{' '}
      <code>bind-target</code>、<code>pause</code>、<code>stop</code>、<code>takeover</code>、{' '}
      <code>resolve-app-command</code>）， 而注册的通道有 20 个。剩下 9 个
      <strong>没有任何渲染端调用者</strong>：
    </p>
    <pre>
      <code>{`start  resume  get-status  get-settings  update-settings
list-apps  approve-action  deny-action  get-verification`}</code>
    </pre>
    <p>
      它们的存在方式各有不同：<code>start</code> / <code>resume</code> / <code>get-status</code> /{' '}
      <code>list-apps</code> 是主进程 MCP 路径的 IPC 镜像，实际由 Agent 调用；
      <code>get-settings</code> / <code>update-settings</code> 是那份「没有界面」的设置；
      <code>approve-action</code> 是被<strong>故意封死</strong>的（永远抛错）；
      <code>get-verification</code> 则必然返回 <code>null</code>（见 8.3）。
    </p>
    <p>
      这带来一个实际的界面落差：<strong>聊天卡片上没有「继续」按钮</strong>。 会话暂停后，只有 Agent
      通过 MCP 调 <code>resume</code> 才能真正恢复运行 （渲染端既不调用它，它的 IPC
      版实现也不重启算子循环）。 同理，<code>bind_target</code>（更换窗口）之后要靠 Agent 调{' '}
      <code>resume</code> 继续。
    </p>

    <h2 id="v2-flags">13. V2 开关与自动回滚</h2>
    <p>
      <code>computer-use</code> 目录下有一组 <code>SPARK_COMPUTER_USE_V2_*</code>{' '}
      环境变量控制的开关。 它们的语义与很多人的直觉不同：
      <strong>
        没有 V1/V2 总开关，10 个开关默认全开， 且只能被显式关闭、不能通过配置打开任何「旧版」
      </strong>
      。
    </p>

    <h3 id="flag-table">13.1 十个开关的真实消费情况</h3>
    <p>
      定义在 <code>computerUseV2Flags.ts:1-12</code>，默认值在 <code>:38-49</code> （
      <strong>
        十个全为 <code>true</code>
      </strong>
      ）。源码注释写明了口径：
      <em>「V2 is the shipped product path.」</em>——V2 就是当前产品路径，
      每个优化都能通过环境变量显式关闭或运行时独立回滚。
    </p>
    <p>
      环境变量名统一前缀 <code>SPARK_COMPUTER_USE_V2_</code>（<code>:23-34</code>）， 解析规则是「
      <strong>
        只有 <code>0</code> / <code>false</code> / <code>no</code> / <code>off</code> 算关闭，
        其他任何非空字符串都算开启
      </strong>
      」（<code>:137-140</code>）。 所以 <code>SPARK_COMPUTER_USE_V2_PIP_PANEL=anything</code> 是
      <strong>开</strong>，不是关。
    </p>
    <p>逐个人工核实过的消费情况：</p>
    <table>
      <thead>
        <tr>
          <th>开关</th>
          <th>生产读取点</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>hostSupervisor</code>
          </td>
          <td>
            <code>NativeHostBackendFactory.ts:92</code>
          </td>
          <td>启用原生宿主 supervisor（自愈）</td>
        </tr>
        <tr>
          <td>
            <code>incrementalTree</code>
          </td>
          <td>
            <code>ComputerTaskOperator.ts:42</code>
          </td>
          <td>取反决定是否请求 full 决策树</td>
        </tr>
        <tr>
          <td>
            <code>actionBatch</code>
          </td>
          <td>
            <code>ComputerTaskOperator.ts:219</code>
          </td>
          <td>是否允许模型一次返回一批动作</td>
        </tr>
        <tr>
          <td>
            <code>persistentCapture</code>
          </td>
          <td>
            <code>NativeHostComputerUseBackend.ts:227</code>
          </td>
          <td>持久捕获流（而非每次截一张）</td>
        </tr>
        <tr>
          <td>
            <code>actionSkyshot</code>
          </td>
          <td>
            <code>NativeHostComputerUseBackend.ts:474</code>
          </td>
          <td>动作回包附带后置观测</td>
        </tr>
        <tr>
          <td>
            <code>pipPanel</code>
          </td>
          <td>
            <code>ComputerUseServices.ts:185</code>
          </td>
          <td>是否创建画中画面板</td>
        </tr>
        <tr>
          <td>
            <code>installedArtifactDiagnostics</code>
          </td>
          <td>
            <strong>无</strong>
          </td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>backgroundSemanticLane</code>
          </td>
          <td>
            <strong>无</strong>
          </td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>activityTimeline</code>
          </td>
          <td>
            <strong>无</strong>
          </td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>visibleControlIndicator</code>
          </td>
          <td>
            <strong>无</strong>
          </td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>四个开关没有任何消费者</strong>：<code>installedArtifactDiagnostics</code>、
      <code>backgroundSemanticLane</code>、<code>activityTimeline</code>、
      <code>visibleControlIndicator</code>。 它们会出现在 <code>get_capabilities</code>{' '}
      返回的开关快照里 （<code>ComputerUseAgentController.ts:200-201</code> 把快照塞进返回值），
      但读取它们不会改变任何行为。连它们对应的四个包装函数也无人调用。
    </p>
    <p>
      由此推出两个容易写错的结论： 其一，
      <strong>
        活动时间线不是由 <code>activityTimeline</code> 开关控制的
      </strong>
      ——
      <code>ComputerUseTimelineStore</code> 无条件在跑，卡片也是无条件渲染的； 其二，
      <strong>
        不要因为 <code>incrementalTree</code> 默认开启就写「增量树已上线」
      </strong>
      —— 两个宿主现在都只发 full（见 10.3），diff 通道已废弃。
    </p>
    <p>
      另外 <code>persistentCapture</code> 虽然<strong>确实</strong>被消费，
      但它对应的熔断计分没有被接上：<code>recordPersistentCaptureBudget()</code>
      <strong>零生产调用</strong>（只在自己的类里定义）， 所以它不会被自动回滚，相关阈值形同虚设。
    </p>

    <h3 id="rollback">13.2 自动回滚阈值</h3>
    <p>
      <code>ComputerUseV2RolloutController</code> 会按运行统计自动关闭某个开关。 语义是
      <strong>进程内、不落盘、下次启动自然重置</strong>，且<strong>只能关不能开</strong>。 阈值（
      <code>ComputerUseV2RolloutController.ts:24-35</code>）：
    </p>
    <table>
      <thead>
        <tr>
          <th>指标</th>
          <th>阈值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>宿主崩溃率</td>
          <td>
            <code>0.005</code>（样本 ≥ 200）
          </td>
        </tr>
        <tr>
          <td>安装制品失败率</td>
          <td>
            <code>0.001</code>（样本 ≥ 1000）
          </td>
        </tr>
        <tr>
          <td>动作错误率</td>
          <td>
            <code>0.01</code>（样本 ≥ 500）
          </td>
        </tr>
        <tr>
          <td>接管停止 P99</td>
          <td>
            <code>500</code> 毫秒（样本 ≥ 100）
          </td>
        </tr>
        <tr>
          <td>持久捕获预算失败率</td>
          <td>
            <code>0.01</code>（样本 ≥ 200，但计分未被接上）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      统计窗口上限 <strong>2048</strong> 个样本（<code>:37</code>）。
      有两处命名与直觉不符，排查时会误导：
    </p>
    <ul>
      <li>
        <strong>
          接管耗时超限回滚的是 <code>actionBatch</code>
        </strong>
        ， 不是 supervisor，也不是可见指示器（<code>:108</code> 的{' '}
        <code>rollback('actionBatch', 'takeover_stop_p99_exceeded', ...)</code>）。
      </li>
      <li>
        <strong>
          安装制品校验失败时被禁用的是 <code>hostSupervisor</code>
        </strong>
        ， 不是 <code>installedArtifactDiagnostics</code>（<code>:80-84</code>）。
        所以那个开关永远不会被回滚——它本来也没有消费者。
      </li>
    </ul>
    <p>
      回滚的后果也不一样：只有 <code>hostSupervisor</code> 会
      <strong>真的拆掉 supervisor 并清空观测</strong>（
      <code>NativeHostComputerUseBackend.ts:248-256</code>）， 其余开关回滚只是让读取点返回{' '}
      <code>false</code>。
    </p>

    <h2 id="troubleshooting">14. 排查表</h2>
    <p>
      按现象查。每条都给出了对应的判定点或错误码——<strong>错误码以协议枚举为准</strong>，
      不要依赖聊天卡片里的中文映射（见 12.2）。
    </p>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>先看哪里</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>设置页显示「尚未就绪」</td>
          <td>
            两行授权状态 + <code>unavailableReason</code> 原文
          </td>
          <td>四项能力探测需全部 granted；就绪判定见 2.4</td>
        </tr>
        <tr>
          <td>macOS 授权后仍显示未授权</td>
          <td>
            <code>screen_permission_denied</code> / <code>accessibility_permission_denied</code>
          </td>
          <td>事件投递权限缺失也报 accessibility 码，没有独立码（2.2）</td>
        </tr>
        <tr>
          <td>Windows 上没有任何授权弹窗</td>
          <td>
            <code>get_capabilities</code> 的 <code>restricted</code>
          </td>
          <td>Windows 无弹窗、无 denied 状态，只有 granted/restricted（2.3）</td>
        </tr>
        <tr>
          <td>
            报 <code>native_host_missing</code>
          </td>
          <td>安装制品是否存在、平台/架构是否匹配</td>
          <td>
            诊断 stage 为 <code>discover</code>，修复动作 <code>reinstall</code>
          </td>
        </tr>
        <tr>
          <td>
            报 <code>native_host_untrusted</code>
          </td>
          <td>Team ID / 发布者指纹是否与 App 一致</td>
          <td>
            本地信任 + 已签名 App 会<strong>故意</strong>被拒（9.2）
          </td>
        </tr>
        <tr>
          <td>
            报 <code>host_handshake_failed</code> / 协议错误
          </td>
          <td>协议版本、帧格式</td>
          <td>宿主退出码 76 即协议失败、77 即认证失败（9.3）</td>
        </tr>
        <tr>
          <td>
            动作报 <code>stale_frame</code> / <code>stale_tree</code>
          </td>
          <td>重新读一次状态，用新元素 id 重试</td>
          <td>元素 id 是行号、跨帧不可复用；不要原样重复调用（10.2）</td>
        </tr>
        <tr>
          <td>
            动作报 <code>action_noop</code>
          </td>
          <td>界面是否真的变了</td>
          <td>无变化会被记为失败而非成功；应换策略</td>
        </tr>
        <tr>
          <td>
            动作报 <code>focus_mismatch</code>
          </td>
          <td>目标应用是否已切换/关闭</td>
          <td>策略层唯一的硬拒绝条件（4.2）</td>
        </tr>
        <tr>
          <td>
            报 <code>action_timeout</code>
          </td>
          <td>宿主是否被杀、是否会自动重启</td>
          <td>超时即 SIGKILL 整个宿主；每会话只有 1 次重启预算（9.4）</td>
        </tr>
        <tr>
          <td>宿主反复重启后彻底不可用</td>
          <td>
            supervisor 状态是否 <code>failed</code>
          </td>
          <td>预算耗尽；只有取消会话才重置（9.4）</td>
        </tr>
        <tr>
          <td>
            报 <code>native_host_request_capacity_reached</code>
          </td>
          <td>是否有并发调用堆积</td>
          <td>上限 64 在飞 + 64 排队（9.3）</td>
        </tr>
        <tr>
          <td>
            报 <code>environment_unavailable</code>
          </td>
          <td>环境开关、UIA 可用性、并发状态</td>
          <td>该码同时用于「环境关闭」「UIA 不可用」「并发未完成（可重试）」</td>
        </tr>
        <tr>
          <td>
            报 <code>computer_disabled</code>
          </td>
          <td>
            <code>ComputerUseSettings.enabled</code>
          </td>
          <td>默认 true；但该设置无界面，落库值可能异常</td>
        </tr>
        <tr>
          <td>
            报 <code>sensitive_input_blocked</code>
          </td>
          <td>目标是否在 17 项凭据类黑名单里</td>
          <td>精确 identity 匹配；只作用于主动截图路径（11.4）</td>
        </tr>
        <tr>
          <td>
            报 <code>decision_model_error</code>
          </td>
          <td>会话 Provider 是否可用、是否本地 CLI</td>
          <td>本地 CLI Provider 被显式拒绝；失败会带诊断与修复建议</td>
        </tr>
        <tr>
          <td>
            报 <code>task_step_limit_exceeded</code> / <code>task_runtime_exceeded</code>
          </td>
          <td>步数 100 / 时长 20 分钟预算</td>
          <td>委派路径的默认预算；原子路径宽松得多（1.3）</td>
        </tr>
        <tr>
          <td>任务一直跑不完、从不验收</td>
          <td>
            判据里是否用了 <code>dom</code> / <code>file</code> / <code>external_readback</code>
          </td>
          <td>这三种 kind 引擎不支持，永远判失败（8.3）</td>
        </tr>
        <tr>
          <td>任务明明完成了却判失败</td>
          <td>判据文本是否与界面实际文本一致</td>
          <td>visual 判定是字符串 includes；无树证据时才走模型兜底（8.2）</td>
        </tr>
        <tr>
          <td>截图里少了元素 / 树被截断</td>
          <td>树文本预算</td>
          <td>mac 48k / Windows 90k，但 TS 侧只截 48k → Windows 可能丢尾部（10.3）</td>
        </tr>
        <tr>
          <td>点不中元素 / 坐标偏移</td>
          <td>坐标是否按归一化窗口坐标传</td>
          <td>换算基于「模型看到那张图」的尺寸，可能已被降采样（5.2）</td>
        </tr>
        <tr>
          <td>动作数比工具调用数多</td>
          <td>
            <code>type_text</code> / <code>paste</code> 是否带 <code>into</code> /{' '}
            <code>submit</code>
          </td>
          <td>会自动追加 focus 与 Enter，一次调用最多 3 个动作（5.2）</td>
        </tr>
        <tr>
          <td>
            磁盘上还有 <code>.svb</code> 文件
          </td>
          <td>下一轮清理（≤ 6 小时）</td>
          <td>
            且 <code>manual</code> 模式快照永不自动删除（11.2）
          </td>
        </tr>
        <tr>
          <td>截图预览打不开 / 图片裂开</td>
          <td>令牌是否过期（5 分钟）</td>
          <td>
            渲染端会自动续签；<code>sessionId</code> 为空的授权只能等 TTL（11.3）
          </td>
        </tr>
        <tr>
          <td>界面里无法彻底关闭电脑操作</td>
          <td>设置页确实只有授权与诊断</td>
          <td>那套设置有 schema、有 IPC、无界面（12.1）</td>
        </tr>
        <tr>
          <td>暂停后卡片仍显示「进行中」</td>
          <td>时间线最后一条事件</td>
          <td>暂停不产生事件；徽标只看末事件（6.3）</td>
        </tr>
        <tr>
          <td>暂停后无法从界面继续</td>
          <td>卡片上没有「继续」按钮</td>
          <td>
            需要 Agent 调 MCP <code>resume</code>（12.3）
          </td>
        </tr>
        <tr>
          <td>紧急停止快捷键没反应</td>
          <td>设置行是否已持久化</td>
          <td>全新安装不会武装，需要先写入该设置并重启（12.1）</td>
        </tr>
        <tr>
          <td>卡片里显示英文错误码</td>
          <td>对照本表与协议错误码枚举</td>
          <td>中文映射表只有 7 个键且 3 个键名对不上（12.2）</td>
        </tr>
        <tr>
          <td>托盘按钮点了没反应</td>
          <td>主进程日志</td>
          <td>托盘失败只写日志、界面无提示（12.2）</td>
        </tr>
      </tbody>
    </table>

    <h2 id="notes">15. 事实边界说明</h2>
    <p>这一页的每条结论都来自仓库代码。有几处必须交代清楚，避免你把它们当成运行时验证结果：</p>
    <ul>
      <li>
        <strong>关于「会话权限层的硬闸是否真的会被触发」</strong>：代码顺序是可确认的
        （自动放行在审批回调之前）。但
        <code>canUseTool</code> 的具体调用策略属于外部 SDK （
        <code>@anthropic-ai/claude-agent-sdk</code>）的行为，不在本仓库内。
        所以本页的表述是「该硬闸是 fail-closed 兜底网，生产路径存在更早的自动放行」，
        而不是「它必然不会被触发」。
      </li>
      <li>
        <strong>spark 引擎路径未核实</strong>：<code>spark-*</code> 权限模式下
        「自动放行名单是否先于 approver 生效」的判定在引擎内核里，不在本仓库中。
      </li>
      <li>
        <strong>Windows 发布证书指纹无法从仓库确认</strong>：它是编译期环境变量注入的，
        仓库内没有证书或指纹字面量。
      </li>
      <li>
        <strong>原生宿主内部是否存在未暴露的超时</strong>：Swift / Rust 源码里没有请求级超时，
        <code>action_timeout</code> 完全由客户端产生；若宿主内部另有超时，本仓库看不到。
      </li>
      <li>
        <strong>kill switch 与「用户点停止」在时间线上无法区分</strong>——
        代码里没有为此写任何标记事件，这是可确认的事实，不是未核实项。
      </li>
    </ul>
    <p>
      最后一句实话：这套能力的工程完成度很高（双向签名、加密快照、心跳自愈、自动回滚、
      有界预算），但它的<strong>策略层是「标注」而不是「拦截」</strong>，
      多个安全字段是声明而非强制。使用前请按 4.2 与 4.3 的实际边界来评估风险，
      不要依赖任务契约里的那些未生效字段。
    </p>
  </>
)

const computerUse: DocsPageContent = {
  slug: 'computer-use',
  toc: [
    { id: 'overview', title: '1. 定位与真实入口', level: 2 },
    { id: 'entry', title: '1.1 入口与界面文案', level: 3 },
    { id: 'tools', title: '1.2 27 个工具的全貌', level: 3 },
    { id: 'two-paths', title: '1.3 两条使用路径', level: 3 },
    { id: 'permissions', title: '2. 系统权限与能力', level: 2 },
    { id: 'platform-matrix', title: '2.1 平台支持矩阵', level: 3 },
    { id: 'macos-permissions', title: '2.2 macOS 的三项授权', level: 3 },
    { id: 'windows-permissions', title: '2.3 Windows 的能力探测', level: 3 },
    { id: 'capabilities', title: '2.4 能力探测的关键常量', level: 3 },
    { id: 'governance', title: '3. 权限与审批：两道闸门的真实关系', level: 2 },
    { id: 'session-gate', title: '3.1 第一道：会话权限层', level: 3 },
    { id: 'auto-allow', title: '3.2 但生产路径其实在更早处就放行了', level: 3 },
    { id: 'broker-gate', title: '3.3 执行层：Broker 做了什么、没做什么', level: 3 },
    { id: 'approval-deprecated', title: '3.4 审批链为什么是停用的', level: 3 },
    { id: 'policy', title: '4. 策略引擎与它的真实边界', level: 2 },
    { id: 'risk-levels', title: '4.1 L0–L4 是怎么算出来的', level: 3 },
    { id: 'always-allow', title: '4.2 唯一的硬拒绝是 focus_mismatch', level: 3 },
    { id: 'task-contract', title: '4.3 任务契约里哪些字段真的生效', level: 3 },
    { id: 'atomic', title: '5. 原子动作链路', level: 2 },
    { id: 'atomic-tools', title: '5.1 十个原子工具', level: 3 },
    { id: 'click-rewrite', title: '5.2 click 的语义改写与坐标换算', level: 3 },
    { id: 'atomic-session', title: '5.3 隐式会话与空闲释放', level: 3 },
    { id: 'start-task', title: '6. 委派任务链路', level: 2 },
    { id: 'start-chain', title: '6.1 从 MCP 调用到算子循环', level: 3 },
    { id: 'coordinator', title: '6.2 桌面独占通道', level: 3 },
    { id: 'lifecycle', title: '6.3 状态与事件枚举', level: 3 },
    { id: 'controls', title: '7. 五个控制工具的真实语义', level: 2 },
    { id: 'pause-takeover', title: '7.1 pause 与 takeover 在主进程路径上逐行等价', level: 3 },
    { id: 'resume', title: '7.2 resume 只有一条路能真正恢复运行', level: 3 },
    { id: 'wait', title: '7.3 wait_for_completion 是有界等待，超时不算失败', level: 3 },
    { id: 'bind-target', title: '7.4 bind_target 的先决条件是「已暂停」', level: 3 },
    { id: 'verification', title: '8. 验收是怎么判定的', level: 2 },
    { id: 'three-kinds', title: '8.1 三种 kind 的判定规则', level: 3 },
    { id: 'visual-fallback', title: '8.2 visual 判定有一条模型兜底', level: 3 },
    { id: 'verification-gaps', title: '8.3 验收的两个现存缺口', level: 3 },
    { id: 'native-host', title: '9. 原生宿主', level: 2 },
    { id: 'why-native', title: '9.1 为什么必须有原生宿主', level: 3 },
    { id: 'trust', title: '9.2 双向签名校验', level: 3 },
    { id: 'protocol', title: '9.3 通信协议', level: 3 },
    { id: 'health', title: '9.4 健康检查与自愈', level: 3 },
    { id: 'element-tree', title: '10. 元素树与 stale 语义', level: 2 },
    { id: 'tree-render', title: '10.1 树如何渲染成 Markdown', level: 3 },
    { id: 'tree-version', title: '10.2 treeVersion 与 stale_tree', level: 3 },
    { id: 'platform-tree-diff', title: '10.3 两个平台的树差异', level: 3 },
    { id: 'snapshots', title: '11. 快照、隐私与留存', level: 2 },
    { id: 'capture', title: '11.1 截图路径与三套尺寸', level: 3 },
    { id: 'vault', title: '11.2 加密存储与清理', level: 3 },
    { id: 'preview', title: '11.3 预览令牌', level: 3 },
    { id: 'privacy', title: '11.4 隐私边界：实际做了什么', level: 3 },
    { id: 'ui', title: '12. 界面能做什么、不能做什么', level: 2 },
    { id: 'settings-gap', title: '12.1 设置页只有授权与诊断，没有开关', level: 3 },
    { id: 'chat-card', title: '12.2 聊天里的活动卡片', level: 3 },
    { id: 'tray-pip', title: '12.3 托盘与画中画（PIP）', level: 3 },
    { id: 'v2-flags', title: '13. V2 开关与自动回滚', level: 2 },
    { id: 'flag-table', title: '13.1 十个开关的真实消费情况', level: 3 },
    { id: 'rollback', title: '13.2 自动回滚阈值', level: 3 },
    { id: 'troubleshooting', title: '14. 排查表', level: 2 },
    { id: 'notes', title: '15. 事实边界说明', level: 2 },
  ],
  faq: [
    {
      question: '电脑操作需要我手动开启吗？默认是开着的吗？',
      answer:
        '默认是开启的：设置项 enabled 默认 true，environments 里只有 myDesktop 为 true（safeBrowser / safeDesktop 默认关闭，且工具入参只接受 my_desktop）。你唯一必须手动做的是在「设置 → 系统 → 电脑操作」里完成系统授权——macOS 需要屏幕录制、辅助功能、事件投递三项，Windows 只需运行时探测通过。设置页本身没有任何开关可以关掉这个能力。',
    },
    {
      question: 'Agent 操作我的电脑时，会抢走我的鼠标和焦点吗？',
      answer:
        '默认不会。动作优先走无障碍语义（例如元素左键单击会被改写为 invoke_element），鼠标键盘投递是后台优先的，不移动你的物理光标也不抢焦点。你切到别的应用时它会继续操作自己绑定的目标窗口。例外是少数必须前台的操作：Windows 的拖拽与 focus_window 需要先把目标窗口提到前台；macOS 的 move / drag / keypress 也只能走真实事件流。',
    },
    {
      question: '每次点击都会弹审批框让我确认吗？',
      answer:
        '不会，当前版本没有逐动作审批。设置页原文就写着「授权完成后，Agent 发起的电脑操作任务默认直接执行，不再逐步审批」。仓库里那套审批实现（含票证与过期语义）已标注为废弃、没有接到生产路径上，computer-use:approve-action 这个 IPC 还会直接抛错。动作以 approvalTicketId = null 直接执行。你真正能用的刹车是暂停、接管、停止与紧急停止快捷键。',
    },
    {
      question: '策略引擎会拦截危险动作吗？',
      answer:
        '不会拦截内容，只做风险分级。ComputerPolicyService.evaluate 在所有分支上都返回 allow，唯一的 deny 是「观测到的应用与动作目标应用不一致」（focus_mismatch）。风险等级 L0–L4 会算出来、写进动作记录并在卡片上展示，但不因此阻止执行——测试里连 L3 高风险动作都是直接放行的。任务契约里的 allowedApps / allowedDomains / forbiddenActions 等字段在生产路径没有任何读取点。',
    },
    {
      question: '截图会保存到磁盘吗？会打码吗？我能控制保留多久吗？',
      answer:
        '会保存，且是加密保存：blob 落在 userData/snapshot-vault/blobs/ 下，文件名是 24 随机字节的十六进制 + .svb，用 AES-256-GCM 加密，密钥存在操作系统钥匙串里。打码只发生在「观测证据帧」上（涂灰 AX 上报的 secure 区域），capture_app_snapshot 产出的快照完全不打码。保留策略要分清：证据帧有 24 小时 TTL，而 capture_app_snapshot 的快照在无会话时是 manual 模式、永不自动删除，且整体没有任何磁盘配额或 LRU。设置里那几个看起来像保留策略的字段（evidenceRetentionDays、redactSensitiveContent、fullRecordingEnabled）除默认值外没有任何生产读取点。',
    },
    {
      question: '紧急停止快捷键默认生效吗？',
      answer:
        '全新安装上不会。快捷键注册器确实是真实注入的 Electron globalShortcut，但武装（arm）只在启动时读取持久化设置行、或调用 computer-use:update-settings 时发生；而渲染端从不调用那个通道，所以设置行根本不存在，启动时 safeParse 失败就直接 return。想启用需要先让那一行设置被真正写入，然后重启。一旦武装，它的行为是取消所有活跃会话，且被它取消的会话不能 resume——只能重新开始。',
    },
  ],
  Body,
  aiSummary:
    '电脑操作（Computer Use）让 Agent 直接操作真实桌面：看屏幕、读元素树、点击输入滚动拖拽，以及把多步目标委派给独立决策循环。底层不是 Electron 而是独立的原生宿主子进程（macOS Swift / Windows Rust），通过 5 字节帧头的 stdio 协议通信，双向签名校验、心跳探活、每会话一次重启预算。本页讲清两条使用路径（原子动作与 start_task 委派）、权限为什么是两道互不相同的闸门、策略引擎「只分级不拦截」的真实边界、快照的 AES-256-GCM 加密与 17 项凭据类应用黑名单、以及 10 个 V2 开关里哪 4 个没有任何消费者。',
  quickReference: [
    { key: '设置入口', value: '设置 → 系统 → 电脑操作（项 id computer-use）' },
    { key: '工具数量', value: '27 个 mcp__spark_computer__* 工具' },
    { key: '默认开关', value: 'enabled=true；environments 只有 myDesktop=true' },
    { key: '可用环境', value: '仅 my_desktop（工具入参是 z.literal）' },
    { key: '平台支持', value: 'macOS + Windows；Linux 无实现，直接降级为不可用' },
    { key: '默认请求超时', value: '20 秒（上限 180 秒）；超时即 SIGKILL 宿主进程' },
    { key: '帧格式', value: '5 字节头（4 字节大端长度 + 1 字节 kind），载荷上限 64 MiB' },
    { key: '协议版本', value: '1' },
    { key: '心跳', value: '每 5 秒 get_capabilities，连续 3 次失败判定不健康' },
    { key: '重启预算', value: '每会话 1 次，仅取消会话时重置' },
    { key: '并发上限', value: '64 在飞 + 64 排队' },
    { key: '宿主退出码', value: '76 = 协议失败，77 = 认证失败' },
    { key: '委派任务预算', value: 'maxSteps 100 / maxRuntimeMs 20 分钟 / maxConsecutiveNoops 8' },
    { key: '原子会话预算', value: 'maxSteps 2000 / maxRuntimeMs 12 小时 / maxConsecutiveNoops 20' },
    { key: '原子会话空闲释放', value: '5 分钟（IDLE_RELEASE_MS = 300000）' },
    { key: '预览令牌 TTL', value: '5 分钟（合法区间 1 秒 ~ 60 分钟）' },
    { key: '快照加密', value: 'AES-256-GCM，密钥存 OS 钥匙串，目录 0700 / 文件 0600' },
    { key: '快照清理周期', value: '启动即跑一次，之后每 6 小时；孤儿文件宽限 24 小时' },
    { key: '证据帧 TTL', value: '24 小时' },
    { key: '凭据类应用黑名单', value: '17 项（仅作用于主动截图路径，精确 identity 匹配）' },
    { key: '决策树文本上限', value: 'TS 侧 48000 字符（mac 树 48000 / Windows 树 90000）' },
    { key: '元素树上限', value: 'mac 2000 个元素 / Windows 100000 个元素' },
    { key: '批量动作范围', value: 'MIN_BATCH_ACTIONS 2 ~ MAX_BATCH_ACTIONS 8' },
    { key: 'V2 开关', value: '10 个，默认全 true；其中 4 个无任何消费者' },
    { key: '默认紧急停止键', value: 'CommandOrControl+Shift+Esc（全新安装不会武装）' },
    { key: '错误码总数', value: '32 个（packages/protocol/src/computer-use/errors.ts）' },
  ],
  howTo: {
    name: '启用电脑操作并让 Agent 操作某个应用',
    description: '从系统授权到委派任务，再到验收与接管，走一遍完整流程。',
    totalTime: 'PT10M',
    steps: [
      '打开「设置 → 系统 → 电脑操作」，先看顶部状态条。若显示「电脑操作尚未就绪」，先处理下面的系统授权。',
      'macOS 上逐项点「请求授权」：屏幕录制、辅助功能与输入控制。首次会弹系统对话框；如果之前拒绝过，按钮会变成「打开系统设置」，需要到「系统设置 → 隐私与安全性」里手动勾选，授权后回到本页点「重新检测」。',
      'Windows 上没有弹窗，权限状态直接由运行时探测给出 granted / restricted。若某项 restricted，先确认对应系统能力（图形捕获 / UI Automation / 输入注入）是否可用。',
      '授权完成后点「运行诊断」，确认 diagnosticCode 正常、观测与动作延迟有数值。诊断只含耗时与状态，不含截图或输入内容，可以放心复制给别人看。',
      '回到会话，直接描述目标即可，例如「把这份文档的内容填到编辑器里并保存」。涉及具体应用时把应用名说清楚，Agent 会据此解析目标窗口。',
      '长任务建议让 Agent 用 start_task 委派，它会自己循环直到完成、失败或需要你接管；短任务则用原子动作一次一步更可控。',
      '过程中可以在聊天卡片或系统托盘里操作：暂停（停下并中断在途动作）、接管（停止 Agent 让你自己接手）、停止（终态取消，不可恢复）。注意暂停后界面上没有「继续」按钮，需要让 Agent 通过 MCP 恢复。',
      '想知道它做了什么，看聊天里的活动卡片：每行一个事件带时间，控制按钮只在最新一段且非终态时出现。卡片不显示每次观测，同一动作的请求与终态会折叠成一条。',
      '任务判完成靠 successCriteria 的逐条验收。若反复跑不完，检查判据是否用了引擎不支持的 dom / file / external_readback——这三种永远判失败。',
      '用完之后记住两件事：暂停的会话需要显式恢复或停止；电脑操作自身没有界面开关可以关闭，只能依赖会话结束与撤销系统授权。',
    ],
  },
}

export default computerUse
