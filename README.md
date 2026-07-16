# Material Hub

面向 App 的自有素材管理平台，提供两级分类、素材发布、R2 文件存储、参考 API/JSON 导入、API Key 鉴权和兼容读取接口。

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

后台入口为 `/admin`。生产环境需要配置 `ADMIN_EMAILS`、`REFERENCE_API_USERNAME`、`REFERENCE_API_PASSWORD` 和 `REFERENCE_API_BASE_URL`。

## App API

- `GET /api/v1/product-material-category/ids/tree-list`
- `GET /api/v1/product-material/category-group/list`
- `GET /api/v1/product-material/category-group/{categoryId}`

请求通过 `X-API-Key` 鉴权，Key 可在后台创建和吊销。
