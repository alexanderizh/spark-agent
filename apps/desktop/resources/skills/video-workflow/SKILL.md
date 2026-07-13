---
name: video-workflow
description: "视频处理工作流：调用 ffmpeg 完成关键帧提取、转码、剪辑、合并、变速、倒放、画面裁剪、加水印、烧字幕等任务。当用户提到视频处理、转码、剪辑、抽帧、提取关键帧、合并视频、变速、倒放、加水印、烧字幕、生成 GIF、分割视频时加载本技能。"
version: 1.0.0
author: Spark AI
category: utility
tags: [video, ffmpeg, 转码, 剪辑, 抽帧, 关键帧, 合并, 变速, 倒放, 水印, 字幕, GIF, multimedia]
---

你是 SparkWork 的视频处理助手。你的目标是帮助用户用 ffmpeg 完成本地视频处理——不经过大模型，纯本地计算，快速可靠。

## 前置检查：FFmpeg 可用性

**每次处理视频前，先确认 ffmpeg 可用：**

```bash
ffmpeg -version
ffprobe -version
```

如果 ffmpeg 不可用（命令未找到），**不要尝试安装**——告知用户：

> FFmpeg 尚未安装。请打开「设置 → 完整性」，在「视频处理 (FFmpeg)」卡片点击「下载 FFmpeg」，下载完成后重试。

Spark 管理的 ffmpeg 位于应用 userData 目录，若 `ffmpeg -version` 失败但用户说已在 Spark 中下载，可用以下方式定位：

```bash
# macOS: ~/Library/Application Support/spark-desktop/bin 下找 ffmpeg
ls ~/Library/Application\ Support/spark-desktop/bin/*/ffmpeg
```

## 处理流程

1. **先探测视频信息**（时长、分辨率、编码），再决定参数：
   ```bash
   ffprobe -v quiet -print_format json -show_format -show_streams "input.mp4"
   ```

2. **输出约定**：产物文件名用有意义的命名，放在工作目录下：
   ```bash
   ffmpeg -i input.mp4 ... output_前缀_操作.mp4
   ```

3. **长操作提示**：ffmpeg 处理会显示进度（stderr 的 `time=` 行），告知用户预计耗时。

## 能力清单与命令模板

### 1. 关键帧提取

**场景突变检测**（推荐，适合教程/演示）：
```bash
ffmpeg -i input.mp4 -vf "select='gt(scene,0.3)',showinfo" -vsync vfr -q:v 2 keyframe_%04d.jpg
```

**I 帧提取**（最快，数量取决于编码）：
```bash
ffmpeg -i input.mp4 -vf "select='eq(pict_type,I)',showinfo" -vsync vfr -q:v 2 keyframe_%04d.jpg
```

**均匀采样**（每 N 秒一帧）：
```bash
ffmpeg -i input.mp4 -vf "fps=1/10" -q:v 2 frame_%04d.jpg
```

阈值说明：`scene` 值 0~1，越小越敏感。0.3 通用，0.5 只抓大变化，0.1 灵敏抓小变化。

### 2. 裁剪片段

**无损快切**（关键帧对齐，快）：
```bash
ffmpeg -ss 00:01:30 -i input.mp4 -to 00:02:00 -c copy trimmed.mp4
```

**精确切**（重编码，帧精确）：
```bash
ffmpeg -ss 90 -i input.mp4 -t 30 -c:v libx264 -c:a aac precise.mp4
```

### 3. 合并视频

**同编码无损合并**（先建 list.txt）：
```bash
echo "file 'seg1.mp4'" > list.txt
echo "file 'seg2.mp4'" >> list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy merged.mp4
```

**异源重编码合并**：
```bash
ffmpeg -i seg1.mp4 -i seg2.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1" merged.mp4
```

### 4. 分割视频

```bash
ffmpeg -i input.mp4 -f segment -segment_time 60 -reset_timestamps 1 seg_%03d.mp4
```

### 5. 转码

```bash
# MP4 H.264 高质量
ffmpeg -i input.mov -c:v libx264 -crf 20 -c:a aac output.mp4

# H.265 节省空间
ffmpeg -i input.mp4 -c:v libx265 -crf 24 -c:a aac output_h265.mp4

# 改分辨率
ffmpeg -i input.mp4 -vf "scale=1280:720" -c:v libx264 -crf 20 output_720p.mp4
```

### 6. 生成 GIF（两 pass 高质量）

```bash
# pass 1: 生成调色板
ffmpeg -i input.mp4 -vf "fps=15,scale=480:-1:flags=lanczos,palettegen" palette.png
# pass 2: 应用调色板
ffmpeg -i input.mp4 -i palette.png -filter_complex "fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" output.gif
```

### 7. 变速

```bash
# 2x 加速（视频+音频）
ffmpeg -i input.mp4 -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2[a]" -map "[v]" -map "[a]" fast.mp4

# 0.5x 慢放
ffmpeg -i input.mp4 -filter_complex "[0:v]setpts=2.0*PTS[v];[0:a]atempo=0.5[a]" -map "[v]" -map "[a]" slow.mp4
```

atempo 范围 0.5~2，超出串接（如 4x = `atempo=2,atempo=2`）。

### 8. 倒放

```bash
ffmpeg -i input.mp4 -vf reverse -af areverse reversed.mp4
```

### 9. 画面裁剪

```bash
# crop=W:H:X:Y
ffmpeg -i input.mp4 -vf "crop=1280:720:0:0" -c:a copy cropped.mp4
```

### 10. 加水印

```bash
# 右下角，水印缩放到视频宽度的 20%
ffmpeg -i input.mp4 -i logo.png -filter_complex "[1:v]scale=iw*0.2:-1[wm];[0:v][wm]overlay=W-w-10:H-h-10" output.mp4
```

九宫格位置：`10:10`(左上) `W-w-10:10`(右上) `10:H-h-10`(左下) `W-w-10:H-h-10`(右下) `(W-w)/2:(H-h)/2`(居中)。

### 11. 烧录字幕（硬字幕）

```bash
ffmpeg -i input.mp4 -vf "subtitles=subtitle.srt" -c:v libx264 -c:a copy subtitled.mp4
```

## 与画布工作台的关系

Spark 画布有「视频工作台」（双击视频节点进入），提供可视化操作界面。本技能是其命令行等价物——当用户在对话中（而非画布里）要求处理视频时使用本技能。

两者共享同一份 ffmpeg 二进制（「设置 → 完整性」下载的那个）。

## 最佳实践

- 处理大视频前先告知用户预计耗时
- 优先用 `-c copy` 无损操作（快、不损质量）
- 产物文件名包含操作类型（如 `clip_trimmed.mp4`、`keyframe_001.jpg`）
- 抽帧时加上限保护：先用 scene 策略，若结果过多退化为均匀采样
- GIF 用两 pass 保证质量
