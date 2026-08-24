# Material Hub App 接入指南

本文档面向需要接入 Material Hub 素材目录的 App。App 只读取已发布素材；分类、素材、媒体和发布状态由 Material Hub 管理。

## 1. 接入信息

生产环境：

```text
https://material-hub-nano-banana.yangf999212.workers.dev
```

每个 App 产品使用独立的 `pid` 和 API Key。当前示例产品：

| pid | 产品 | channel | source |
| --- | --- | --- | --- |
| `8801` | VikPea · English | `English` | `English` |
| `8802` | AI Pet Studio | `English` | `English` |

请求头：

```http
X-API-Key: mat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API Key 只能由后台创建，创建后只展示一次。不要把 Key 写入日志、公开仓库或提交到 App 源码；建议存放在安全配置中。

## 2. 推荐启动流程

```text
1. 配置 pid、channel、source 和 X-API-Key
2. 请求分类树
3. 找到目标一级分类及其二级分类
4. 展示二级分类
5. 请求对应二级分类的素材列表
6. 根据 material_config.type 渲染卡片和详情
7. 使用返回的媒体 URL 加载图片、视频或音频
```

不要把分类 ID 写死。分类 ID 由 Material Hub 生成，App 启动或缓存失效时应重新读取分类树。

## 3. 通用请求规则

所有目录接口都使用 `GET`，必须携带 `pid` 和 `X-API-Key`。

```http
GET /api/v1/product-material-category/ids/tree-list?pid=8802&channel=English&source=English&page=1&page_size=100
X-API-Key: mat_your_api_key
Accept: application/json
```

成功响应：

```json
{
  "code": 1,
  "data": {},
  "msg": "OK"
}
```

失败响应：

```json
{
  "code": 0,
  "data": { "error": "INVALID_API_KEY" },
  "msg": "API Key 无效"
}
```

分页参数：

- `page` 从 `1` 开始，默认 `1`
- `page_size` 默认 `100`，范围 `1–100`
- `channel`、`source` 可选，但填写时必须与产品配置一致

## 4. 获取分类树

接口：

```http
GET /api/v1/product-material-category/ids/tree-list
```

请求示例：

```bash
curl --get 'https://material-hub-nano-banana.yangf999212.workers.dev/api/v1/product-material-category/ids/tree-list' \
  --data-urlencode 'pid=8802' \
  --data-urlencode 'channel=English' \
  --data-urlencode 'source=English' \
  --data-urlencode 'page=1' \
  --data-urlencode 'page_size=100' \
  -H 'X-API-Key: mat_your_api_key'
```

响应中的 `data.list` 是一级分类数组，`children` 是二级分类数组：

```json
{
  "code": 1,
  "data": {
    "list": [
      {
        "id": "root-category-id",
        "parent_id": "",
        "name": "AI Pet Studio",
        "code": "Nano_Banana",
        "children": [
          {
            "id": "child-category-id",
            "parent_id": "root-category-id",
            "name": "测试分类",
            "code": "Test_Category"
          }
        ]
      }
    ]
  }
}
```

App 应根据产品实际返回的一级分类定位业务根分类，并只展示其 `children`。不要依赖分类名称一定是 `Nano Banana`，优先使用 `code`，必要时兼容名称。

## 5. 获取素材列表

接口：

```http
GET /api/v1/product-material/category-group/list
```

请求参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `pid` | 是 | 产品 PID |
| `product_material_category_ids` | 是 | 一个或多个二级分类 ID，逗号分隔 |
| `page` | 否 | 页码 |
| `page_size` | 否 | 每页数量 |
| `channel` | 否 | 产品渠道 |
| `source` | 否 | 产品来源 |

示例：

```http
GET /api/v1/product-material/category-group/list?pid=8802&product_material_category_ids=child-category-id&page=1&page_size=30
X-API-Key: mat_your_api_key
```

响应中的每个 `data.group` 对应一个二级分类：

```json
{
  "code": 1,
  "data": {
    "group": [
      {
        "pager": { "page": 1, "page_size": 30, "total": 2 },
        "product_material_category_id": "child-category-id",
        "list": []
      }
    ]
  }
}
```

接口只返回启用分类下、已发布、可展示的素材。草稿、归档、下架和未发布素材不会出现在 App API 中。

## 6. 单个素材详情

接口：

```http
GET /api/v1/product-material/{materialId}
```

请求示例：

```http
GET /api/v1/product-material/material-id?pid=8802&channel=English&source=English
X-API-Key: mat_your_api_key
```

详情接口返回单个已发布素材。若素材不存在、未发布或不属于当前 PID，返回 `MATERIAL_NOT_FOUND` 或鉴权错误。

## 7. 标准素材 Config

Material Hub 使用统一的 `material_config`，App 不需要为每个产品单独解析一套业务格式。

```json
{
  "schema_version": 1,
  "preset": "image_to_image",
  "type": 2,
  "image_count": 1,
  "price": 10,
  "prompt": "Use the uploaded image as the primary reference...",
  "extensions": {
    "ai_pet_studio": {
      "business_mode": "portrait"
    }
  }
}
```

核心字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schema_version` | number | 标准版本，目前为 `1` |
| `preset` | string | `image_to_image` 或 `image_to_video` |
| `type` | number | `1` 前后图对比；`2` 单效果图 |
| `image_count` | number | 用户需要上传的参考图数量，`1` 或 `2` |
| `price` | number | 消耗积分；与素材顶层价格一致 |
| `prompt` | string | 提交给生成模型的 Prompt |
| `file_url` | string | 可选，仅在需要外部结果文件时使用，必须为 HTTPS |
| `extensions` | object | App 专属扩展，按 App 名称命名空间 |

