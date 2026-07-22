# 模型清单

> 状态: 已落地 | 最后核对: 2026-07-23
> 来源: https://cloud.tencent.com/document/product/1823/130051

## 视觉模型：图像生成（image.generate）

| 模型名称      | model 参数      | 模型介绍                                                                         | 任务类型        | 默认并发数 |
| ------------- | --------------- | -------------------------------------------------------------------------------- | --------------- | ---------- |
| HY-Image-V3.0 | `hy-image-v3.0` | 思考图像布局/构图/笔触，世界知识推理；千字级复杂语义；长文本文字/漫画/表情包生成 | 文生图 / 图生图 | 1          |
| HY-Image-Lite | `hy-image-lite` | 超高压缩编解码器，快速响应高品质输出；电商/设计/游戏场景                         | 文生图          | 1          |

## 视觉模型：视频生成（video.generate）

| 模型名称                | model 参数             | 模型介绍                                              | 任务类型            | 默认并发数 |
| ----------------------- | ---------------------- | ----------------------------------------------------- | ------------------- | ---------- |
| HY-Video-1.5            | `hy-video-1.5`         | 文本/图像多模态输入，高清视频，场景切换与多角色交互   | 文生视频 / 图生视频 | 5          |
| YT-Video-2.0            | `yt-video-2.0`         | 动态连贯、画面过渡自然；广告/影视/产品展示            | 图生视频            | 5          |
| YT-Video-HumanActor     | `yt-video-humanactor`  | 单张参考照片驱动人像视频；表情/姿态还原；写实/二次元  | 图生视频            | 5          |
| YT-Video-FX             | `yt-video-fx`          | 上传图片 + 特效模板生成特效视频                       | 图生视频            | 5          |
| Kling-Video-v3          | `kl-video-v3`          | 智能分镜 + 15 秒长视频；场景切换与连续叙事；广告/影视 | 文生视频 / 图生视频 | 5          |
| Kling-Video-v2.6        | `kl-video-v2-6`        | 画面+语音+音效+环境音同步生成                         | 文生视频 / 图生视频 | 5          |
| Kling-Video-v2.5-turbo  | `kl-video-v2-5-turbo`  | 文本+图像输入，性能/性价比；大批量                    | 文生视频 / 图生视频 | 5          |
| Kling-Video-v2.1-master | `kl-video-v2-1-master` | 文本+图像；专业创作深度优化，1080P                    | 文生视频 / 图生视频 | 5          |
| Kling-Video-v2.1        | `kl-video-v2-1`        | 图像输入；标准/高质量/大师三档                        | 文生视频 / 图生视频 | 5          |
| Kling-Video-v2-master   | `kl-video-v2-master`   | 文本+图像；品牌广告与创意内容                         | 文生视频 / 图生视频 | 5          |
| Kling-Video-v1.6        | `kl-video-v1-6`        | 文本+图像+多图参考；标准/高品质双模式                 | 文生视频 / 图生视频 | 5          |
| Kling-Video-v1.5        | `kl-video-v1-5`        | 图像输入，1080P                                       | 文生视频 / 图生视频 | 5          |
| Kling-Video-v1          | `kl-video-v1`          | 文本+图像，最高 1080P                                 | 文生视频 / 图生视频 | 5          |
| Vidu-Video-q3-pro       | `vd-video-q3-pro`      | 16 秒 1080P 音视频直出；多角色叙事                    | 文生视频 / 图生视频 | 5          |
| Vidu-Video-q3-turbo     | `vd-video-q3-turbo`    | 16 秒音视频直出；规模化/高频迭代                      | 文生视频 / 图生视频 | 5          |
| Vidu-Video-q2-pro       | `vd-video-q2-pro`      | 文本/图像/参考图；高质量短片                          | 文生视频 / 图生视频 | 5          |
| Vidu-Video-q2-pro-fast  | `vd-video-q2-pro-fast` | 优化推理架构，高画质+快速                             | 文生视频 / 图生视频 | 5          |
| Vidu-Video-q2-turbo     | `vd-video-q2-turbo`    | 低成本高速度；批量/原型验证                           | 文生视频 / 图生视频 | 5          |
| Vidu-Video-q2           | `vd-video-q2`          | 图像+首尾帧输入；微表情；2-8 秒可选                   | 文生视频 / 图生视频 | 5          |

## 视觉模型：3D 生成

| 模型名称      | model 参数      | 模型介绍                                                                | 任务类型          | 默认并发数 |
| ------------- | --------------- | ----------------------------------------------------------------------- | ----------------- | ---------- |
| HY-3D-3.0     | `hy-3d-3.0`     | 文生 3D、图生 3D、多视图生 3D、单几何（白模）、草图生 3D、智能拓扑生 3D | 文生 3D / 图生 3D | 3          |
| HY-3D-3.1     | `hy-3d-3.1`     | 八视图多角度输入，几何/纹理提升                                         | 文生 3D / 图生 3D | 3          |
| HY-3D-Express | `hy-3d-express` | 极速版，1 分 30 秒内生成模型                                            | 文生 3D / 图生 3D | 1          |

## 多模态理解（multimodal）

| 模型名称               | model 参数                             | 模型介绍                                                        | 上下文窗口 | 最大输入 | 最大输出 |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------- | ---------- | -------- | -------- |
| YT-VITA                | `youtu-vita`                           | 视频+图片理解（画面+音频）                                      | 128k       | 100k     | 15k      |
| HY-Vision-2.0-Instruct | `hy-vision-2.0-instruct`               | 快思考；通用图生文；感知/识别/知识/OCR/STEM/推理/图表           | 44k        | 24k      | 16k      |
| HY-Vision-1.5-Thinking | `hunyuan-t1-vision-20250916`           | 深度思考；图文问答/视觉定位/OCR/图表/拍题/看图创作；英文+小语种 | 40k        | 16k      | 24k      |
| HY-Vision-Video        | `hunyuan-turbos-vision-video-20250728` | 视频描述/视频问答                                               | 32k        | 24k      | 8k       |

## 向量模型（embedding）

| 模型                       | model 参数                   | 输出维度 | 上下文窗口 | 输入           |
| -------------------------- | ---------------------------- | -------- | ---------- | -------------- |
| Kinfra-Text-Embedding-0.6b | `kinfra-text-embedding-0.6b` | 1024     | 32k        | 文本           |
| Kinfra-Text-Embedding-4b   | `kinfra-text-embedding-4b`   | 2560     | 32k        | 文本           |
| Kinfra-VL-Embedding-2b     | `kinfra-vl-embedding-2b`     | 2048     | 32k        | 文本/图片/视频 |
| Kinfra-VL-Embedding-8b     | `kinfra-vl-embedding-8b`     | 4096     | 32k        | 文本/图片/视频 |

支持 30+ 主流语言：中文、英文、日语、韩语、法语、德语、俄语、葡萄牙语、西语等。

## 语言模型（仅参考）

不在多媒体接入范围，但平台支持：Hy3、Hy3 preview、Hy-MT2-Pro/Plus/Lite、Hy-Role-Latest、Hy-Role、DeepSeek-V4-Flash/Pro、原厂直供版、Deepseek-v3.2（2026-7-16 下线）、GLM-5.2/5.1/5V-Turbo/5-Turbo/5、Kimi K3 / K2.7 Code HighSpeed / K2.7 Code / K2.6 / K2.5、MiniMax-M3/M2.7/M2.5、Qwen3.5-Flash/Plus。
