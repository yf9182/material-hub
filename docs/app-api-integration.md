# Material Hub · App 接入文档

本文档描述 App 读取 Material Hub 素材目录的正式接口。App 只需要调用只读接口；素材、分类、发布状态均由后台管理。

## 数据范围：仅 Nano Banana

当前 App **只需要获取并展示 Nano Banana 的数据**：

- 先从分类树中定位一级分类：`name = "Nano Banana"` 或 `code = "Nano_Banana"`。
- 只使用该一级分类 `children` 中的二级分类 ID 请求素材列表。
- 不需要请求、缓存或展示其他一级分类及其素材；即使未来分类树中出现其他分类，也应忽略。

分类 ID 由后台数据生成，App 不要把具体 ID 写死；每次启动或分类缓存失效后，先读取分类树再取得 Nano Banana 的二级分类 ID。

## 1. 接入信息

| 项目 | 说明 |
| --- | --- |
| 当前 App Base URL（局域网） | `http://192.168.1.25:3000` |
| 认证方式 | 请求头 `X-API-Key: mat_...` |
| 数据格式 | `application/json; charset=utf-8` |
| 产品上下文 | 当前产品为 `pid=8801`、`channel=English`、`source=English` |

API Key 由后台的「API Key」页面创建。密钥只在创建时展示一次；不要写入 App 包、代码仓库或日志。建议由自己的业务服务签发短期访问凭据，或使用安全存储保存可撤销的 Key。

当前没有生产环境时，App 请将 Base URL 配置为 `http://192.168.1.25:3000`。手机和电脑必须连接同一个 Wi-Fi；不要使用 `localhost`，因为它在手机上指向手机自身。此 IP 可能在切换网络或重新联网后改变，届时请在电脑上重新获取局域网 IP，并更新 App 配置。开发服务器已配置为监听局域网。

这是开发期 HTTP 地址。iOS App 如启用了 App Transport Security、Android App 如禁用了明文流量，需要仅为开发环境允许访问 `192.168.1.25` 的 HTTP；正式环境应改用 HTTPS。电脑上的开发服务器必须保持运行，App 才能请求到素材接口。

所有目录接口都使用 `GET`，并且只会返回启用分类下、处于已发布状态的素材。

## 2. 通用请求与响应

每个目录请求必须携带 `pid` 和 `X-API-Key`。`channel`、`source` 可省略；填写时必须与该产品一致。

```http
GET /api/v1/... ?pid=8801&channel=English&source=English&page=1&page_size=100
X-API-Key: mat_your_api_key
```

成功响应统一为：

```json
{
  "code": 1,
  "data": {},
  "msg": "OK"
}
```

失败响应统一为：

```json
{
  "code": 0,
  "data": { "error": "INVALID_API_KEY" },
  "msg": "API Key 无效"
}
```

分页规则：`page` 从 `1` 开始，默认 `1`；`page_size` 默认 `100`，取值范围为 `1–100`。

## 3. 推荐调用流程

```text
1. 拉取分类树
2. 定位 `name = Nano Banana` 或 `code = Nano_Banana` 的一级分类
3. 只展示该分类的 children（二级分类）
4. 拉取对应分类的素材分组
5. 按 material_config.type 选择卡片和详情页展示方式
6. 使用返回的 cdn_url 加载封面、原图或预览文件
```

`category-group` 接口仅接受二级分类 ID；一级分类只用于导航分组。当前只传入 Nano Banana 的二级分类 ID。

## 4. 获取分类树

`GET /api/v1/product-material-category/ids/tree-list`

### 查询参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `pid` | 是 | 产品 ID，例如 `8801` |
| `channel` | 否 | 产品渠道；当前为 `English` |
| `source` | 否 | 产品来源；当前为 `English` |
| `page` | 否 | 一级分类页码 |
| `page_size` | 否 | 每页一级分类数，最大 `100` |

### cURL

