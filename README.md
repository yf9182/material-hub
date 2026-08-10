# Material Hub

面向 App 的自有素材管理平台，提供两级分类、素材发布、自有 OSS/R2 文件存储、参考 API/JSON 导入、API Key 鉴权和兼容读取接口。

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

后台入口为 `/admin`。生产环境需要配置 `ADMIN_EMAILS`、`REFERENCE_API_USERNAME`、`REFERENCE_API_PASSWORD` 和 `REFERENCE_API_BASE_URL`。远程导入还需要公开配置 `OSS_REGION`、`OSS_ENDPOINT`、`OSS_BUCKET`，以及仅保存在托管运行时中的 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`；使用 STS 时可额外配置 `OSS_SESSION_TOKEN`。图生图模板扣费需要配置 `BENEFIT_CENTER_BASE_URL`、`BENEFIT_CENTER_BUNDLE_ID`，并将 `BENEFIT_CENTER_INTERNAL_API_KEY` 作为托管密钥保存。不要把任何 AccessKey 或内部 API Key 写入仓库或浏览器代码。

选中有效二级分类后，素材库会显示“按 ID 导入”。管理员可输入参考素材 ID 预检并确认；素材字段会幂等更新，媒体统一流式复制到自有阿里云 OSS，成功后保持草稿。手动上传的本地文件继续写入 R2。

## App API

- `GET /api/v1/product-material-category/ids/tree-list`
- `GET /api/v1/product-material/category-group/list`
- `GET /api/v1/product-material/category-group/{categoryId}`
- `POST /api/v1/image-generation/charges`

请求通过 `X-API-Key` 鉴权，Key 可在后台创建和吊销。图生图扣费接口还接收 `X-Benefit-Center-Token`，价格始终从 Material Hub 的素材记录读取。