`type` 和 `image_count` 含义不同：`type` 控制展示形式，`image_count` 控制用户上传图片数量，不能互相替代。

## 8. 媒体字段

素材通过 `public_properties` 和 `independent_properties` 返回媒体引用。常用字段：

| 字段 | 用途 |
| --- | --- |
| `original_file_id` | 主素材或结果文件 |
| `thumbnail_file_id` | 卡片封面、前图或缩略图 |
| `video_preview_file_id` | 视频预览文件 |
| `file_url` | Config 中的外部结果文件 URL |

优先读取对应字段中的 `data.cdn_url`。示例：

```json
{
  "independent_properties": {
    "thumbnail_file_id": {
      "value": ["asset-id"],
      "data": {
        "cdn_url": "https://cdn.example.com/thumbnail.jpg"
      }
    }
  },
  "public_properties": {
    "original_file_id": {
      "value": ["asset-id"],
      "data": {
        "cdn_url": "https://cdn.example.com/original.jpg"
      }
    }
  }
}
```

如果存在阿里云 OSS `cdn_url` 或 `file_url`，App 直接通过 HTTPS 请求媒体，不需要携带 OSS 密钥，也不需要经过 Material Hub 代理。

## 9. 渲染规则

### 图生图

- `type=1`：使用 `thumbnail_file_id` 作为前图，使用 `file_url` 或 `original_file_id` 作为后图
- `type=2`：使用 `thumbnail_file_id` 作为单张效果封面，详情使用 `original_file_id`

### 图生视频

- 卡片优先使用 `thumbnail_file_id`
- 播放视频优先使用 `original_file_id`
- 若存在 `video_preview_file_id`，可用于列表预览或详情页预览

### 未知或旧素材

- 没有 `schema_version` 时按旧格式兼容读取
- 没有 `preset` 时可根据 `type` 和媒体类型降级判断
- 未知 `extensions` 字段应忽略，不要因为新增字段导致解析失败
- 缺少必要媒体时显示占位状态，不要让整个列表崩溃

## 10. 缓存建议

- 分类树可缓存，启动时和缓存失效时重新请求
- 素材列表按 `pid + categoryId + page + pageSize` 缓存
- 收到 `401` 时检查 API Key 和 PID 是否匹配
- 收到 `404` 时清理对应分类或素材缓存
- 媒体 URL 可按响应头缓存；不要永久缓存整个目录数据

## 11. 常见错误

| 错误 | 原因 | 处理方式 |
| --- | --- | --- |
| `INVALID_API_KEY` | Key 缺失、错误或已吊销 | 检查安全配置和产品绑定 |
| `PRODUCT_NOT_FOUND` | PID 不存在或已归档 | 重新调用产品配置或联系管理方 |
| `CATEGORY_NOT_FOUND` | 分类 ID 不属于当前 PID | 重新拉取分类树 |
| `MATERIAL_NOT_FOUND` | 素材未发布、不存在或不属于当前 PID | 清理缓存并重新加载列表 |
| `INVALID_CHANNEL` | channel 与产品配置不一致 | 使用产品实际 channel |
| `INVALID_SOURCE` | source 与产品配置不一致 | 使用产品实际 source |

## 12. 接入检查清单

- [ ] 使用正确的生产 Base URL
- [ ] 使用与 PID 匹配的 `X-API-Key`
- [ ] 不写死分类 ID
- [ ] 分类树刷新后只使用目标产品的二级分类
- [ ] 列表只展示已发布数据
- [ ] 根据 `type` 选择图生图或图生视频布局
- [ ] 正确处理 `image_count`
- [ ] 优先使用 `cdn_url`，不在 App 中保存 OSS 密钥
- [ ] 忽略未知标准扩展字段
- [ ] 对 401、404、网络超时和空列表做降级处理

## 13. 可直接复制的接入模板

下面的模板适合 React、Swift、Kotlin、Flutter 等客户端改写。客户端只需要替换 `BASE_URL`、`pid` 和安全配置中的 `apiKey`，不要把分类 ID 写死。