```bash
curl --get 'http://192.168.1.25:3000/api/v1/product-material-category/ids/tree-list' \
  --data-urlencode 'pid=8801' \
  --data-urlencode 'channel=English' \
  --data-urlencode 'source=English' \
  --data-urlencode 'page=1' \
  --data-urlencode 'page_size=100' \
  -H 'X-API-Key: mat_your_api_key'
```

### 响应示例

```json
{
  "code": 1,
  "data": {
    "list": [
      {
        "id": "root-category-id",
        "parent_id": "",
        "name": "Nano Banana",
        "code": "Nano_Banana",
        "config": "",
        "translation": {
          "id": "root-category-idt1",
          "lang": {
            "en": { "code": "en", "content": "Nano Banana", "is_default": 1 }
          }
        },
        "marks": [],
        "children": [
          {
            "id": "child-category-id",
            "parent_id": "root-category-id",
            "name": "Festival",
            "code": "Festival",
            "config": "",
            "translation": { "id": "child-category-idt1", "lang": {} },
            "marks": [],
            "children": [],
            "create_time": 1783308152,
            "update_time": 1783308746,
            "material_latest_update_time": 0
          }
        ],
        "create_time": 1783308152,
        "update_time": 1783308746,
        "material_latest_update_time": 0
      }
    ],
    "pager": { "page": 1, "page_size": 100, "total": 1 }
  },
  "msg": "OK"
}
```

分类节点中的时间字段均为 Unix 秒级时间戳。多语言内容位于 `translation.lang[语言代码].content`。App 读取 `list` 后，只保留 `name` 为 `Nano Banana` 或 `code` 为 `Nano_Banana` 的节点。

## 5. 批量获取二级分类素材

`GET /api/v1/product-material/category-group/list`

### 查询参数

除通用参数外：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `product_material_category_ids` | 是 | 一个或多个**二级分类** ID，以英文逗号分隔 |

### 请求示例

```http
GET /api/v1/product-material/category-group/list?pid=8801&channel=English&source=English&product_material_category_ids=child-category-id&page=1&page_size=30
X-API-Key: mat_your_api_key
```

### 响应结构

```json
{
  "code": 1,
  "data": {
    "group": [
      {
        "pager": { "page": 1, "page_size": 30, "total": 1 },
        "product_material_category_id": "child-category-id",
        "list": ["MaterialItem"]
      }
    ]
  },
  "msg": "OK"
}
```

一个分类对应一个 `group`。当分类不存在、未启用、不是二级分类，或其中没有已发布素材时，它不会出现在 `group` 中；App 应按分类 ID 查找，而不要假设数组顺序或长度。

## 6. 获取单个二级分类素材

`GET /api/v1/product-material/category-group/{categoryId}`

路径参数 `categoryId` 为二级分类 ID。查询参数与批量接口相同（不需要 `product_material_category_ids`）。

```http
GET /api/v1/product-material/category-group/child-category-id?pid=8801&channel=English&source=English&page=1&page_size=30
X-API-Key: mat_your_api_key
```

成功时 `data` 直接是一个 Group 对象，而不是 `{ "group": [] }`：

```json
{
  "code": 1,
  "data": {
    "pager": { "page": 1, "page_size": 30, "total": 1 },
    "product_material_category_id": "child-category-id",
    "list": ["MaterialItem"]
  },
  "msg": "OK"
}
```

## 7. MaterialItem 字段说明

素材列表和单分类接口都返回下列结构。素材 ID 使用 `material_id`；外层 `id` 是该素材与当前分类的关联 ID。

