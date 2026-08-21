# Trending 图生图模板 MCP 使用手册

这份文档给下一次 AI 使用。目标是：研究近期开源趋势，生成安全的双语图生图模板，制作封面，先预览，再在用户明确确认后发布到生产 Material Hub。

## 1. 先读规则

- 产品固定为 PID `8801`；图生图根分类必须是 `VikPea_APP_Nano_Banana`。
- Trending 子分类由 MCP 幂等创建，名称/Code 为 `Trending`，翻译为 `en: Trending`、`zh-cn: 热门`。
- 一次最多选择 3 个候选。
- 趋势证据必须来自近 30 天的公开 HTTPS 页面，近 7 天信号优先；每个候选至少 2 个独立平台。
- 不绕过登录、付费墙、反爬，也不复制来源图片。
- 不使用真实名人身份、受保护角色/Logo、或点名模仿在世艺术家。
- 发布是高风险写操作。只有用户明确确认具体模板 ID 和 revision 后，才能调用发布工具。

## 2. type 与 image_count

`material_config.type` 只描述封面展示形式，不能代表输入图数量：

| 字段 | 值 | 含义 |
|---|---:|---|
| `displayType` / `type` | `1` | 前后图对比：前图是真实输入参考，后图是同一主体/构图经过模板后的结果 |
| `displayType` / `type` | `2` | 单效果图：只展示一个完整结果，MCP 同时写入 `thumbnail` 与 `original` |
| `imageCount` / `image_count` | `1` | 用户上传 1 张参考图 |
| `imageCount` / `image_count` | `2` | 用户上传 2 张参考图 |

默认优先 `type: 1`。生成流程必须是：

1. 先生成一张安全、原创的“前图”。
2. 使用同一张前图和同一主体/构图生成效果图。
3. 两张图都处理成 `1000×1200` JPEG 后再 staging。

如果无法保证前后图来自同一主体、同一构图或同一内容关系，使用 `type: 2`，并在 `coverReason` 说明原因。不能用无关图片拼凑对比图。

此前首批三个已发布模板使用 `type: 2`，因为当时生成的是完整结果封面，没有对应的同源前图。后续若要改成对比图，应重新生成成对封面并先创建新 revision、预览、再获得明确确认；不要直接拿现有单图冒充前图。本次第二批已经按同一主体/构图生成了真实 `type: 1` 前后图。

## 3. MCP 工具顺序

先确认项目 MCP 已出现在 Codex 的 MCP 工具列表中。工具顺序固定为：

1. `inspect_trending_context({})`
2. `ensure_trending_category({})`
3. 调研并选出最多 3 个候选
4. `stage_trending_template(...)`，每个候选调用一次
5. `preview_trending_templates({ ids: [...] })`
6. 展示封面、趋势证据、type、image_count、价格、Prompt 摘要、选择理由和 revision
7. 等用户明确确认具体模板
8. `publish_trending_templates({ confirmation: "CONFIRM_PUBLISH", items: [...] })`
9. 发布后再次 `inspect_trending_context`，确认状态、排序、图片和价格

## 4. 每个候选需要准备的内容

- 稳定的 `trendKey`：小写字母/数字/连字符，例如 `paper-doll-portrait`。
- 英文标题 `name` 和简中标题 `nameZh`。
- 概念 `concept`。
- 英文 Prompt：必须明确使用上传图片作为主要参考，并保留主体身份和关键视觉特征。
- `displayType: 1 | 2`。
- `imageCount: 1 | 2`。
- `price: 10 | 20`：简单单图输入通常为 10；双图输入或明显复杂合成通常为 20。
- 至少两条独立平台的 HTTPS 趋势证据：`platform`、`url`、`observedAt`、`signal`。
- `safetyReview`：`passed: true`、`policy: "safe-adaptation"` 和说明。
- `selectionReason`：为什么选它进入前三。
- `coverReason`：为什么选 type 1 或 type 2。
- 封面路径：type 1 需要 `beforeCoverPath` + `afterCoverPath`；type 2 需要 `coverPath`。

## 5. 封面和媒体要求

