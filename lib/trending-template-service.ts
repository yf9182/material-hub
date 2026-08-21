import { platformEnv } from "./platform-runtime";
import { IMAGE_REFERENCE_INSTRUCTION, nowSeconds, objectId, prepareMaterialConfig, sha256Hex } from "./material-platform";

export const TRENDING_CATEGORY_EXTERNAL_ID = "mcp-trending";
export const TRENDING_SOURCE_KEY = "mcp-trending";
export const TRENDING_CATEGORY_CODE = "Trending";
export const TRENDING_ROOT_NAMES = new Set(["Nano Banana", "VikPea_APP_Nano_Banana"]);
export const TRENDING_ROOT_CODES = new Set(["Nano_Banana", "VikPea_APP_Nano_Banana"]);
export const MAX_COVER_BYTES = 10 * 1024 * 1024;
export const MIN_COVER_DIMENSION = 512;

export class TrendingConflictError extends Error {
  readonly status = 409;
  constructor(message: string, readonly candidates: Array<{ id: string; trendKey: string; title: string; status: string; publishStatus: number }>) {
    super(message);
    this.name = "TrendingConflictError";
  }
}

type Row = Record<string, unknown>;

export type TrendEvidence = {
  platform: string;
  url: string;
  observedAt: string;
  signal: string;
  excerpt?: string;
};

export type SafetyReview = {
  passed: boolean;
  policy: "safe-adaptation";
  notes: string;
  blockedTopics?: string[];
};

export type DisplayType = 1 | 2;

export type StageTemplateInput = {
  trendKey: string;
  concept: string;
  name: string;
  nameZh: string;
  prompt: string;
  /** The exact ImageGen prompt used to create the before reference. */
  beforePrompt?: string;
  displayType: DisplayType;
  imageCount: 1 | 2;
  price: 10 | 20;
  evidence: TrendEvidence[];
  safetyReview: SafetyReview;
  selectionReason?: string;
  coverReason?: string;
  beforeCover?: File;
  afterCover?: File;
  cover?: File;
};

export type PreviewAsset = {
  id: string;
  role: string;
  fileName: string;
  contentType: string;
  hash: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
};

export type TemplatePreview = {
  id: string;
  trendKey: string;
  title: string;
  titleZh: string;
  concept: string;
  prompt: string;
  beforePrompt?: string;
  displayType: DisplayType;
  imageCount: 1 | 2;
  price: 10 | 20;
  status: string;
  publishStatus: number;
  revision: string;
  evidence: TrendEvidence[];
  safetyReview: SafetyReview;
  selectionReason: string;
  coverReason: string;
  assets: { before?: PreviewAsset; after?: PreviewAsset; cover?: PreviewAsset; original?: PreviewAsset };
};

function parse<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? JSON.parse(value) as T : (value as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function safeFileName(value: string, fallback: string) {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 160) || fallback;
}

function headerBytes(bytes: Uint8Array, start: number, count: number) {
  return Array.from(bytes.slice(start, start + count));
}