```json
{
  "id": "relation-id",
  "material_id": "material-id",
  "public_properties": {
    "material_config": {
      "code": "material_config",
      "value": ["{\"type\":2}"],
      "data": {}
    },
    "original_file_id": {
      "code": "original_file_id",
      "value": ["asset-id"],
      "data": {
        "id": "asset-id",
        "cdn_url": "/api/assets/asset-id",
        "name": "original.jpg",
        "size": 123456,
        "hash": ""
      }
    }
  },
  "independent_properties": {
    "material_internal_name": { "code": "material_internal_name", "value": ["Cartoon Family"], "data": {} },
    "material_lang": {
      "code": "material_lang",
      "value": ["translation-id"],
      "data": { "id": "translation-id", "lang": { "en": { "code": "en", "content": "Cartoon Family", "is_default": 1 } } }
    },
    "thumbnail_file_id": { "code": "thumbnail_file_id", "value": ["asset-id"], "data": { "cdn_url": "/api/assets/asset-id" } },
    "video_preview_file_id": { "code": "video_preview_file_id", "value": [], "data": {} },
    "min_version": { "code": "min_version", "value": ["2.4.0"], "data": {} }
  },
  "user_behaviors": [],
  "listing_status": 1,
  "publish_status": 1,
  "create_time": 1783308152,
  "update_time": 1783308746
}
```

### 7.1 属性包装器

每个属性都使用相同的包装器：

| 字段 | 含义 |
| --- | --- |
| `code` | 属性名 |
| `value` | 值数组；通常读取第一个元素 `value[0]` |
| `data` | 结构化扩展数据；文件、翻译等信息位于此处 |

属性可能为空：`value` 会是 `[]`，`data` 会是 `{}`。客户端必须将它们视为可选值。

### 7.2 建议读取字段

| 用途 | 路径 | 说明 |
| --- | --- | --- |
| 展示名称 | `independent_properties.material_lang.data.lang[locale].content` | 建议先取当前语言，再回退 `en`、`zh-cn`、`material_internal_name.value[0]` |
| 内部名称 | `independent_properties.material_internal_name.value[0]` | 无翻译时的稳定回退值 |
| 素材配置 | `public_properties.material_config.value[0]` | JSON 字符串；解析失败时应回退 `{}` |
| 封面 | `independent_properties.thumbnail_file_id.data.cdn_url` | 优先用于卡片展示 |
| 原图/结果图 | `public_properties.original_file_id.data.cdn_url` | 详情页或前后图的后图 |
| 视频预览 | `independent_properties.video_preview_file_id.data.cdn_url` | 适用于视频/其他类型 |
| 最低 App 版本 | `independent_properties.min_version.value[0]` | 为空时不限制 |

### 7.3 三种显示方式（必须按 `type` 判断）

先解析 `public_properties.material_config.value[0]` 中的 JSON，并读取 `type`。**不要根据某个文件字段是否存在来猜测显示方式**；`type` 是唯一的展示判断依据。

```ts
const config = JSON.parse(item.public_properties.material_config.value?.[0] ?? "{}");
const displayMode = config.type === 1 ? "comparison" : config.type === 2 ? "singleImage" : "video";
```

#### 方式一：前后图对比（`type = 1`）

适用于效果前后对比。卡片和详情页使用可拖动的对比组件，或以左右分栏展示。

| 画面 | 读取字段 | 回退规则 |
| --- | --- | --- |
| 前图 | `independent_properties.thumbnail_file_id.data.cdn_url` | 缺失时使用后图；两者都缺失则显示占位图 |
| 后图 | `public_properties.file_url.data.cdn_url` | 缺失时使用 `public_properties.original_file_id.data.cdn_url` |

`file_url` 可能是外部绝对 URL；`original_file_id` 通常是站内相对 URL。两者都要通过第 8 节的 URL 规则处理。

#### 方式二：单图展示（`type = 2`）

适用于只有一张结果图的素材。卡片与详情页都展示同一张大图，不显示对比滑杆或播放按钮。

| 优先级 | 读取字段 | 用途 |
| --- | --- | --- |
| 1 | `independent_properties.thumbnail_file_id.data.cdn_url` | 卡片封面和详情主图 |
| 2 | `public_properties.original_file_id.data.cdn_url` | 封面缺失时的主图回退 |
| 3 | `independent_properties.video_preview_file_id.data.cdn_url` | 前两项均缺失时的最终回退 |

#### 方式三：视频 / 其他展示（`type = 3` 或任何非 `1`、`2` 的值）

适用于视频、动态预览或未来扩展的其他素材类型。卡片应显示播放标识；详情页优先使用原生视频播放器或 App 内播放器。