```ts
const BASE_URL = "https://material-hub-nano-banana.yangf999212.workers.dev";

type ApiResponse<T> = { code: number; data: T; msg: string };

async function materialGet<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "X-API-Key": apiKey,
    },
  });

  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || body.code !== 1) {
    throw new Error(body.data && typeof body.data === "object"
      ? JSON.stringify(body.data)
      : body.msg || `HTTP ${response.status}`);
  }
  return body.data;
}

export async function loadMaterialCatalog(pid: string, apiKey: string) {
  const context = new URLSearchParams({
    pid,
    channel: "English",
    source: "English",
    page: "1",
    page_size: "100",
  });

  const tree = await materialGet<{
    list: Array<{ id: string; code: string; name: string; children?: Array<{ id: string; name: string; code: string }> }>;
    pager: { page: number; page_size: number; total: number };
  }>(`/api/v1/product-material-category/ids/tree-list?${context}`, apiKey);

  const categories = tree.list.flatMap(root => root.children ?? []);
  const groups = await Promise.all(categories.map(async category => {
    const query = new URLSearchParams({
      pid,
      product_material_category_ids: category.id,
      page: "1",
      page_size: "30",
      channel: "English",
      source: "English",
    });
    const result = await materialGet<{ group: Array<{ list: MaterialItem[] }> }>(
      `/api/v1/product-material/category-group/list?${query}`,
      apiKey,
    );
    return { category, materials: result.group[0]?.list ?? [] };
  }));

  return { categories, groups };
}
```

### 素材类型定义

```ts
type MaterialConfig = {
  schema_version?: number;
  preset?: "image_to_image" | "image_to_video";
  type?: 1 | 2;
  image_count?: 1 | 2;
  video_duration?: 5 | 10 | 15;
  video_resolution?: "720p" | "1080p";
  price?: number;
  prompt?: string;
  file_url?: string;
  extensions?: Record<string, Record<string, unknown>>;
};

type MediaFile = {
  value?: string[];
  data?: {
    id?: string;
    cdn_url?: string;
    name?: string;
    size?: number;
    hash?: string;
  };
};

type MaterialItem = {
  id: string;
  material_id: string;
  public_properties?: {
    material_config?: { value?: string[] };
    original_file_id?: MediaFile;
  };
  independent_properties?: {
    thumbnail_file_id?: MediaFile;
    video_preview_file_id?: MediaFile;
    price?: { value?: number[] };
  };
};
```

### 客户端统一解析方法

```ts
function readConfig(item: MaterialItem): MaterialConfig {
  const raw = item.public_properties?.material_config?.value?.[0] ?? "{}";
  try { return JSON.parse(raw) as MaterialConfig; } catch { return {}; }
}

function mediaURL(file?: MediaFile) {
  return file?.data?.cdn_url || "";
}

function renderModel(item: MaterialItem) {
  const config = readConfig(item);
  const thumbnail = mediaURL(item.independent_properties?.thumbnail_file_id);
  const original = mediaURL(item.public_properties?.original_file_id);
  const preview = mediaURL(item.independent_properties?.video_preview_file_id);

  if (config.preset === "image_to_video") {
    return { kind: "video", coverURL: thumbnail, previewURL: preview, videoURL: original };
  }

  return {
    kind: "image",
    coverURL: thumbnail,
    resultURL: config.type === 1 ? (config.file_url || original) : original,
    compare: config.type === 1,
  };
}
```

## 14. 8802 联调示例

当前产品信息：

| 字段 | 值 |
| --- | --- |
| `pid` | `8802` |
| `channel` | `English` |
| `source` | `English` |
| 分类名称 | `测试分类` |
| 分类 ID | `41f7d48e98c248d2c6e6644a` |

联调时先请求分类树，再使用返回的分类 ID。当前测试分类下有一个图生图素材和一个图生视频素材；只有状态为 `published` 的素材才会从 App API 返回。

```bash
BASE="https://material-hub-nano-banana.yangf999212.workers.dev"
KEY="mat_your_8802_api_key"

curl --get "$BASE/api/v1/product-material-category/ids/tree-list" \
  --data-urlencode "pid=8802" \
  --data-urlencode "channel=English" \
  --data-urlencode "source=English" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=100" \
  -H "X-API-Key: $KEY"

curl --get "$BASE/api/v1/product-material/category-group/list" \
  --data-urlencode "pid=8802" \
  --data-urlencode "product_material_category_ids=41f7d48e98c248d2c6e6644a" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=30" \
  --data-urlencode "channel=English" \
  --data-urlencode "source=English" \
  -H "X-API-Key: $KEY"
```

如果返回空列表，按以下顺序排查：

1. 是否把 MCP Token、8801 Key 或已吊销 Key 当成 8802 Key 使用。
2. 是否漏传 `X-API-Key`，或把 Key 放到了 URL 参数中。
3. 是否把一级分类 ID 传给了 `product_material_category_ids`。
4. `pid`、`channel`、`source` 是否分别为 `8802`、`English`、`English`。
5. 是否在客户端错误地过滤掉了 `preset=image_to_video` 或 `type=2`。

## 15. 版本兼容原则

- 新增字段一律按可选字段读取。
- 遇到未知 `preset`、未知 `extensions` 或更高 `schema_version` 时，保留卡片并使用安全降级 UI，不要让整个目录解析失败。
- 不要依赖字段顺序、固定分类名称或固定素材 ID。
- 不要把 API Key、OSS 密钥或 MCP Token写入日志、截图、公开仓库或客户端源码。
- Material Hub 发布新标准字段时，保持现有字段和响应外层结构不变。