function matches(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function readUInt24(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function readUInt32BE(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function imageInfo(bytes: Uint8Array, declaredType: string) {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (bytes.length < 24 || !matches(bytes, [0x49, 0x48, 0x44, 0x52], 12)) throw new Error("PNG 文件头无效");
    const info = { contentType: "image/png", width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
    if (declaredType && declaredType !== info.contentType) throw new Error("文件 MIME 与实际图片格式不一致");
    return info;
  }
  if (matches(bytes, [0xff, 0xd8])) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isFrame && length >= 7) {
        const info = { contentType: "image/jpeg", width: (bytes[offset + 5] << 8) | bytes[offset + 6], height: (bytes[offset + 3] << 8) | bytes[offset + 4] };
        if (declaredType && declaredType !== info.contentType) throw new Error("文件 MIME 与实际图片格式不一致");
        return info;
      }
      offset += length;
    }
    throw new Error("JPEG 文件缺少有效尺寸信息");
  }
  if (bytes.length >= 30 && matches(bytes, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    const format = String.fromCharCode(...headerBytes(bytes, 12, 4));
    if (format === "VP8X") {
      const info = { contentType: "image/webp", width: 1 + readUInt24(bytes, 24), height: 1 + readUInt24(bytes, 27) };
      if (declaredType && declaredType !== info.contentType) throw new Error("文件 MIME 与实际图片格式不一致");
      return info;
    }
    if (format === "VP8 " || format === "VP8L") throw new Error("无法验证 WebP 图片尺寸，请使用标准 JPEG、PNG 或 VP8X WebP");
  }
  throw new Error(`不支持的图片格式：${declaredType || "unknown"}`);
}

export async function validateCoverFile(file: File | undefined, label: string) {
  if (!(file instanceof File)) throw new Error(`${label}不能为空`);
  if (file.size <= 0 || file.size > MAX_COVER_BYTES) throw new Error(`${label}必须大于 0 且不超过 10 MB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = imageInfo(bytes, file.type);
  if (info.contentType !== "image/jpeg") throw new Error(`${label} 必须是 JPEG 图片`);
  if (info.width < MIN_COVER_DIMENSION || info.height < MIN_COVER_DIMENSION) throw new Error(`${label}分辨率过低，最小边不能小于 ${MIN_COVER_DIMENSION}px`);
  if (info.width !== 1000 || info.height !== 1200) throw new Error(`${label} 必须是 1000×1200 的 5:6 JPEG`);
  return { bytes, ...info, fileName: safeFileName(file.name, `${label}.jpg`) };
}

function validateTrendEvidence(evidence: TrendEvidence[]) {
  if (!Array.isArray(evidence) || evidence.length < 2) throw new Error("至少需要两个独立平台的趋势证据");
  const platforms = new Set<string>();
  const now = Date.now();
  for (const item of evidence) {
    const platform = safeText(item.platform);
    const url = safeText(item.url);
    const observedAt = safeText(item.observedAt);
    const signal = safeText(item.signal);
    if (!platform || !url || !observedAt || !signal) throw new Error("趋势证据必须包含 platform、url、observedAt 和 signal");
    let parsedURL: URL;
    try { parsedURL = new URL(url); } catch { throw new Error(`趋势证据 URL 无效：${url}`); }
    if (parsedURL.protocol !== "https:") throw new Error("趋势证据只能使用 HTTPS URL");
    const timestamp = Date.parse(observedAt);
    if (!Number.isFinite(timestamp) || timestamp > now + 24 * 60 * 60 * 1000 || now - timestamp > 30 * 24 * 60 * 60 * 1000) throw new Error("趋势证据必须来自最近 30 天");
    platforms.add(platform.toLowerCase());
  }
  if (platforms.size < 2) throw new Error("趋势证据必须来自至少两个独立平台");
}

function validateSafetyReview(review: SafetyReview) {
  if (!review || review.policy !== "safe-adaptation" || review.passed !== true || !safeText(review.notes)) throw new Error("必须完成 safe-adaptation 安全审查并提供说明");
}

function validateStageInput(input: StageTemplateInput) {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(input.trendKey)) throw new Error("trendKey 必须是 3–64 位小写字母、数字或连字符");
  if (!safeText(input.concept) || !safeText(input.name) || !safeText(input.nameZh)) throw new Error("概念、英文标题和简中标题不能为空");
  if (!safeText(input.prompt)) throw new Error("Prompt 不能为空");
  if (input.beforePrompt !== undefined && !safeText(input.beforePrompt)) throw new Error("beforePrompt 不能为空");
  if (input.displayType === 1 && !safeText(input.beforePrompt)) throw new Error("type=1 必须记录生成 before 图时使用的 beforePrompt");
  if (safeText(input.beforePrompt) === safeText(input.prompt)) throw new Error("beforePrompt 不能与模板 Prompt 相同；before 图必须有独立场景提示词");
  if (input.displayType !== 1 && input.displayType !== 2) throw new Error("displayType 只能是 1 或 2");
  if (input.imageCount !== 1 && input.imageCount !== 2) throw new Error("imageCount 只能是 1 或 2");
  if (input.price !== 10 && input.price !== 20) throw new Error("价格只能是 10 或 20 积分");
  if (input.selectionReason !== undefined && !safeText(input.selectionReason)) throw new Error("selectionReason 不能为空");
  if (input.coverReason !== undefined && !safeText(input.coverReason)) throw new Error("coverReason 不能为空");
  validateTrendEvidence(input.evidence);
  validateSafetyReview(input.safetyReview);
  if (input.displayType === 1 && (!input.beforeCover || !input.afterCover)) throw new Error("type=1 必须同时提供 beforeCover 和 afterCover");
  if (input.displayType === 2 && !input.cover) throw new Error("type=2 必须提供 cover");
}

async function auditStatement(productId: string, actor: string, action: string, targetType: string, targetId: string, changes: Record<string, unknown>) {
  return platformEnv().DB.prepare("INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(objectId(), productId, actor, action, targetType, targetId, JSON.stringify(changes), nowSeconds());
}

export async function findTrendingRoot(productId: string) {
  const rows = (await platformEnv().DB.prepare("SELECT id, name, code FROM categories WHERE product_id=? AND parent_id IS NULL AND status='active' AND archived_at IS NULL ORDER BY sort_order, created_at").bind(productId).all<Row>()).results;
  return rows.find((row: Row) => TRENDING_ROOT_NAMES.has(safeText(row.name)) || TRENDING_ROOT_CODES.has(safeText(row.code))) ?? null;
}

export async function ensureTrendingCategory(productId: string, actor: string) {
  const db = platformEnv().DB;
  const root = await findTrendingRoot(productId);
  if (!root) throw new Error("找不到图生图一级分类 VikPea_APP_Nano_Banana / Nano Banana");
  const now = nowSeconds();
  let category = await db.prepare("SELECT * FROM categories WHERE product_id=? AND external_id=? LIMIT 1").bind(productId, TRENDING_CATEGORY_EXTERNAL_ID).first<Row>();
  if (!category) category = await db.prepare("SELECT * FROM categories WHERE product_id=? AND parent_id=? AND (code=? OR name=?) AND archived_at IS NULL LIMIT 1").bind(productId, root.id, TRENDING_CATEGORY_CODE, "Trending").first<Row>();
  const created = !category;
  const categoryId = safeText(category?.id) || objectId();
  const siblings = (await db.prepare("SELECT id FROM categories WHERE product_id=? AND parent_id=? AND id<>? AND status='active' AND archived_at IS NULL ORDER BY sort_order, created_at, id").bind(productId, root.id, categoryId).all<Row>()).results;
  const statements = [];
  for (const [index, sibling] of siblings.entries()) statements.push(db.prepare("UPDATE categories SET sort_order=?, updated_at=? WHERE id=? AND product_id=?").bind((index + 2) * 10, now, sibling.id, productId));
  if (created) {
    statements.push(db.prepare("INSERT INTO categories (id, product_id, parent_id, external_id, name, code, config, translations, marks, sort_order, status, material_latest_update_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, '[]', 10, 'active', 0, ?, ?)")
      .bind(categoryId, productId, root.id, TRENDING_CATEGORY_EXTERNAL_ID, "Trending", TRENDING_CATEGORY_CODE, JSON.stringify({ en: { code: "en", content: "Trending", is_default: 1 }, "zh-cn": { code: "zh-cn", content: "热门", is_default: 0 } }), now, now));
  } else {
    statements.push(db.prepare("UPDATE categories SET external_id=?, name=?, code=?, translations=?, parent_id=?, status='active', archived_at=NULL, sort_order=10, updated_at=? WHERE id=? AND product_id=?")
      .bind(TRENDING_CATEGORY_EXTERNAL_ID, "Trending", TRENDING_CATEGORY_CODE, JSON.stringify({ en: { code: "en", content: "Trending", is_default: 1 }, "zh-cn": { code: "zh-cn", content: "热门", is_default: 0 } }), root.id, now, categoryId, productId));
  }
  const translations = parse<Record<string, { content?: string }>>(category?.translations, {});
  const changed = created || siblings.length > 0 || safeText(category?.name) !== "Trending" || safeText(category?.code) !== TRENDING_CATEGORY_CODE || safeText(category?.external_id) !== TRENDING_CATEGORY_EXTERNAL_ID || safeText(category?.parent_id) !== safeText(root.id) || safeText(category?.status) !== "active" || category?.archived_at !== null && category?.archived_at !== undefined || Number(category?.sort_order ?? 0) !== 10 || safeText(translations.en?.content) !== "Trending" || safeText(translations["zh-cn"]?.content) !== "热门";
  if (changed) {
    statements.push(await auditStatement(productId, actor, "mcp.category.trending_ensured", "category", categoryId, { created, rootId: root.id, name: "Trending", code: TRENDING_CATEGORY_CODE, sortOrder: 10 }));
    await db.batch(statements);
  }
  return { id: categoryId, rootId: safeText(root.id), name: "Trending", code: TRENDING_CATEGORY_CODE, created, changed };
}

async function promoteMaterialRelation(productId: string, categoryId: string, materialId: string, now: number) {
  const db = platformEnv().DB;
  const siblings = (await db.prepare("SELECT id FROM material_categories WHERE product_id=? AND category_id=? AND material_id<>? AND archived_at IS NULL ORDER BY sort_order, created_at, id").bind(productId, categoryId, materialId).all<Row>()).results;
  const statements = siblings.map((row: Row, index: number) => db.prepare("UPDATE material_categories SET sort_order=?, updated_at=? WHERE id=? AND product_id=?").bind((index + 2) * 10, now, row.id, productId));
  if (statements.length) await db.batch(statements);
}

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function writeAsset(productId: string, materialId: string, role: "original" | "thumbnail", file: File, bytes: Uint8Array, contentType: string, width: number, height: number, hash: string) {
  const key = `mcp-trending/${productId}/${materialId}/${role}-${hash.slice(0, 24)}.jpg`;
  await platformEnv().MATERIAL_ASSETS.put(key, bytes, { httpMetadata: { contentType } });
  return { id: objectId(), productId, materialId, role, key, fileName: safeFileName(file.name, `${role}.jpg`), contentType, size: bytes.byteLength, hash, width, height };
}

async function assetRowsFor(materialId: string) {
  return (await platformEnv().DB.prepare("SELECT * FROM assets WHERE material_id=? ORDER BY role, created_at, id").bind(materialId).all<Row>()).results;
}

function assetPreview(row: Row | undefined, origin: string): PreviewAsset | undefined {
  if (!row) return undefined;
  return { id: safeText(row.id), role: safeText(row.role), fileName: safeText(row.file_name), contentType: safeText(row.content_type), hash: safeText(row.hash), size: Number(row.size ?? 0), width: row.width === null || row.width === undefined ? null : Number(row.width), height: row.height === null || row.height === undefined ? null : Number(row.height), url: `${origin}/api/assets/${safeText(row.id)}` };
}

function sourceData(row: Row) {
  const source = parse<Record<string, unknown>>(row.source_snapshot, {});
  return { trendKey: safeText(source.trendKey || row.external_material_id).replace(/^trend:/, ""), concept: safeText(source.concept), beforePrompt: safeText(source.beforePrompt), evidence: Array.isArray(source.evidence) ? source.evidence as TrendEvidence[] : [], safetyReview: (source.safetyReview ?? { passed: false, policy: "safe-adaptation", notes: "" }) as SafetyReview, selectionReason: safeText(source.selectionReason), coverReason: safeText(source.coverReason) };
}

async function revisionFor(row: Row, assets: Row[]) {
  return sha256Hex(stableJson({ id: row.id, updatedAt: row.updated_at, internalName: row.internal_name, titles: parse(row.title_translations, {}), config: row.material_config_raw, price: row.price, source: row.source_snapshot, assets: assets.map((asset) => ({ role: asset.role, hash: asset.hash, size: asset.size, width: asset.width, height: asset.height })).sort((a, b) => String(a.role).localeCompare(String(b.role))) }));
}

export async function previewTemplate(productId: string, materialId: string, origin: string): Promise<TemplatePreview> {
  const row = await platformEnv().DB.prepare("SELECT m.*, r.category_id, r.listing_status relation_listing_status, r.archived_at relation_archived_at FROM materials m JOIN material_categories r ON r.material_id=m.id AND r.product_id=m.product_id JOIN categories c ON c.id=r.category_id AND c.product_id=r.product_id WHERE m.id=? AND m.product_id=? AND c.external_id=? AND c.status='active' AND c.archived_at IS NULL AND r.archived_at IS NULL LIMIT 1").bind(materialId, productId, TRENDING_CATEGORY_EXTERNAL_ID).first<Row>();
  if (!row) throw new Error("Trending 模板不存在");
  const assets = await assetRowsFor(materialId);
  const source = sourceData(row);
  const config = parse<Record<string, unknown>>(row.material_config_raw, {});
  const rawType = Number(config.type);
  if (rawType !== 1 && rawType !== 2) throw new Error("Trending 模板的 type 只能是 1 或 2");
  const displayType = rawType as DisplayType;
  const rawImageCount = Number(config.image_count);
  if (rawImageCount !== 1 && rawImageCount !== 2) throw new Error("Trending 模板的 image_count 只能是 1 或 2");
  const rawPrice = Number(row.price);
  if (rawPrice !== 10 && rawPrice !== 20 || Number(config.price) !== rawPrice) throw new Error("Trending 模板的 price 必须同时存在于 material 和 material_config");
  const titleTranslations = parse<Record<string, { content?: string }>>(row.title_translations, {});
  if (!safeText(titleTranslations.en?.content) || !safeText(titleTranslations["zh-cn"]?.content)) throw new Error("Trending 模板必须有英文和简中标题");
  if (!safeText(config.prompt) || !safeText(config.prompt).includes(IMAGE_REFERENCE_INSTRUCTION)) throw new Error("Trending 模板 Prompt 未通过图像参考策略");
  if (Number(row.relation_listing_status ?? 0) !== 1) throw new Error("Trending 模板分类关系未启用");
  const revision = await revisionFor(row, assets);
  const before = assets.find((asset: Row) => safeText(asset.role) === "thumbnail");
  const after = assets.find((asset: Row) => safeText(asset.role) === "original");
  return { id: safeText(row.id), trendKey: source.trendKey, title: safeText(titleTranslations.en?.content), titleZh: safeText(titleTranslations["zh-cn"]?.content), concept: source.concept, prompt: safeText(config.prompt), beforePrompt: safeText(source.beforePrompt) || undefined, displayType, imageCount: rawImageCount as 1 | 2, price: rawPrice as 10 | 20, status: safeText(row.status), publishStatus: Number(row.publish_status ?? 0), revision, evidence: source.evidence, safetyReview: source.safetyReview, selectionReason: source.selectionReason, coverReason: source.coverReason, assets: displayType === 1 ? { before: assetPreview(before, origin), after: assetPreview(after, origin) } : { cover: assetPreview(before, origin), original: assetPreview(after, origin) } };
}

export async function inspectTrendingContext(productId: string, origin: string) {
  const root = await findTrendingRoot(productId);
  const category = root ? await platformEnv().DB.prepare("SELECT id,name,code,sort_order,status,translations FROM categories WHERE product_id=? AND parent_id=? AND external_id=? LIMIT 1").bind(productId, root.id, TRENDING_CATEGORY_EXTERNAL_ID).first<Row>() : null;
  const rows = (await platformEnv().DB.prepare("SELECT id,external_material_id,internal_name,title_translations,material_config_raw,status,publish_status,updated_at FROM materials WHERE product_id=? AND source_key=? ORDER BY updated_at DESC LIMIT 20").bind(productId, TRENDING_SOURCE_KEY).all<Row>()).results;
  return {
    productId,
    root: root ? { id: safeText(root.id), name: safeText(root.name), code: safeText(root.code) } : null,
    trendingCategory: category
      ? {
          id: safeText(category.id),
          name: safeText(category.name),
          code: safeText(category.code),
          sortOrder: Number(category.sort_order ?? 0),
          translations: parse(category.translations, {}),
        }
      : null,
    materials: await Promise.all(
      rows.map(async (row: Row) => ({
        id: safeText(row.id),
        trendKey: safeText(row.external_material_id).replace(/^trend:/, ""),
        title: safeText(parse<Record<string, { content?: string }>>(row.title_translations, {}).en?.content || row.internal_name),
        status: safeText(row.status),
        publishStatus: Number(row.publish_status ?? 0),
        updatedAt: Number(row.updated_at ?? 0),
        preview: await previewTemplate(productId, safeText(row.id), origin).catch(() => null),
      })),
    ),
  };
}

export async function stageTrendingTemplate(productId: string, actor: string, input: StageTemplateInput, origin: string) {
  validateStageInput(input);
  const preparedConfig = prepareMaterialConfig(JSON.stringify({ type: input.displayType, image_count: input.imageCount, price: input.price, prompt: input.prompt.trim() }));
  if ("error" in preparedConfig) throw new Error(preparedConfig.error);
  const category = await ensureTrendingCategory(productId, actor);
  const db = platformEnv().DB;
  const externalMaterialId = `trend:${input.trendKey}`;
  const existing = await db.prepare("SELECT * FROM materials WHERE product_id=? AND source_key=? AND external_material_id=? LIMIT 1").bind(productId, TRENDING_SOURCE_KEY, externalMaterialId).first<Row>();
  if (existing && safeText(existing.status) === "published" && Number(existing.publish_status) === 1) throw new Error(`趋势键已发布：${input.trendKey}`);
  const duplicateRows = (await db.prepare("SELECT m.id,m.external_material_id,m.internal_name,m.title_translations,m.material_config_raw,m.status,m.publish_status FROM materials m JOIN material_categories r ON r.material_id=m.id AND r.product_id=m.product_id JOIN categories c ON c.id=r.category_id AND c.product_id=r.product_id WHERE m.product_id=? AND m.id<>? AND c.external_id=? AND r.archived_at IS NULL").bind(productId, safeText(existing?.id) || "", TRENDING_CATEGORY_EXTERNAL_ID).all<Row>()).results;
  const normalizedTitle = input.name.trim().toLocaleLowerCase();
  const normalizedTitleZh = input.nameZh.trim().toLocaleLowerCase();
  const normalizedPrompt = input.prompt.trim();
  const duplicate = duplicateRows.find((row: Row) => {
    const translations = parse<Record<string, { content?: string }>>(row.title_translations, {});
    const title = safeText(translations.en?.content || row.internal_name).toLocaleLowerCase();
    const titleZh = safeText(translations["zh-cn"]?.content).toLocaleLowerCase();
    const config = parse<Record<string, unknown>>(row.material_config_raw, {});
    return title === normalizedTitle || titleZh === normalizedTitleZh || safeText(config.prompt) === normalizedPrompt;
  });
  if (duplicate) {
    const duplicateTranslations = parse<Record<string, { content?: string }>>(duplicate.title_translations, {});
    throw new TrendingConflictError(`已存在相同标题或 Prompt 的候选：${safeText(duplicate.external_material_id || duplicate.id)}`, [{ id: safeText(duplicate.id), trendKey: safeText(duplicate.external_material_id).replace(/^trend:/, ""), title: safeText(duplicateTranslations.en?.content || duplicate.internal_name), status: safeText(duplicate.status), publishStatus: Number(duplicate.publish_status ?? 0) }]);
  }
  const materialId = safeText(existing?.id) || objectId();
  const now = nowSeconds();
  const beforeFile = input.displayType === 1 ? await validateCoverFile(input.beforeCover, "beforeCover") : await validateCoverFile(input.cover, "cover");
  const afterFile = input.displayType === 1 ? await validateCoverFile(input.afterCover, "afterCover") : beforeFile;
  if (beforeFile.width > 0 && afterFile.width > 0 && (beforeFile.width !== afterFile.width || beforeFile.height !== afterFile.height)) throw new Error("type=1 的前后图尺寸必须一致");
  if (input.displayType === 1 && beforeFile.bytes.byteLength === afterFile.bytes.byteLength && beforeFile.bytes.every((byte, index) => byte === afterFile.bytes[index])) throw new Error("type=1 的前后图不能是同一文件");
  const beforeHash = await sha256Bytes(beforeFile.bytes);
  const afterHash = input.displayType === 1 ? await sha256Bytes(afterFile.bytes) : beforeHash;
  const beforeAsset = await writeAsset(productId, materialId, "thumbnail", input.displayType === 1 ? input.beforeCover! : input.cover!, beforeFile.bytes, beforeFile.contentType, beforeFile.width, beforeFile.height, beforeHash);
  const afterAsset = await writeAsset(productId, materialId, "original", input.displayType === 1 ? input.afterCover! : input.cover!, afterFile.bytes, afterFile.contentType, afterFile.width, afterFile.height, afterHash);
  const titles = JSON.stringify({ en: { code: "en", content: input.name.trim(), is_default: 1 }, "zh-cn": { code: "zh-cn", content: input.nameZh.trim(), is_default: 0 } });
  const sourceSnapshot = JSON.stringify({ kind: "mcp-trending", trendKey: input.trendKey, concept: input.concept.trim(), beforePrompt: safeText(input.beforePrompt), displayType: input.displayType, imageCount: input.imageCount, price: input.price, evidence: input.evidence, safetyReview: input.safetyReview, selectionReason: safeText(input.selectionReason), coverReason: safeText(input.coverReason), generatedBy: "codex-imagegen", stagedAt: now });
  const relation = existing ? await db.prepare("SELECT id FROM material_categories WHERE material_id=? AND category_id=? LIMIT 1").bind(materialId, category.id).first<Row>() : null;
  const statements = [
    existing
      ? db.prepare("UPDATE materials SET internal_name=?,title_translations=?,activity_translations='{}',material_config_raw=?,material_config_json=?,source_snapshot=?,manual_overrides='{}',price=?,is_free=0,listing_status=1,publish_status=0,status='draft',archived_at=NULL,updated_at=? WHERE id=? AND product_id=?").bind(input.name.trim(), titles, preparedConfig.raw, JSON.stringify(preparedConfig.config), sourceSnapshot, input.price, now, materialId, productId)
      : db.prepare("INSERT INTO materials (id,product_id,external_material_id,source_key,internal_name,title_translations,activity_translations,material_config_raw,material_config_json,source_snapshot,manual_overrides,min_version,max_version,is_free,price,listing_status,publish_status,status,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, '{}', '', '', 0, ?, 1, 0, 'draft', ?, ?)").bind(materialId, productId, externalMaterialId, TRENDING_SOURCE_KEY, input.name.trim(), titles, preparedConfig.raw, JSON.stringify(preparedConfig.config), sourceSnapshot, input.price, now, now),
    db.prepare("DELETE FROM assets WHERE material_id=? AND product_id=?").bind(materialId, productId),
    db.prepare("DELETE FROM material_categories WHERE material_id=? AND product_id=?").bind(materialId, productId),
    db.prepare("INSERT INTO assets (id,product_id,material_id,role,r2_key,storage_provider,oss_key,source_url,file_name,content_type,size,hash,width,height,created_at,updated_at) VALUES (?,?,?,?,?,'r2',NULL,NULL,?,?,?,?,?,?,?,?)").bind(beforeAsset.id, productId, materialId, beforeAsset.role, beforeAsset.key, beforeAsset.fileName, beforeAsset.contentType, beforeAsset.size, beforeAsset.hash, beforeAsset.width, beforeAsset.height, now, now),
    db.prepare("INSERT INTO assets (id,product_id,material_id,role,r2_key,storage_provider,oss_key,source_url,file_name,content_type,size,hash,width,height,created_at,updated_at) VALUES (?,?,?,?,?,'r2',NULL,NULL,?,?,?,?,?,?,?,?)").bind(afterAsset.id, productId, materialId, afterAsset.role, afterAsset.key, afterAsset.fileName, afterAsset.contentType, afterAsset.size, afterAsset.hash, afterAsset.width, afterAsset.height, now, now),
    db.prepare("INSERT INTO material_categories (id,product_id,material_id,category_id,sort_order,listing_status,created_at,updated_at) VALUES (?,?,?,?,10,1,?,?)").bind(relation?.id || objectId(), productId, materialId, category.id, now, now),
    await auditStatement(productId, actor, "mcp.material.staged", "material", materialId, { trendKey: input.trendKey, displayType: input.displayType, imageCount: input.imageCount, price: input.price, categoryId: category.id }),
  ];
  await db.batch(statements);
  await promoteMaterialRelation(productId, category.id, materialId, now);
  return previewTemplate(productId, materialId, origin);
}

export async function publishTrendingTemplates(productId: string, actor: string, items: Array<{ id: string; revision: string }>, origin: string) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 3) throw new Error("一次只能发布 1–3 个 Trending 模板");
  const previews = await Promise.all(items.map((item) => previewTemplate(productId, safeText(item.id), origin)));
  for (const [index, preview] of previews.entries()) {
    if (preview.revision !== items[index].revision) throw new Error(`模板 ${preview.id} 在预览后已发生变化，请重新预览`);
    if (preview.status !== "draft" || preview.publishStatus !== 0) throw new Error(`模板 ${preview.id} 不是可发布草稿`);
    validateTrendEvidence(preview.evidence);
    validateSafetyReview(preview.safetyReview);
    if (preview.displayType === 1) {
      if (!preview.assets.before || !preview.assets.after || preview.assets.before.id === preview.assets.after.id) throw new Error(`模板 ${preview.id} 的前后图不完整`);
      if (!preview.assets.before.width || !preview.assets.before.height || preview.assets.before.width !== preview.assets.after.width || preview.assets.before.height !== preview.assets.after.height) throw new Error(`模板 ${preview.id} 的前后图尺寸不一致`);
      if (!preview.assets.before.hash || !preview.assets.after.hash || preview.assets.before.hash === preview.assets.after.hash) throw new Error(`模板 ${preview.id} 的前后图哈希无效或相同`);
    }
    if (preview.displayType === 2 && (!preview.assets.cover || !preview.assets.original || !preview.assets.cover.hash || !preview.assets.original.hash || preview.assets.cover.hash !== preview.assets.original.hash)) throw new Error(`模板 ${preview.id} 的单图封面资源不完整`);
  }
  const db = platformEnv().DB;
  const now = nowSeconds();
  const statements = [];
  const categoryRow = await db.prepare("SELECT r.category_id FROM material_categories r JOIN categories c ON c.id=r.category_id AND c.product_id=r.product_id WHERE r.material_id=? AND r.product_id=? AND c.external_id=? LIMIT 1").bind(previews[0].id, productId, TRENDING_CATEGORY_EXTERNAL_ID).first<Row>();
  if (!categoryRow) throw new Error("Trending 分类关系不存在");
  const categoryRelations = (await db.prepare("SELECT id,material_id FROM material_categories WHERE product_id=? AND category_id=? AND archived_at IS NULL ORDER BY sort_order,created_at,id").bind(productId, categoryRow.category_id).all<Row>()).results;
  const selectedIds = new Set(previews.map((preview) => preview.id));
  const orderedMaterialIds = [...previews.map((preview) => preview.id), ...categoryRelations.map((row: Row) => safeText(row.material_id)).filter((id: string) => !selectedIds.has(id))];
  const relationByMaterial = new Map(categoryRelations.map((row: Row) => [safeText(row.material_id), safeText(row.id)]));
  for (const [index, materialId] of orderedMaterialIds.entries()) {
    const relationId = relationByMaterial.get(materialId);
    if (relationId) statements.push(db.prepare("UPDATE material_categories SET sort_order=?,updated_at=? WHERE id=? AND product_id=?").bind((index + 1) * 10, now, relationId, productId));
  }
  for (const preview of previews) {
    statements.push(db.prepare("UPDATE materials SET status='published',publish_status=1,listing_status=1,archived_at=NULL,updated_at=? WHERE id=? AND product_id=? AND status='draft' AND publish_status=0").bind(now, preview.id, productId));
    statements.push(db.prepare("UPDATE material_categories SET listing_status=1,archived_at=NULL,updated_at=? WHERE material_id=? AND product_id=?").bind(now, preview.id, productId));
    statements.push(db.prepare("UPDATE categories SET material_latest_update_time=?,updated_at=? WHERE id IN (SELECT category_id FROM material_categories WHERE material_id=? AND product_id=?) AND product_id=?").bind(now, now, preview.id, productId, productId));
    statements.push(await auditStatement(productId, actor, "mcp.material.published", "material", preview.id, { trendKey: preview.trendKey, displayType: preview.displayType, imageCount: preview.imageCount, price: preview.price }));
  }
  await db.batch(statements);
  return { published: previews };
}

export function parseStageForm(form: FormData): StageTemplateInput {
  const jsonValue = <T>(name: string, fallback: T) => parse<T>(form.get(name), fallback);
  return { trendKey: safeText(form.get("trendKey")), concept: safeText(form.get("concept")), name: safeText(form.get("name")), nameZh: safeText(form.get("nameZh")), prompt: safeText(form.get("prompt")), beforePrompt: safeText(form.get("beforePrompt")) || undefined, displayType: Number(form.get("displayType")) as DisplayType, imageCount: Number(form.get("imageCount")) as 1 | 2, price: Number(form.get("price")) as 10 | 20, evidence: jsonValue<TrendEvidence[]>("evidence", []), safetyReview: jsonValue<SafetyReview>("safetyReview", { passed: false, policy: "safe-adaptation", notes: "" }), selectionReason: safeText(form.get("selectionReason")) || undefined, coverReason: safeText(form.get("coverReason")) || undefined, beforeCover: form.get("beforeCover") instanceof File ? form.get("beforeCover") as File : undefined, afterCover: form.get("afterCover") instanceof File ? form.get("afterCover") as File : undefined, cover: form.get("cover") instanceof File ? form.get("cover") as File : undefined };
}
