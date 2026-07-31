# 无限画布图片反推与深度视频交付核对

日期：2026-08-01

## 交付范围

- 基础任务菜单新增“图片反推”和“深度视频”。
- 基础任务菜单移除“文本生成”“文本改写”“Prompt 优化”，协议和旧画布执行能力继续保留。
- 图片反推复用图片理解模型链路，要求恰好一张图片，只输出可直接使用的中文提示词。
- 深度视频使用本地 Depth Anything V2 Small INT8 ONNX 推理；模型加载、预处理、推理、归一化和时间平滑均在独立 worker thread 中执行，FFmpeg 负责流式解码和 H.264 编码，输出近白远黑且无音轨的视频。
- 模型通过 Spark MinIO 制品仓库按需安装，逐文件和归档均做 SHA-256 校验。

## 模型制品

- Artifact ID：`model.depth-anything-v2-small-int8-1.0.0`
- 上游：`onnx-community/depth-anything-v2-small`
- 固定 revision：`4472b7362082ad9968fee890ca0f1e5aca36b93d`
- 许可证：Apache-2.0
- 归档大小：21,231,211 字节
- 归档 SHA-256：`7bc437aa9ece0527af71b1c8ddfdcc990ba8a470b8082adb028b3a0c691ee350`
- 公网地址：`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/dependencies/models/depth-anything-v2/depth-anything-v2-small-int8-1.0.0.tar.gz`
- 清单地址：`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json`

发布过程已先备份线上清单，再上传模型对象和 staging 清单，最后发布正式清单。发布脚本从公网完整下载模型归档并重新计算 size/SHA-256；仓库审计结果为 65 个制品，其中 `model` 1 个。
从相同固定 revision 独立构建两次所得归档的大小和 SHA-256 完全一致，确认构建可重复。

## 真实短视频验收

使用 Spark 管理的 FFmpeg 7.1.1 生成 1 秒、3 FPS、160×96、H.264 + AAC 的短视频，并使用正式 `DepthVideoRunner`、线上发布归档解出的 INT8 模型完成三帧推理。

验收结果：

- 输入：H.264，160×96，3 FPS，1.0 秒，包含 AAC 音轨。
- 输出：H.264，160×96，3 FPS，1.0 秒，无音轨。
- 实际处理帧数：3。
- 进度阶段：`decoding`、`estimating_depth`、`encoding`。
- 首、中、尾帧均为稳定的灰度深度图；前景猫主体亮于后方背景，符合“近白远黑”。
- 验收期间发现 FFmpeg 8 不再接受 `-vsync 0`，已改用 `-fps_mode passthrough` 并补充回归测试。
- 深度任务 IPC 复用 `safe-file` 的 canonical-path 校验，拒绝通过符号链接逃逸画布、工作区、临时目录和应用数据目录的输入。
- 深度任务限制为单任务执行，取消时会终止推理 worker 与 FFmpeg；结构输入契约不会被“跳过 Provider 参数警告”绕过。
- FFmpeg 取消先发送 `SIGTERM`，进程未退出时升级为 `SIGKILL`；应用退出时统一中止仍在运行的深度任务。
- VFR 输入在解码端依据时间戳转换为源平均帧率的 CFR，再进入 rawvideo 管线；旋转视频按 display geometry 处理，奇数尺寸改用 H.264 `yuv444p` 保持原尺寸。
- 模型归档先安装并校验到 staging 目录，验证通过后再原子替换活动模型；失败时保留旧目录。
- 节点面板会读取本地模型状态，首次使用明确显示“下载模型并运行”。

可重复执行：设置 `SPARK_DEPTH_ACCEPTANCE_USER_DATA`、`SPARK_DEPTH_ACCEPTANCE_MODEL_DIR`、`SPARK_DEPTH_ACCEPTANCE_INPUT`、`SPARK_DEPTH_ACCEPTANCE_OUTPUT` 后运行 `DepthVideoRunner.acceptance.test.ts`。未提供这些变量时测试默认跳过，不触发模型下载或本地推理。

## 验证记录

- 图片反推、菜单分类、提交校验、专用面板测试通过。
- 模型完整性、深度数学、帧估计、视频 runner、深度 IPC 测试通过。
- Canvas store 本地任务路由、媒体结果写回和任务继承测试通过。
- Protocol 单元测试 157 项通过。
- Desktop renderer 与 Node TypeScript 检查通过。
- Desktop 生产构建通过并生成独立的 `out/main/depth-inference-worker.js`。
- `node scripts/audit-artifact-repository.mjs` 通过。

全量 Desktop 测试共 2639 项，其中 2631 通过、1 跳过、4 todo；剩余 3 个失败来自并发修改中的聊天侧栏宽度源码断言和已记录的画布浮动工具栏源码断言，不涉及本功能。上述本功能定向测试均通过。

GitNexus MCP 在当前会话未暴露，按项目降级规则使用 `rg`、定向测试、TypeScript 检查和 `git diff` 完成影响范围与变更范围核对。