| 优先级 | 读取字段 | 用途 |
| --- | --- | --- |
| 1 | `independent_properties.video_preview_file_id.data.cdn_url` | 视频播放地址；存在时作为播放器 `source` |
| 2 | `independent_properties.thumbnail_file_id.data.cdn_url` | 视频封面（poster）或视频地址缺失时的静态回退 |
| 3 | `public_properties.original_file_id.data.cdn_url` | 封面缺失时的静态回退 |

当 `video_preview_file_id` 缺失时，不要显示无法播放的按钮；改为展示可用封面或占位图。对于未来新增的 `type` 值，沿用此方式三的安全回退逻辑。

## 8. 文件访问

文件地址由 `*.data.cdn_url` 返回。`/api/assets/{assetId}` 是公开的只读文件地址，不要求 `X-API-Key`，并会以长期缓存响应。

App 应按以下规则拼接文件 URL：

```ts
function resolveAssetUrl(baseUrl: string, cdnUrl?: string) {
  if (!cdnUrl) return undefined;
  return /^https?:\/\//i.test(cdnUrl) ? cdnUrl : new URL(cdnUrl, baseUrl).toString();
}
```

文件不存在时接口返回 `404 Not found`。客户端应显示占位图或重试，不应让单个媒体加载失败阻断素材列表。

## 9. 错误处理

| HTTP 状态 | `data.error` | App 建议处理 |
| --- | --- | --- |
| `400` | `CATEGORY_IDS_REQUIRED` | 检查批量素材接口是否传入二级分类 ID |
| `400` | `PRODUCT_CONTEXT_MISMATCH` | 统一使用产品配置的 `channel` / `source`，或不要传这两个可选参数 |
| `401` | `INVALID_API_KEY` | 停止请求并刷新/更换 Key；不要无限重试 |
| `404` | `PRODUCT_NOT_FOUND` | 检查 `pid` |
| `404` | `CATEGORY_NOT_FOUND` | 刷新分类树并清理本地已失效分类 |
| `500` | `INTERNAL_ERROR` | 使用指数退避重试，并保留已缓存的内容 |

建议：网络错误和 `5xx` 可重试；`400`、`401`、`404` 应在修正本地参数或凭据后再请求。

## 10. TypeScript 接入示例

```ts
type ApiEnvelope<T> = { code: 1 | 0; data: T; msg: string };

async function materialGet<T>(baseUrl: string, path: string, apiKey: string): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { "X-API-Key": apiKey },
  });
  const body = await response.json() as ApiEnvelope<T & { error?: string }>;
  if (!response.ok || body.code !== 1) {
    throw new Error(body.msg || body.data?.error || "Material API request failed");
  }
  return body.data;
}

const context = new URLSearchParams({
  pid: "8801",
  channel: "English",
  source: "English",
  page: "1",
  page_size: "30",
});

const tree = await materialGet<{ list: Array<{ id: string; name: string; code: string; children: Array<{ id: string }> }> }>(
  "http://192.168.1.25:3000",
  `/api/v1/product-material-category/ids/tree-list?${context}`,
  apiKey,
);

const nanoBanana = tree.list.find(
  (item) => item.name === "Nano Banana" || item.code === "Nano_Banana",
);
const categoryId = nanoBanana?.children[0]?.id;
if (categoryId) {
  context.set("product_material_category_ids", categoryId);
  const result = await materialGet<{ group: Array<{ list: unknown[] }> }>(
    "http://192.168.1.25:3000",
    `/api/v1/product-material/category-group/list?${context}`,
    apiKey,
  );
  const materials = result.group[0]?.list ?? [];
}
```

## 11. 上线前检查

- App 当前 Base URL 使用 `http://192.168.1.25:3000`；切换网络后更新为新的局域网 IP。
- 在后台创建独立的生产 API Key，并通过安全渠道配置到调用方。
- 使用生产 Key 拉取分类树、一个分类的素材和至少一个文件 URL。
- 验证 `type = 1`、`type = 2`、视频/其他三种渲染回退路径。
- 为素材列表、封面和文件响应配置合理缓存与失败占位。
