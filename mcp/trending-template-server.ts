import { readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";
import { McpServer, type CallToolResult, type ContentBlock } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";

type Preview = {
  id: string;
  displayType?: 1 | 2;
  selectionReason?: string;
  coverReason?: string;
  assets?: { before?: { url: string; contentType: string; hash?: string }; after?: { url: string; contentType: string; hash?: string }; cover?: { url: string; contentType: string; hash?: string }; original?: { url: string; contentType: string; hash?: string } };
};

const baseURL = String(process.env.MATERIAL_HUB_BASE_URL ?? "https://material-hub-nano-banana.yangf999212.workers.dev").replace(/\/+$/, "");
const tokenFile = resolve(process.env.MATERIAL_HUB_MCP_TOKEN_FILE ?? join(homedir(), ".config", "material-hub", "mcp-token"));
function localToken() {
  try { return readFileSync(tokenFile, "utf8").trim(); } catch { return ""; }
}
const token = String(process.env.MATERIAL_HUB_MCP_TOKEN ?? localToken());
const mediaRoot = resolve(process.env.MATERIAL_HUB_MCP_MEDIA_ROOT ?? join(process.cwd(), ".mcp-artifacts", "trending"));

if (!baseURL || !token) {
  console.error("MATERIAL_HUB_BASE_URL and MATERIAL_HUB_MCP_TOKEN are required for the Trending Template MCP");
  process.exitCode = 1;
}

async function assertMediaPath(value: string, label: string) {
  if (!value || value.startsWith("-")) throw new Error(`${label} 路径无效`);
  const resolved = await realpath(resolve(value));
  const root = await realpath(mediaRoot).catch(() => mediaRoot);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) throw new Error(`${label} 必须位于 MATERIAL_HUB_MCP_MEDIA_ROOT 内`);
  const file = await stat(resolved);
  if (!file.isFile()) throw new Error(`${label} 必须是文件`);
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error(`${label} 必须大于 0 且不超过 10 MB`);
  return resolved;
}

async function normalizeImage(value: string, label: string) {
  const path = await assertMediaPath(value, label);
  const input = await readFile(path);
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 512) throw new Error(`${label} 最小边不能小于 512px`);
  const output = await sharp(input).resize(1000, 1200, { fit: "cover", position: "centre" }).jpeg({ quality: 90 }).toBuffer();
  return { bytes: output, fileName: `${basename(path).replace(/\.[^.]+$/, "")}.jpg`, contentType: "image/jpeg" };
}

function fileType(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" } as Record<string, string>)[ext] ?? "application/octet-stream";
}

async function readStandardMedia(value: string, label: string, preset: string, role: string) {
  if (!value || value.startsWith("-")) throw new Error(`${label} 媒体输入无效`);
  let bytes: Uint8Array; let name: string; let contentType: string;
  if (/^https:\/\//i.test(value)) {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${label} 下载失败：HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > 50 * 1024 * 1024) throw new Error(`${label} 不得超过 50 MB`);
    bytes = new Uint8Array(await response.arrayBuffer()); name = basename(new URL(value).pathname) || `${role}.bin`; contentType = response.headers.get("content-type")?.split(";")[0] || fileType(name); if (contentType === "application/octet-stream") contentType = fileType(name);
  } else {
    const path = await assertMediaPath(value, label); const file = await readFile(path);
    if (file.byteLength > 50 * 1024 * 1024) throw new Error(`${label} 不得超过 50 MB`);
    bytes = file; name = basename(path); contentType = fileType(name);
  }
  if (!bytes.byteLength) throw new Error(`${label} 不能为空`);
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error(`${label} 不得超过 50 MB`);
  if (role === "thumbnail" && !contentType.startsWith("image/")) throw new Error("thumbnail 必须是图片");
  if (preset === "image_to_image" && role === "original" && !contentType.startsWith("image/")) throw new Error("图生图 original 必须是图片");
  if (preset === "image_to_video" && role === "original" && !contentType.startsWith("video/")) throw new Error("图生视频 original 必须是视频");
  if (role === "preview" && !contentType.startsWith("image/") && !contentType.startsWith("video/")) throw new Error("preview 必须是图片或视频");
  if (contentType.startsWith("image/")) {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 512) throw new Error(`${label} 最小边不能小于 512px`);
  }
  return new File([bytes], name, { type: contentType });
}

