# 语音采集启动与错误处理

> 状态: 已落地 | 最后核对: 2026-08-30

语音包就绪后，渲染进程必须按以下顺序启动采集，避免在麦克风不可用时提前创建 native 识别会话：

1. 使用 `enumerateDevices()` 检查是否存在 `audioinput`。
2. 调用 `voice:request-microphone-permission` 检查操作系统权限；macOS 首次使用由主进程通过 `systemPreferences.askForMediaAccess('microphone')` 请求授权。若 macOS 或 Windows 已拒绝权限，主进程直接拉起系统麦克风权限设置页，渲染进程显示操作提示并立即将语音按钮复位为 idle，不保留红色录入态。
3. 授权后重新枚举设备并调用 `getUserMedia()`。系统默认输入设备出现 `AbortError`、`NotReadableError` 等硬件错误时，依次尝试其他音频输入设备。
4. 确认音频流至少包含一条未结束的 audio track，随后创建 `AudioContext` 与 AudioWorklet。Worklet 脚本从 renderer 的同源 public 资源加载，不能使用 `blob:`：当前 CSP 为 `script-src 'self'`，Chromium 会将被 CSP 拦截的 blob Worklet 误报为 `AbortError: The user aborted a request.`。
5. 最后调用 `voice:start` 创建 sherpa-onnx 识别会话并连接采集图。

启动任一步失败都必须释放已取得的音轨、AudioContext、Worklet 节点、事件订阅和主进程会话。浏览器原始异常不直接展示：无设备、权限拒绝、设备被占用、系统中止和约束不支持分别转换为可操作的中文提示。录音期间还要监听音轨断开、AudioWorklet 处理异常和消息传输异常，并自动结束失效会话。

用户手动停止时先关闭本地采集，再调用 `voice:stop`，但必须等主进程完成尾部解码并推送最后一个 `final` 后才能取消识别事件订阅，否则最后一段文本会丢失。

掉字防护（2026-08）：采集约束关闭浏览器降噪（`noiseSuppression: false`，保留回声消除与自动增益），Chromium 降噪会削掉字头轻辅音；AudioWorklet 在 48kHz→16kHz 抽取前先过约 7.2kHz 的 4 阶低通，抑制高频混叠。主进程在 VAD endpoint 触发时先补约 0.64s 静音再解码一轮，把在线模型滞留的尾部 token 逼出来后才 reset（Paraformer 在线版有数百毫秒发射延迟，直接 reset 会吞掉句尾字）；手动停止的尾部 padding 为 0.75s；解码线程数为 2。

macOS 打包产物必须在 `Info.plist` 包含 `NSMicrophoneUsageDescription`，并在 Hardened Runtime 签名 entitlement 中包含 `com.apple.security.device.audio-input=true`；缺少后者时 TCC 会直接拒绝请求，既不弹授权框，也不会在麦克风权限列表中展示应用。语音 native runtime 在安装后按需下载到 `userData`，无法使用应用 Team ID 签名，因此还必须启用 `com.apple.security.cs.disable-library-validation=true`，否则 macOS 会拒绝加载 `.node` 依赖的 ad-hoc `.dylib`，而 `sherpa-onnx` wrapper 会将它包装成“找不到 native 模块”。下载前后的 manifest SHA-256 校验仍是信任边界。开发模式的系统权限项可能显示为 Electron，正式安装包显示为 SparkWork；用户在系统设置中修改已拒绝的权限后需要重启应用。

## 录音态反馈

AudioWorklet 每累计 1600 个 16kHz PCM sample（约 100ms）发送一次音频块，同时计算该块的归一化 RMS 音量。PCM 的 `ArrayBuffer` 使用 transferable 传给 renderer，避免高频采集时额外复制；renderer 仍只把 PCM 发给主进程识别，音量仅用于界面反馈。

音量历史保存在独立的 external store 中，录音按钮通过 `useSyncExternalStore` 单独订阅。这样实时音轨更新不会让整个 Composer 重渲染。录音态采用无外框的扁平结构，展示最多 18 个真实音量采样、单调计时和明确的停止方块；历史从空轨开始，并对纯底噪做视觉 noise gate，不能用静音占位画出无意义的虚线。深色与浅色主题均使用语义色变量，窄窗口下缩短音轨但保留计时和停止操作。

鼠标悬浮语音入口时展示紧凑的 `Control+Shift+D`（macOS：`⌃⇧D`）提示。该快捷键在 Composer 挂载期间切换开始/结束语音输入；组合输入、按键长按、弹窗遮挡及语音不可用状态不会触发。启动、录音和停止期间输入框只读，所有发送入口都必须禁用或在业务函数中拒绝发送，防止 partial 尚未锁定时提交不完整文本。`stop()` 需要保持幂等：即使 Fast Refresh 已清理底层 session，也必须将残留录音 UI 复位到 idle。
