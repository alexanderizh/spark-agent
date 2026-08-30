# 视频特效与人像驱动

> 状态: 已落地 | 最后核对: 2026-07-23
> 来源: https://cloud.tencent.com/document/product/1616/119194、119001、119002、125458、125459

## 视频特效模型（YT-Video-FX → SubmitTemplateToVideoJob）

> 入口: https://cloud.tencent.com/document/product/1616/119194

通过上传图片和选择特效模板生成一段特效视频。`Template` 字段传入下表的 template 名称。

### 模板清单

> 360p 默认 1 积分，720p 默认 2 积分（个别模板积分不同，下方标注）。
> 说明：2026-07-23 重新打开官方页面核得 141 个唯一 template 值；代码 Manifest 已全部录入并允许后续新增模板自定义输入。本节表格保留常用模板摘要，以腾讯云原文为准。

| 中文名           | template       | 图片数量上限 | 360p                    | 720p            |
| ---------------- | -------------- | ------------ | ----------------------- | --------------- |
| 亲吻             | kissing        | 2            | 1                       | 2               |
| 比心             | hearting       | 2            | 1                       | 2               |
| 拥抱             | hug            | 2            | 1                       | 2               |
| 亲脸颊           | kissface       | 2            | 1                       | 2               |
| 毛茸茸           | fuzzy          | 1            | 1                       | 2               |
| 捏捏             | pinch          | 1            | 1                       | 2               |
| 变手办风         | befigure       | 1            | 1                       | 2               |
| 金色长发         | longhair       | 1            | 1                       | 2               |
| 万物生花         | bloom          | 1            | 1                       | 2               |
| 膨胀             | morphlab       | 1            | 1                       | 2               |
| 飞走了           | balloonfly     | 1            | 1                       | 2               |
| 被拽走了         | dragme         | 1            | 1                       | 2               |
| 变身玩偶         | minidoll       | 1            | 1                       | 2               |
| 毕业啦           | graduation     | 1            | 1                       | 2               |
| 旋转             | rotate         | 1            | 1                       | 2               |
| 被震飞了         | knockedfly     | 1            | 1                       | 2               |
| 面对疾风         | windonface     | 1            | 1                       | 2               |
| 万物归尘         | return2dust    | 1            | 1                       | 2               |
| 被掏空了         | deflate        | 1            | 1                       | 2               |
| 起飞             | flying         | 1            | 1                       | 2               |
| 旱地冲浪         | surfme         | 1            | 1                       | 2               |
| 一起庆生         | birthdayme     | 1            | 1                       | 2               |
| 埃及变装         | egyptme        | 1            | 1                       | 2               |
| 背后爆炸我优雅   | neverlookback  | 1            | 1                       | 2               |
| 变身机甲         | futuresoldier  | 1            | 1                       | 2               |
| 萌宠草裙舞       | petdance       | 1            | 1                       | 2               |
| 变身美人鱼       | mermaidme      | 1            | 1                       | 2               |
| 失去所有力气     | falldown       | 1            | 1                       | 2               |
| 人像微动         | picmotion      | 1            | 1                       | 2               |
| 吃我一拖鞋       | shoehit        | 1            | 1                       | 2               |
| 倒头就是睡       | napme          | 1            | 1                       | 2               |
| 被抓走了         | arrestrandom   | 1            | 1                       | 2               |
| 被熊猫抱抱       | pandahug       | 1            | 1                       | 2               |
| 公主抱           | bridalcarry    | 1            | 1                       | 2               |
| 男士发型盲盒     | manhair        | 1            | 1                       | 2               |
| 变身肌肉美男     | muscleme       | 1            | 1                       | 2               |
| 被压扁了         | crushme        | 1            | 1                       | 2               |
| 捏脸             | facepinch      | 1            | 1                       | 2               |
| 秃头就现在       | baldme         | 1            | 1                       | 2               |
| 长翅膀           | mywings        | 1            | 1                       | 2               |
| 打碎镜头         | breaklens      | 1            | 1                       | 2               |
| 镜头远离         | zoomout        | 1            | 1                       | 2               |
| 动漫视频         | animelive      | 1            | 4                       | 6               |
| 图片 live        | livephoto      | 1            | 4                       | 6               |
| 冲浪一夏         | surfing        | 1            | 1                       | 2               |
| 天降美男         | heavensentlove | 1            | 1                       | 2               |
| 镜头推近         | zoomin         | 1            | 1                       | 2               |
| 卡通视频         | cartoonlive    | 1            | 4                       | 6               |
| 3D 手办风        | 3dfigure       | 1            | 1                       | 2               |
| 捧脸亲吻         | caresskiss     | 1            | 1                       | 2               |
| 法式热吻         | frenchkiss     | 1            | 1                       | 2               |
| 一镜到底         | onestory       | 2-10         | 1×(n-1)                 | 2×(n-1)         |
| P 掉图中最丑的人 | removeperson   | 1            | 1                       | 2               |
| 百变发型         | hairstyle      | 1            | 1                       | 2               |
| 时光对视         | timegaze       | 1            | 1                       | 2               |
| 随机消散         | dissipation    | 1            | 1                       | 2               |
| 环视 3D 手办     | 3dfigurerot    | 1            | 1                       | 2               |
| 夏夜派对         | y2kparty       | 1            | 1                       | 2               |
| 壁咚亲吻         | wallkiss       | 1            | 2                       | 4               |
| 恶灵骑士         | befire         | 1            | 2                       | 4               |
| AI 减龄          | babyme         | 1            | 1                       | 2               |
| 多重分身         | duplicateself  | 1            | 1                       | 2               |
| 被骷髅抓走了     | atomy          | 1            | 1(360p)/2(540p)/3(720p) |
| 闪电侠           | flashman5      | 1            | 1                       | 2               |
| 树袋熊亲吻       | koalakiss      | 1            | 2                       | 4               |
| 人物变展品       | figurine       | 1            | 1                       | 2               |
| 骑行飞翔         | ridefly        | 2            | 1                       | 2(540p)/3(720p) |
| 脸颊贴贴         | cheeks         | 1            | 1                       | 2               |
| ...              | ...            | ...          | ...                     | ...             |