const standardMediaSchema = z.object({ original: z.string().min(1), thumbnail: z.string().min(1), preview: z.string().optional() });

async function standardMultipart(action: "create" | "update", input: Record<string, unknown>) {
  const preset = String(input.preset ?? "image_to_image");
  const media = input.media as Record<string, string> | undefined;
  if (action === "create" && (!media?.original || !media.thumbnail || (preset === "image_to_video" && !media.preview))) throw new Error("标准素材缺少必需媒体");
  const config = input.config && typeof input.config === "object" ? input.config : action === "update" ? undefined : {
    schema_version: 1,
    preset,
    type: input.displayType ?? 2,
    image_count: input.imageCount ?? 1,
    price: input.price ?? (preset === "image_to_video" ? 20 : 10),
    prompt: input.prompt,
    file_url: input.fileUrl,
    extensions: input.extensions ?? {},
  };
  const payload: Record<string, unknown> = { ...input, action, ...(config ? { config } : {}) };
  delete payload.media;
  const form = new FormData(); form.set("action", action); form.set("payload", JSON.stringify(payload));
  if (media.original) form.set("media_original", await readStandardMedia(media.original, "original", preset, "original"));
  if (media.thumbnail) form.set("media_thumbnail", await readStandardMedia(media.thumbnail, "thumbnail", preset, "thumbnail"));
  if (media.preview) form.set("media_preview", await readStandardMedia(media.preview, "preview", preset, "preview"));
  return requestAPI("/api/internal/mcp/standard-materials", { method: "POST", body: form });
}

async function requestAPI(path: string, init: RequestInit = {}) {
  if (!baseURL || !token) throw new Error("MCP 未配置 MATERIAL_HUB_BASE_URL / MATERIAL_HUB_MCP_TOKEN");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  const response = await fetch(`${baseURL}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${String(body.error ?? `Material Hub 请求失败：HTTP ${response.status}`)}${body.conflicts ? `\n冲突候选：${JSON.stringify(body.conflicts)}` : ""}`);
  return body.data;
}

function textResult(data: unknown, extra: ContentBlock[] = []): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }, ...extra], structuredContent: { data } };
}

async function previewImages(previews: Preview[]) {
  const images: ContentBlock[] = [];
  for (const preview of previews) {
    const entries = Object.entries(preview.assets ?? {}).filter(([label]) => preview.displayType !== 2 || label === "cover");
    for (const [label, asset] of entries) {
      if (!asset?.url) continue;
      const response = await fetch(asset.url);
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      images.push({ type: "image", data: bytes.toString("base64"), mimeType: asset.contentType || response.headers.get("content-type") || "image/jpeg", _meta: { label: `${preview.id}:${label}` } });
    }
  }
  return images;
}

const evidenceSchema = z.array(z.object({
  platform: z.string().min(1),
  url: z.string().url(),
  observedAt: z.string().min(1),
  signal: z.string().min(1),
  excerpt: z.string().optional(),
})).min(2);

const safetySchema = z.object({
  passed: z.literal(true),
  policy: z.literal("safe-adaptation"),
  notes: z.string().min(1),
  blockedTopics: z.array(z.string()).optional(),
});

const server = new McpServer({
  name: "material-hub-ai",
  version: "1.0.0",
}, {
  instructions: "Use the catalog tools to inspect products, categories, and materials before editing. Treat writes as deliberate. Never delete without confirmation CONFIRM_DELETE. For Trending, research trends first, preview drafts, and never publish until the user explicitly confirms the selected IDs and revisions; publish requires CONFIRM_PUBLISH.",
});

const productSelector = z.object({ product: z.string().optional().describe("Product PID or internal product ID; defaults to 8801") });

