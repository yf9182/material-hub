<div align="center">

# 🗂️ Material Hub

**让 App、Web 与 AI Agent 共用一套可管理的创作素材目录。**

集中维护产品、分类、模板和媒体文件，并通过受控 API 与 MCP 工具提供给下游使用。

[管理平台](https://material-hub-nano-banana.yangf999212.workers.dev/admin) ·
[App 接入指南](https://github.com/yf9182/material-hub/blob/main/docs/app-integration-guide.md) ·
[MCP 操作手册](https://github.com/yf9182/material-hub/blob/main/docs/trending-template-mcp-usage.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1%20%2B%20R2-F38020?logo=cloudflare&logoColor=white)
![MCP](https://img.shields.io/badge/AI-MCP-7357FF)

</div>

## ✨ 这个项目是什么

Material Hub 是一套素材管理与分发平台。管理员可以维护多产品的分类、创作模板与媒体；App 和 Web 通过带 API Key 的只读接口获取已发布目录；AI Agent 则可通过 MCP 工具查询、创建草稿、预览与发布。

## 🌟 能做什么

| 素材管理 | 应用接入 | Agent 工作流 |
| --- | --- | --- |
| 维护产品与两级分类 | 获取已发布分类与模板 | 查询目录并检查素材配置 |
| 新建、编辑、发布、归档素材 | 通过 API Key 做产品级鉴权 | 创建和更新素材草稿 |
| 上传图片、视频与预览文件 | 从 R2 / OSS 提供媒体文件 | 预览、校验后再发布 |
| 从参考 API、JSON 或素材 ID 导入 | 兼容 App 使用的目录响应格式 | 通过 revision 与审计记录保护写操作 |

## 🔄 从创建到发布

~~~mermaid
flowchart LR
    A[管理后台 / MCP] --> B[创建或导入素材]
    B --> C[校验并保存为草稿]
    C --> D[预览与确认]
    D --> E[发布到目录]
    E --> F[App / Web 只读 API]
    E --> G[R2 / OSS 媒体文件]
~~~

## 🤖 MCP 与 Skill

仓库包含 stdio MCP 服务和模板发布 Skill，将趋势素材从调研推进到可审核的发布流程：

**公开趋势调研 → 生成封面 → 创建草稿 → 预览校验 → 明确确认 → 发布**

MCP 负责目录读写、素材与媒体校验、去重、revision 和审计；Skill 指引 Agent 准备内容并遵循安全与发布确认规则。发布工具要求明确确认参数，不能只凭预览自动上线。

- [MCP 工具与 Skill 使用手册](https://github.com/yf9182/material-hub/blob/main/docs/trending-template-mcp-usage.md)
- [标准素材 MCP 约定](https://github.com/yf9182/material-hub/blob/main/docs/standard-material-mcp.md)
- [模板发布 Skill](https://github.com/yf9182/material-hub/tree/main/.agents/skills/trending-template-publisher)

## 🧰 技术选型

React · TypeScript · Cloudflare Workers · D1 · R2 · 阿里云 OSS · Drizzle ORM · Model Context Protocol

## 🚀 本地运行

需要 Node.js 22.13+。

~~~bash
npm install
npm run dev
~~~

打开 localhost:3000/admin 进入本地管理页面。D1、R2、OSS 与参考素材 API 凭据需按部署环境配置。AccessKey 和 MCP Token 应仅通过本地忽略配置或托管运行时密钥注入，不能提交到仓库或浏览器代码。

运行构建与测试：

~~~bash
npm test
npm run lint
~~~

启动本地 MCP 服务：

~~~bash
npm run --silent mcp
~~~

MCP Token 与部署配置见 [MCP 操作手册](https://github.com/yf9182/material-hub/blob/main/docs/trending-template-mcp-usage.md)，不要把 Token 写进 README、Skill 或仓库配置。

## 🔌 App API

以下只读目录接口使用 X-API-Key 鉴权：

- GET /api/v1/product-material-category/ids/tree-list
- GET /api/v1/product-material/category-group/list
- GET /api/v1/product-material/category-group/{categoryId}

请求参数与响应格式见 [App 接入指南](https://github.com/yf9182/material-hub/blob/main/docs/app-integration-guide.md)。