完整列表见腾讯云原文 `视频特效模板列表` 文档。

### 调用示例（已裁剪）

```http
POST /
Host: vclm.tencentcloudapi.com
X-TC-Action: SubmitTemplateToVideoJob

{
  "Template": "hug",
  "Images": [
    {"Url": "https://cos-internal.ap-guangzhou.tencentcos.cn/.../example.png"}
  ]
}
```

查询响应：

```json
{
  "Response": {
    "Status": "DONE",
    "ErrorCode": "",
    "ErrorMessage": "",
    "ResultVideoUrl": "https://console.cloud.tencent.com/result.mp4",
    "RequestId": "..."
  }
}
```

`Status`：WAIT / RUN / FAIL / DONE；`ResultVideoUrl` 24 小时有效。

## 人像驱动（YT-Video-HumanActor → SubmitHumanActorJob）

支持提交音频和图文来生成对应视频；满足动态交互、内容生产等场景需求。

### 输入参数

| 参数                | 必选 | 类型             | 描述                                                             |
| ------------------- | ---- | ---------------- | ---------------------------------------------------------------- |
| Prompt              | 是   | String           | 文本提示词 ≤5000 字符；支持 `##` 局部时间控制（如 `#3#` 第三秒） |
| AudioUrl            | 是   | String           | 音频 URL；时长 2-60 秒；mp3/wav；≤10M                            |
| ImageUrl            | 否   | String           | 图片 URL；jpg/jpeg/png/bmp/webp；192-4096；≤10M；宽高 1:4 ~ 4:1  |
| ImageBase64         | 否   | String           | Base64，与 ImageUrl 二选一，URL 优先                             |
| Resolution          | 否   | String           | 720p / 1080p，默认 1080p                                         |
| FrameRate           | 否   | Integer          | 25 / 50 fps，默认 50                                             |
| LogoAdd / LogoParam | 否   | Integer / Object | 水印                                                             |

查询响应同视频特效：`Status` / `ResultVideoUrl`（24h）/ `ErrorCode` / `ErrorMessage`。

Spark-Agent 已按 TokenHub 小写下划线协议组装 `prompt + audio_url + image_url/image_base64`，Manifest 强制要求 1 张图片、1 段音频和提示词。

## 图片唱演（SubmitPortraitSingJob / DescribePortraitSingJob）

文档导航：第三方生视频相关接口同级。详细参数未在本次抓取中展开，二次接入时再补齐。

## 混元生视频（HY-Video）→ SubmitHunyuanToVideoJob

详细见 `legacy-hunyuan-video.md`。模型版本：HY-Video-1.5。