server.registerTool("list_products", {
  title: "List Material Hub products",
  description: "Read all active products and their PIDs. Use this before operating on a product other than the default.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async () => textResult(await requestAPI("/api/internal/mcp/catalog?op=products")));

server.registerTool("inspect_catalog", {
  title: "Inspect product catalog",
  description: "Read a compact product snapshot with categories, materials, statuses, prices, configs, and asset metadata. Supports q and status filters.",
  inputSchema: productSelector.extend({ q: z.string().optional(), status: z.enum(["all", "draft", "published", "archived"]).optional(), limit: z.number().int().min(1).max(200).optional() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async ({ product, q, status, limit }) => {
  const query = new URLSearchParams({ op: "catalog" }); if (product) query.set("product", product); if (q) query.set("q", q); if (status) query.set("status", status); if (limit) query.set("limit", String(limit));
  return textResult(await requestAPI(`/api/internal/mcp/catalog?${query}`));
});

server.registerTool("get_material", {
  title: "Get one material",
  description: "Read the complete editable record for one material, including category links and assets.",
  inputSchema: productSelector.extend({ id: z.string().min(1) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async ({ product, id }) => {
  const query = new URLSearchParams({ op: "material", id }); if (product) query.set("product", product);
  return textResult(await requestAPI(`/api/internal/mcp/catalog?${query}`));
});

server.registerTool("create_category", {
  title: "Create catalog category",
  description: "Create a root or second-level category. A parent must be a root category.",
  inputSchema: productSelector.extend({ name: z.string().min(1), code: z.string().optional(), parentId: z.string().optional() }),
}, async ({ product, name, code, parentId }) => textResult(await requestAPI("/api/internal/mcp/catalog", { method: "POST", body: JSON.stringify({ action: "create-category", product, name, code, parentId }), headers: { "Content-Type": "application/json" } })));

server.registerTool("create_material", {
  title: "Create material draft",
  description: "Create a draft material with metadata and category links. Media can be attached separately through the existing asset workflow or Trending staging tool.",
  inputSchema: productSelector.extend({ name: z.string().min(1), nameZh: z.string().optional(), categoryIds: z.array(z.string()).min(1), price: z.union([z.literal(0), z.literal(10), z.literal(20)]).optional(), type: z.number().int().optional(), configRaw: z.string().optional(), minVersion: z.string().optional(), maxVersion: z.string().optional() }),
}, async (input) => textResult(await requestAPI("/api/internal/mcp/catalog", { method: "POST", body: JSON.stringify({ action: "create-material", ...input }), headers: { "Content-Type": "application/json" } })));

server.registerTool("update_material", {
  title: "Update material metadata",
  description: "Update a material's name, bilingual title, price, config, version bounds, overrides, or category links.",
  inputSchema: productSelector.extend({ id: z.string().min(1), name: z.string().optional(), nameZh: z.string().optional(), categoryIds: z.array(z.string()).optional(), price: z.union([z.literal(0), z.literal(10), z.literal(20)]).optional(), configRaw: z.string().optional(), minVersion: z.string().optional(), maxVersion: z.string().optional(), overrides: z.record(z.string(), z.unknown()).optional() }),
}, async (input) => textResult(await requestAPI("/api/internal/mcp/catalog", { method: "POST", body: JSON.stringify({ action: "update-material", ...input }), headers: { "Content-Type": "application/json" } })));

server.registerTool("set_material_status", {
  title: "Change material status",
  description: "Move a material between draft, published, and archived. Publishing requires an original asset.",
  inputSchema: productSelector.extend({ id: z.string().min(1), status: z.enum(["draft", "published", "archived"]) }),
}, async ({ product, id, status }) => textResult(await requestAPI("/api/internal/mcp/catalog", { method: "POST", body: JSON.stringify({ action: "set-material-status", product, id, status }), headers: { "Content-Type": "application/json" } })));

server.registerTool("delete_materials", {
  title: "Delete material records",
  description: "Permanently delete one or more materials and their links/assets. Requires confirmation CONFIRM_DELETE.",
  inputSchema: productSelector.extend({ ids: z.array(z.string().min(1)).min(1).max(100), confirmation: z.literal("CONFIRM_DELETE") }),
  annotations: { destructiveHint: true, idempotentHint: false },
}, async ({ product, ids, confirmation }) => textResult(await requestAPI("/api/internal/mcp/catalog", { method: "POST", body: JSON.stringify({ action: "batch-delete-materials", product, ids, confirmation }), headers: { "Content-Type": "application/json" } })));

server.registerTool("validate_material_config", {
  title: "Validate standard material config",
  description: "Normalize and validate a material config without writing to the catalog.",
  inputSchema: z.object({ config: z.record(z.string(), z.unknown()) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async ({ config }) => textResult(await requestAPI("/api/internal/mcp/standard-materials", { method: "POST", body: JSON.stringify({ action: "validate", config }), headers: { "Content-Type": "application/json" } })));

server.registerTool("create_standard_material", {
  title: "Create standard material",
  description: "Create a draft for a PID using the shared image-to-image or image-to-video config standard. Media is required and may be a local path inside MATERIAL_HUB_MCP_MEDIA_ROOT or an HTTPS URL.",
  inputSchema: productSelector.extend({
    preset: z.enum(["image_to_image", "image_to_video"]), name: z.string().min(1), nameZh: z.string().optional(), prompt: z.string().min(1).max(8000), categoryIds: z.array(z.string()).min(1), imageCount: z.union([z.literal(1), z.literal(2)]).optional(), displayType: z.union([z.literal(1), z.literal(2)]).optional(), price: z.number().int().min(0).optional(), fileUrl: z.string().url().optional(), extensions: z.record(z.string(), z.unknown()).optional(), minVersion: z.string().optional(), maxVersion: z.string().optional(), media: standardMediaSchema,
  }),
}, async (input) => textResult(await standardMultipart("create", input as unknown as Record<string, unknown>)));

server.registerTool("update_standard_material", {
  title: "Update standard material",
  description: "Update one material under a PID, revalidate its standard config, and optionally replace media. All required media must exist after the update.",
  inputSchema: productSelector.extend({
    id: z.string().min(1), preset: z.enum(["image_to_image", "image_to_video"]).optional(), name: z.string().optional(), nameZh: z.string().optional(), prompt: z.string().max(8000).optional(), categoryIds: z.array(z.string()).optional(), imageCount: z.union([z.literal(1), z.literal(2)]).optional(), displayType: z.union([z.literal(1), z.literal(2)]).optional(), price: z.number().int().min(0).optional(), fileUrl: z.string().url().optional(), extensions: z.record(z.string(), z.unknown()).optional(), minVersion: z.string().optional(), maxVersion: z.string().optional(), config: z.record(z.string(), z.unknown()).optional(), media: standardMediaSchema.partial().optional(),
  }),
}, async (input) => {
  return textResult(await standardMultipart("update", input as unknown as Record<string, unknown>));
});

server.registerTool("inspect_material_standard", {
  title: "Inspect material standard",
  description: "Check whether a material under a PID has a valid standard config, matching price, and required media.",
  inputSchema: productSelector.extend({ id: z.string().min(1) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async ({ product, id }) => {
  const query = new URLSearchParams({ op: "inspect", id }); if (product) query.set("product", product);
  return textResult(await requestAPI(`/api/internal/mcp/standard-materials?${query}`));
});

server.registerTool("publish_standard_material", {
  title: "Publish standard material",
  description: "Publish a standard material after validation. Requires explicit confirmation CONFIRM_PUBLISH.",
  inputSchema: productSelector.extend({ id: z.string().min(1), confirmation: z.literal("CONFIRM_PUBLISH") }),
  annotations: { destructiveHint: true, idempotentHint: false },
}, async ({ product, id, confirmation }) => textResult(await requestAPI("/api/internal/mcp/standard-materials", { method: "POST", body: JSON.stringify({ action: "publish", product, id, confirmation }), headers: { "Content-Type": "application/json" } })));

server.registerTool("inspect_trending_context", {
  title: "Inspect Trending catalog context",
  description: "Read the current image-to-image root, Trending category, existing MCP templates, and drafts before researching or staging candidates.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async () => textResult(await requestAPI("/api/internal/mcp/trending?op=context")));

server.registerTool("ensure_trending_category", {
  title: "Ensure Trending category",
  description: "Create or repair the Trending secondary category under the existing image-to-image root and place it first.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async () => textResult(await requestAPI("/api/internal/mcp/trending", { method: "POST", body: JSON.stringify({ action: "ensure-category" }), headers: { "Content-Type": "application/json" } })));

server.registerTool("stage_trending_template", {
  title: "Stage Trending template",
  description: "Create or update one draft template. For a real before/after cover, record the exact independent beforePrompt used to generate the reference image, then use the same reference image for the template Prompt and after image.",
  inputSchema: z.object({
    trendKey: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    concept: z.string().min(1),
    name: z.string().min(1),
    nameZh: z.string().min(1),
    prompt: z.string().min(1).max(8000),
    beforePrompt: z.string().min(1).max(8000).optional(),
    displayType: z.union([z.literal(1), z.literal(2)]),
    imageCount: z.union([z.literal(1), z.literal(2)]),
    price: z.union([z.literal(10), z.literal(20)]),
    evidence: evidenceSchema,
    safetyReview: safetySchema,
    selectionReason: z.string().optional(),
    coverReason: z.string().optional(),
    beforeCoverPath: z.string().optional(),
    afterCoverPath: z.string().optional(),
    coverPath: z.string().optional(),
  }),
}, async (input) => {
  const form = new FormData();
  form.set("action", "stage");
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number") form.set(key, String(value));
    else if (key === "evidence" || key === "safetyReview") form.set(key, JSON.stringify(value));
  }
  if (input.displayType === 1) {
    if (!input.beforeCoverPath || !input.afterCoverPath) throw new Error("displayType=1 需要 beforeCoverPath 和 afterCoverPath");
    const before = await normalizeImage(input.beforeCoverPath, "beforeCoverPath");
    const after = await normalizeImage(input.afterCoverPath, "afterCoverPath");
    form.set("beforeCover", new File([before.bytes], before.fileName, { type: before.contentType }));
    form.set("afterCover", new File([after.bytes], after.fileName, { type: after.contentType }));
  } else {
    if (!input.coverPath) throw new Error("displayType=2 需要 coverPath");
    const cover = await normalizeImage(input.coverPath, "coverPath");
    form.set("cover", new File([cover.bytes], cover.fileName, { type: cover.contentType }));
  }
  const data = await requestAPI("/api/internal/mcp/trending", { method: "POST", body: form });
  return textResult(data, await previewImages([data as Preview]));
});

server.registerTool("preview_trending_templates", {
  title: "Preview Trending templates",
  description: "Return final cover images and release metadata for up to three drafts. This is mandatory before publishing.",
  inputSchema: z.object({ ids: z.array(z.string().min(1)).min(1).max(3) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async ({ ids }) => {
  const data = await requestAPI(`/api/internal/mcp/trending?op=preview&ids=${encodeURIComponent(ids.join(","))}`) as Preview[];
  return textResult(data, await previewImages(data));
});

server.registerTool("publish_trending_templates", {
  title: "Publish confirmed Trending templates",
  description: "Publish one to three previously previewed drafts. Only call after the user explicitly confirms the selected IDs and revisions.",
  inputSchema: z.object({
    confirmation: z.literal("CONFIRM_PUBLISH"),
    items: z.array(z.object({ id: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(3),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
}, async ({ items }) => textResult(await requestAPI("/api/internal/mcp/trending", { method: "POST", body: JSON.stringify({ action: "publish", items }), headers: { "Content-Type": "application/json" } })));

async function main() {
  if (!baseURL || !token) return;
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
