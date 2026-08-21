# Material Hub

面向 App 的自有素材管理平台，提供两级分类、素材发布、自有 OSS/R2 文件存储、参考 API/JSON 导入、API Key 鉴权和兼容读取接口。

App 接入请先阅读：[App 接入指南](docs/app-integration-guide.md)。

## OpenSpec

当前变更为 `build-material-management-platform`。开始工作前执行：

```bash
openspec status --change build-material-management-platform
openspec instructions apply --change build-material-management-platform
```

## 本地运行

```bash
npm install
npm run dev
```

后台入口为 `/admin`。生产环境需要配置 `ADMIN_EMAILS`、`REFERENCE_API_USERNAME`、`REFERENCE_API_PASSWORD` 和 `REFERENCE_API_BASE_URL`。远程导入还需要公开配置 `OSS_REGION`、`OSS_ENDPOINT`、`OSS_BUCKET`，以及仅保存在托管运行时中的 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`；使用 STS 时可额外配置 `OSS_SESSION_TOKEN`。不要把任何 AccessKey 写入仓库或浏览器代码。

选中有效二级分类后，素材库会显示“按 ID 导入”。管理员可输入参考素材 ID 预检并确认；素材字段会幂等更新，媒体统一流式复制到自有阿里云 OSS，成功后保持草稿。手动上传的本地文件继续写入 R2。

## App API

- `GET /api/v1/product-material-category/ids/tree-list`
- `GET /api/v1/product-material/category-group/list`
- `GET /api/v1/product-material/category-group/{categoryId}`

请求通过 `X-API-Key` 鉴权，Key 可在后台创建和吊销。

## Trending 图生图 MCP

项目内置一个 stdio MCP 和仓库 skill，用于“公开趋势调研 → ImageGen 封面 → 草稿 → 预览 → 明确确认后发布”。MCP 只负责目录写入、媒体校验、去重、revision 和审计；Codex 负责趋势证据、安全判断、Prompt 和封面生成。

给下一次 AI 直接阅读的完整操作手册见：[docs/trending-template-mcp-usage.md](docs/trending-template-mcp-usage.md)。默认优先制作真实前后对比封面（`type: 1`）；只有无法保证同一主体和构图时才使用单效果封面（`type: 2`）。

首次使用前，在仓库外创建本机 MCP Token 文件（不要写进仓库、README 或 skill）：

```bash
export MATERIAL_HUB_BASE_URL="https://material-hub-nano-banana.yangf999212.workers.dev"
export MATERIAL_HUB_MCP_MEDIA_ROOT="$PWD/.mcp-artifacts/trending"
mkdir -p "$MATERIAL_HUB_MCP_MEDIA_ROOT"
export MATERIAL_HUB_MCP_TOKEN_FILE="${MATERIAL_HUB_MCP_TOKEN_FILE:-$HOME/.config/material-hub/mcp-token}"
install -d -m 700 "$(dirname "$MATERIAL_HUB_MCP_TOKEN_FILE")"
umask 077
TOKEN_CREATED=0
if [ ! -s "$MATERIAL_HUB_MCP_TOKEN_FILE" ]; then openssl rand -hex 32 > "$MATERIAL_HUB_MCP_TOKEN_FILE"; TOKEN_CREATED=1; fi
chmod 600 "$MATERIAL_HUB_MCP_TOKEN_FILE"
export MATERIAL_HUB_MCP_TOKEN="$(tr -d '\r\n' < "$MATERIAL_HUB_MCP_TOKEN_FILE")"
```

将同一个 token 的 SHA-256 哈希配置为 Cloudflare Worker secret。下面的命令不会把原 token 写入仓库：

```bash
printf %s "$MATERIAL_HUB_MCP_TOKEN" | shasum -a 256
if [ "$TOKEN_CREATED" = 1 ]; then npx wrangler secret put MATERIAL_HUB_MCP_TOKEN_HASH; fi
npx wrangler secret put MATERIAL_HUB_MCP_ACTOR
npx vinext deploy
```

部署前需要先完成 `wrangler login` 或设置 `CLOUDFLARE_API_TOKEN`；没有凭据时只运行本地构建和 MCP 协议测试，不会写入生产环境。

本地开发可直接运行 `node --import tsx mcp/trending-template-server.ts`（或 `npm run --silent mcp`，避免 npm 日志污染 stdio）；项目 `.codex/config.toml` 会通过 `env_vars` 转发上述变量。启动后可在 Codex 的 `/mcp` 中检查五个工具：`inspect_trending_context`、`ensure_trending_category`、`stage_trending_template`、`preview_trending_templates` 和 `publish_trending_templates`。后者要求参数 `confirmation: "CONFIRM_PUBLISH"`，且只能发布用户明确确认、revision 未变化的 1–3 个草稿。

### AI 优先的目录 MCP

项目 MCP 同时提供通用的 AI 素材管理工具，不需要管理员页面参与日常操作：

- `list_products`：读取线上所有产品和 PID；
- `inspect_catalog`、`get_material`：按 PID 查看分类、素材、状态、配置和媒体；
- `create_category`、`create_material`、`update_material`：创建或维护分类与素材草稿；
- `set_material_status`：将素材设为草稿、已发布或已归档；
- `delete_materials`：删除素材，必须传 `confirmation: "CONFIRM_DELETE"`。

推荐让 AI 先调用 `list_products`，再用 `inspect_catalog(product: "目标 PID")` 获取上下文。MCP 使用项目外的 `MATERIAL_HUB_MCP_TOKEN`，所有写操作都会记录审计事件；标准素材的图片、视频可直接由 MCP 从本地媒体目录或 HTTPS URL 校验并上传。

标准素材创建优先使用 `create_standard_material`。它要求 `product`、`preset`、`prompt`、`categoryIds` 和媒体；`preset` 支持 `image_to_image`、`image_to_video`。媒体可以是 `MATERIAL_HUB_MCP_MEDIA_ROOT` 下的本地路径或 HTTPS URL。图生图需要 `original`、`thumbnail`，图生视频还需要 `preview`。创建结果始终是草稿；调用 `publish_standard_material` 前必须先通过 `inspect_material_standard`，并传入 `CONFIRM_PUBLISH`。

标准 config 的核心字段是 `schema_version`、`preset`、`type`、`image_count`、`price`、`prompt`、可选的 `file_url` 和 `extensions`。不同 App 的差异放在 `extensions.<app_name>` 中，不能覆盖核心字段。`validate_material_config` 可以在写入前返回标准化结果和警告。

`type` 只描述封面展示形式：`1` 为真实前后图对比，`2` 为单效果图；`image_count` 独立描述用户需要上传的参考图数量。MCP 会把封面统一处理为 1000×1200 JPEG，Trending 下按最新发布优先。生产 token 只保存哈希，不复用后台 Cookie，也不对 localhost 绕过鉴权。