- 所有图片必须位于 `MATERIAL_HUB_MCP_MEDIA_ROOT` 内。
- MCP 拒绝路径越界、非真实图片、伪造 MIME、超过 10 MB 或最小边小于 512 px 的文件。
- MCP 会统一转换为 `1000×1200`、`image/jpeg`。
- type 1 前后图尺寸必须一致、内容关系一致，且不能是同一个文件。
- type 2 的主图和缩略图由同一张效果图生成。
- 封面使用 Codex ImageGen 生成，必须说明它和生产 App 的 Gemini 2.5 Flash Image 实际结果可能不同。

## 6. staging 示例

```json
{
  "trendKey": "paper-doll-portrait",
  "concept": "Editorial paper-doll portrait",
  "name": "Paper Doll Portrait",
  "nameZh": "纸片人像",
  "prompt": "Use the uploaded image as the primary reference. Preserve the subject's identity and key visual features. Transform ...",
  "displayType": 1,
  "imageCount": 1,
  "price": 10,
  "evidence": [
    {
      "platform": "Example A",
      "url": "https://example.com/trend-a",
      "observedAt": "2026-08-10T00:00:00.000Z",
      "signal": "公开页面近期持续出现该格式。"
    },
    {
      "platform": "Example B",
      "url": "https://example.org/trend-b",
      "observedAt": "2026-08-10T00:00:00.000Z",
      "signal": "独立平台也出现同类模板或公开热度信号。"
    }
  ],
  "safetyReview": {
    "passed": true,
    "policy": "safe-adaptation",
    "notes": "仅使用用户本人或已获授权的图片，不使用真实名人、受保护角色或品牌。"
  },
  "selectionReason": "跨平台且适合图生图。",
  "coverReason": "前后图来自同一参考图和同一构图，因此使用真实对比展示。",
  "beforeCoverPath": ".mcp-artifacts/trending/paper-doll-before.png",
  "afterCoverPath": ".mcp-artifacts/trending/paper-doll-after.png"
}
```

## 7. 发布确认格式

预览后不要因为用户说“不错”“可以”就发布。应要求明确确认，例如：

> 发布 Trending 模板 `id-a`、`id-b`，revision 保持不变。

然后才调用：

```json
{
  "confirmation": "CONFIRM_PUBLISH",
  "items": [
    { "id": "id-a", "revision": "64 位十六进制 revision" },
    { "id": "id-b", "revision": "64 位十六进制 revision" }
  ]
}
```

发布是全有或全无的批处理；任何一个模板校验失败都不应发布其他模板。预览后标题、Prompt、证据、价格或媒体发生变化，都必须重新预览并重新确认。

## 8. Token 与启动

`MATERIAL_HUB_MCP_TOKEN` 是项目内部 Bearer secret，不是后台用户名密码，也不要把明文 token 写入 README、skill、Git、聊天或 `source_snapshot`。Worker 只保存 `MATERIAL_HUB_MCP_TOKEN_HASH` 的 SHA-256 哈希。为方便本机 Codex 自动使用，stdio MCP 会优先读取环境变量；未设置时读取仓库外的 `~/.config/material-hub/mcp-token`（文件权限必须是 `600`）。

```bash
export MATERIAL_HUB_BASE_URL="https://material-hub-nano-banana.yangf999212.workers.dev"
export MATERIAL_HUB_MCP_MEDIA_ROOT="$PWD/.mcp-artifacts/trending"
mkdir -p "$MATERIAL_HUB_MCP_MEDIA_ROOT"

# 仅首次配置：Token 保存在仓库外，不进入 Git 或模型上下文；已有文件不要覆盖。
TOKEN_FILE="${MATERIAL_HUB_MCP_TOKEN_FILE:-$HOME/.config/material-hub/mcp-token}"
install -d -m 700 "$(dirname "$TOKEN_FILE")"
umask 077
TOKEN_CREATED=0
if [ ! -s "$TOKEN_FILE" ]; then openssl rand -hex 32 > "$TOKEN_FILE"; TOKEN_CREATED=1; fi
chmod 600 "$TOKEN_FILE"
export MATERIAL_HUB_MCP_TOKEN_FILE="$TOKEN_FILE"
export MATERIAL_HUB_MCP_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"

# 仅在首次配置或轮换 Token 时执行；日常启动不要重复 secret put。
if [ "$TOKEN_CREATED" = 1 ]; then
  printf %s "$MATERIAL_HUB_MCP_TOKEN" | shasum -a 256
  npx wrangler secret put MATERIAL_HUB_MCP_TOKEN_HASH
fi

# 轮换时先安全地移走旧文件，再重新执行上面的初始化块。
# mv "$TOKEN_FILE" "$TOKEN_FILE.previous"
```

