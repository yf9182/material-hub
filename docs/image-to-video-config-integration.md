# 图生视频素材 Config 接入文档

本文档提供给 App 端，用于接入 `preset = "image_to_video"` 的标准素材。

## 1. 判断素材类型

App 应优先读取 `material_config`，通过 `preset` 判断业务类型：

```text
preset = image_to_image  → 图生图
preset = image_to_video  → 图生视频
```

不要通过 `type` 判断图生图或图生视频。`type` 只表示素材卡片的展示形式：

| 字段 | 值 | 含义 |
| --- | ---: | --- |
| `type` | `1` | 前后图对比展示 |
| `type` | `2` | 单效果图 / 单封面展示 |

`image_count` 表示用户需要上传的参考图数量，与 `type` 没有直接关系。

## 2. 图生视频 Config

```json
{
  "schema_version": 1,
  "preset": "image_to_video",
  "type": 2,
  "image_count": 1,
  "video_duration": 5,
  "video_resolution": "720p",
  "price": 20,
  "prompt": "Use the uploaded image as the primary reference...",
  "extensions": {}
}
```

核心字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schema_version` | `Int` | 否 | 当前为 `1` |
| `preset` | `String` | 是 | 必须为 `image_to_video` |
| `type` | `Int` | 是 | `1` 或 `2`，只控制封面展示方式 |
| `image_count` | `Int` | 是 | `1` 或 `2`，用户上传的参考图数量 |
| `video_duration` | `Int` | 是 | 视频时长，支持 `5`、`10`、`15` 秒 |
| `video_resolution` | `String` | 是 | 支持 `720p`、`1080p` |
| `price` | `Int` | 否 | 消耗积分；应与素材顶层价格一致 |
| `prompt` | `String` | 是 | 传给生成服务的提示词 |
| `extensions` | `Object` | 否 | App 专属扩展字段，未知字段应忽略 |

### 默认值与兼容策略

对于旧素材或服务端暂时未返回新字段的情况，App 可以使用以下安全默认值：

```text
video_duration   = 5
video_resolution = 720p
```

如果 `preset` 不是 `image_to_video`，不要读取或展示这两个字段。

## 3. Swift 定义

推荐使用与服务端值一致的 Codable 类型：

```swift
enum VideoDuration: Int, Codable, CaseIterable {
    case fiveSeconds = 5
    case tenSeconds = 10
    case fifteenSeconds = 15
}

enum VideoResolution: String, Codable, CaseIterable {
    case p720 = "720p"
    case p1080 = "1080p"
}

struct ImageToVideoConfig: Codable {
    let schemaVersion: Int?
    let preset: String
    let type: Int
    let imageCount: Int
    let videoDuration: VideoDuration
    let videoResolution: VideoResolution
    let price: Int?
    let prompt: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case preset
        case type
        case imageCount = "image_count"
        case videoDuration = "video_duration"
        case videoResolution = "video_resolution"
        case price
        case prompt
    }
}
```

如果需要兼容缺少新字段的旧素材，建议将两个字段声明为可选，然后在业务层补默认值：

```swift
let duration = config.videoDuration ?? .fiveSeconds
let resolution = config.videoResolution ?? .p720
```

## 4. 媒体字段映射

图生视频素材需要以下媒体：

| 媒体角色 | App 字段 | 用途 |
| --- | --- | --- |
| 封面图 | `thumbnail_file_id` | 素材列表和详情页封面；当前可以是静态图 |
| 视频结果 | `original_file_id` | 已生成的视频文件 |
| 视频预览 | `video_preview_file_id` | 列表或详情页快速预览，可为图片或视频 |

推荐渲染逻辑：

```swift
if config.preset == "image_to_video" {
    let coverURL = thumbnailURL
    let videoURL = originalURL
    let previewURL = previewURL ?? coverURL

    // 使用 coverURL 展示静态封面；有视频时使用 videoURL 播放。
}
```

当前素材生成流程只能先提供静态封面时，App 不应把封面当作视频播放；应显示静态封面，等 `original_file_id` 有视频资源后再启用播放。

## 5. 参数选择 UI

参数选择器可以直接由枚举生成：

```swift
let durationOptions = VideoDuration.allCases
let resolutionOptions = VideoResolution.allCases
```

建议展示文案：

```text
5 秒 / 10 秒 / 15 秒
720p / 1080p
```

提交给生成接口时，使用 Codable 的原始值：

```swift
config.videoDuration.rawValue       // 5 / 10 / 15
config.videoResolution.rawValue     // "720p" / "1080p"
```

## 6. 校验规则

App 端至少应执行以下校验：

```text
preset == image_to_video
video_duration ∈ {5, 10, 15}
video_resolution ∈ {720p, 1080p}
image_count ∈ {1, 2}
type ∈ {1, 2}
```

服务端仍会进行最终校验。遇到未知的 `video_duration` 或 `video_resolution`，建议降级到 `5 秒 / 720p`，不要让整个素材目录解析失败。

## 7. 与图生图的区别

图生图素材不需要读取图生视频参数：

```json
{
  "preset": "image_to_image",
  "type": 2,
  "image_count": 1,
  "price": 10,
  "prompt": "..."
}
```

App 不应因为图生图 Config 没有 `video_duration` 或 `video_resolution` 而报错。

