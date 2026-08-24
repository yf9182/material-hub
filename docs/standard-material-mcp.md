# 标准素材 MCP 协议

## 目标

素材由 AI 按产品 PID 创建，所有 App 共用一套核心配置和媒体角色。旧素材继续兼容，不要求一次性迁移。

## 预设

| preset | 必需媒体 | 默认 type | 默认 image_count | 默认 price |
| --- | --- | --- | --- | --- |
| `image_to_image` | `original`、`thumbnail` | `2` | `1` | `10` |
| `image_to_video` | `original`、`thumbnail`、`preview` | `2` | `1` | `20` |

`type=1` 表示前后图对比，`type=2` 表示单效果图。`image_count` 表示用户需要上传的参考图数量，两者含义不能混用。

## Config 标准

```json
{
  "schema_version": 1,
  "preset": "image_to_image",
  "type": 2,
  "image_count": 1,
  "price": 10,
  "prompt": "Use the uploaded image as the primary reference...",
  "extensions": {
    "nano_banana": {
      "business_mode": "portrait"
    }
  }
}
```

`prompt` 必须存在且不超过 8000 个字符。系统会自动补充图像参考策略，并在必要时补充长 Prompt 完整性策略。`material.price` 和 `config.price` 始终保持一致。`file_url` 只用于确实需要外部结果文件 URL 的场景，并且必须是 HTTPS。

`preset=image_to_video` 时必须包含 `video_duration`（`5`、`10` 或 `15` 秒）和 `video_resolution`（`720p` 或 `1080p`）。缺省值分别为 `5` 和 `720p`。

## MCP 调用顺序

1. 调用 `list_products`，确认目标 PID。
2. 调用 `inspect_catalog(product: "PID")`，选择目标二级分类。
3. 调用 `validate_material_config` 预检 config。
4. 调用 `create_standard_material` 创建草稿并上传必需媒体。
5. 调用 `inspect_material_standard` 检查标准、媒体和价格。
6. 用户明确确认后，调用 `publish_standard_material`，传 `confirmation: "CONFIRM_PUBLISH"`。

媒体路径必须位于 `MATERIAL_HUB_MCP_MEDIA_ROOT` 内；远程媒体必须是 HTTPS。MCP 客户端会在发送前读取和校验媒体，Worker 会再次校验文件类型、大小、PID 分类归属和必需媒体角色。

## 更新与兼容

`update_standard_material` 可以只更新配置，也可以替换部分媒体；更新完成后素材必须仍然具备该预设要求的全部媒体。`inspect_material_standard` 会标记缺失标准字段的 legacy 素材，建议通过更新工具逐步标准化。App 仍读取原有 `material_config` 结构，新增 `schema_version` 和 `extensions` 可被旧 App 忽略。