项目 `.codex/config.toml` 会把本地变量转发给 stdio MCP；服务器默认使用上述 Token 文件和生产 Base URL。轮换时覆盖 Token 文件并重新执行 `secret put`，不要把 Token 内容复制进文档。没有 MCP 连接或没有生产鉴权时，不要改用后台 Cookie 绕过；应报告阻塞原因。

## 9. 当前已发布模板记录

生产当前共有六个 `mcp-trending` 模板，Trending 下按最新发布优先：

- 首批：
  - `pocket-collectible`（`f9e9aeeb4fc31bc9b433f836`）：Pocket Collectible / 口袋收藏玩偶，type 2，image_count 1，price 10。
  - `instant-memory`（`237b2828728d9aff3e1b8bf4`）：Instant Memory Portrait / 复古拍立得记忆照，type 2，image_count 2，price 20。
  - `time-capsule`（`e8c50089e2473ec4604593a8`）：Time Capsule Portrait / 时光胶片肖像，type 2，image_count 2，price 20。
- 第二批（2026-08-10）：
  - `neon-rain-portrait`（`1a8ed6e667d7cded37f7de0e`）：Rainy Neon Portrait / 雨夜霓虹肖像，type 1，image_count 1，price 10。
  - `childhood-now-memory`（`f52ee6508147c69239e16381`）：Childhood vs Now Memory / 童年与现在记忆照，type 1，image_count 2，price 20。
  - `disposable-film-memory`（`a3cf93bb0e8c3de8bc7b499a`）：Disposable Film Memory / 复古胶片记忆，type 1，image_count 1，price 10。

## 10. 下一次直接执行

当用户说“再生成一批”时，AI 必须：

1. 先读取本手册并调用 `inspect_trending_context`，排除上面已发布的 `trendKey`。
2. 调研最近 30 天公开趋势，选出最多 3 个新的安全候选。
3. 默认生成真实 `type: 1` 前后图；只有无法保证同源前后关系时才用 `type: 2`。
4. 逐个 staging，统一 preview，并展示封面、证据、Prompt 摘要、价格、`image_count`、`type` 和 revision。
5. 等用户明确点名模板后再发布；“看起来不错”不等于发布确认。

当用户明确说“发布这批”时，AI 仍需先重新 preview，确认状态为 draft 且 revision 未变化，再调用 `publish_trending_templates`。发布成功后必须再次 inspect，确认 `status: published` 和 `publishStatus: 1`。

下一次必须先调用 `inspect_trending_context`，不要只依赖这份静态记录；MCP 会根据 `source_key`、`trendKey`、标题和 Prompt 做去重与冲突提示。

## 11. 已优化的批量生成工作流

以后“再生成一批”按下面的固定流水线执行，避免出现同一人物、同一证件照姿势或只换滤镜的伪差异：

1. 先做候选规划表：每个候选写清楚 `trendKey`、风格、人物设定、生活场景、动作/姿势、`beforePrompt`、最终模板 Prompt。人物、姿势、场景至少有两项明显不同。
2. 逐个执行 ImageGen：先使用该候选独有的 `beforePrompt` 生成 before；再把这张 before 作为唯一主要参考，使用该候选最终 Prompt 生成 after。不得从无关图片拼 type 1 对比。
3. 逐个做资产检查：确认 before/after 是同一主体与构图关系、姿势不是证件照、前后图尺寸一致但文件哈希不同；统一转成 1000×1200 JPEG，保存在 `MATERIAL_HUB_MCP_MEDIA_ROOT`。
4. staging 时把 `beforePrompt` 一起写入模板元数据。type 1 未提供独立 `beforePrompt` 会被拒绝；它与最终模板 Prompt 相同也会被拒绝。
5. 全部候选 staging 完后只做一次批量 preview。逐张检查图片、Prompt 摘要、证据、安全说明、type、image_count、价格和 revision；任何一张不合格就只重做该候选并重新 preview。
6. 只有用户明确点名 ID 和 revision 才发布。发布前必须重新 preview；任何字段或媒体变化都会使旧 revision 失效。

`beforePrompt` 是生成记录，不是用户最终使用的模板 Prompt。这样既能保证每个 before 真正来自不同提示词，也能在后续复盘时知道 after 是否确实由对应模板处理而来。
