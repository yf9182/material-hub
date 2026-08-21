import { initialProductId, productById, productByPid, seedCatalog } from "../../../../../lib/catalog-repository";
import { nowSeconds, objectId, parseJsonObject } from "../../../../../lib/material-platform";
import { platformEnv } from "../../../../../lib/platform-runtime";
import { mcpActor } from "../../../../../lib/mcp-auth";
import { standardMediaRoles, validateStandardMaterialConfig } from "../../../../../lib/standard-material";

type Row = Record<string, unknown>;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

function json(value: unknown, fallback: unknown = {}) {
  try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; }
}

async function authorized(request: Request) {
  const actor = await mcpActor(request);
  if (!actor) return null;
  await seedCatalog();
  return actor;
}

async function resolveProduct(value: unknown) {
  const key = String(value ?? "").trim();
  return key ? (await productByPid(key) ?? await productById(key)) : await productById(initialProductId);
}

async function audit(actor: string, productId: string, action: string, targetType: string, targetId: string, changes: Record<string, unknown>) {
  await platformEnv().DB.prepare("INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(objectId(), productId, actor, action, targetType, targetId, JSON.stringify(changes), nowSeconds()).run();
}

function errorResponse(error: unknown, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function productDTO(product: Row) {
  return { id: product.id, pid: product.external_pid, name: product.name, channel: product.channel, source: product.source };
}

function assetDTO(asset: Row, origin: string) {
  const url = String(asset.storage_provider ?? "") === "aliyun-oss" && asset.oss_key ? String(asset.oss_key) : `${origin}/api/assets/${asset.id}`;
  return { id: asset.id, role: asset.role, fileName: asset.file_name, contentType: asset.content_type, size: asset.size, width: asset.width, height: asset.height, url };
}

async function materialRecord(productId: string, materialId: string, origin: string) {
  const db = platformEnv().DB;
  const material = await db.prepare("SELECT * FROM materials WHERE id=? AND product_id=? LIMIT 1").bind(materialId, productId).first<Row>();
  if (!material) return null;
  const [relations, assets] = await Promise.all([
    db.prepare("SELECT category_id FROM material_categories WHERE material_id=? AND product_id=? AND archived_at IS NULL").bind(materialId, productId).all<Row>(),
    db.prepare("SELECT * FROM assets WHERE material_id=? AND product_id=? ORDER BY created_at").bind(materialId, productId).all<Row>(),
  ]);
  return {
    id: material.id,
    name: material.internal_name,
    titleTranslations: json(material.title_translations),
    config: json(material.material_config_json),
    configRaw: material.material_config_raw,
    price: material.price,
    status: material.status,
    publishStatus: material.publish_status,
    categoryIds: relations.results.map((row) => String(row.category_id)),
    assets: assets.results.map((asset) => assetDTO(asset, origin)),
    updatedAt: material.updated_at,
  };
}

function payloadFromForm(form: FormData) {
  const raw = form.get("payload");
  const payload = json(raw, {});
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Row : {};
}

function mediaFromForm(form: FormData) {
  const files = new Map<string, File>();
  for (const role of ["original", "thumbnail", "preview"]) {
    const value = form.get(`media_${role}`);
    if (value instanceof File) files.set(role, value);
  }
  return files;
}

function mediaError(preset: string, files: Map<string, File>, existingRoles: Set<string> = new Set()) {
  const roles = new Set([...existingRoles, ...files.keys()]);
  const missing = standardMediaRoles(preset).filter((role) => !roles.has(role));
  if (missing.length) return `缺少必需媒体：${missing.join(", ")}`;
  for (const [role, file] of files) {
    if (file.size <= 0 || file.size > MAX_MEDIA_BYTES) return `${role} 文件大小必须大于 0 且不超过 50 MB`;
    const type = String(file.type ?? "");
    if (role === "thumbnail" && !type.startsWith("image/")) return "thumbnail 必须是图片";
    if (preset === "image_to_image" && role === "original" && !type.startsWith("image/")) return "图生图 original 必须是图片";
    if (preset === "image_to_video" && role === "original" && !type.startsWith("video/")) return "图生视频 original 必须是视频";
    if (role === "preview" && !type.startsWith("image/") && !type.startsWith("video/")) return "preview 必须是图片或视频";
  }
  return null;
}

async function uploadAssets(product: Row, materialId: string, files: Map<string, File>) {
  const uploaded: Array<{ id: string; role: string; key: string; file: File }> = [];
  try {
    for (const [role, file] of files) {
      const id = objectId(); const key = `${String(product.external_pid)}/${materialId}/${role}-${id}`;
      await platformEnv().MATERIAL_ASSETS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      uploaded.push({ id, role, key, file });
    }
    return uploaded;
  } catch (error) {
    await Promise.all(uploaded.map((asset) => platformEnv().MATERIAL_ASSETS.delete(asset.key)));
    throw error;
  }
}

async function standardInspection(productId: string, materialId: string, origin: string) {
  const db = platformEnv().DB;
  const material = await db.prepare("SELECT * FROM materials WHERE id=? AND product_id=? LIMIT 1").bind(materialId, productId).first<Row>();
  if (!material) throw new Error("MATERIAL_NOT_FOUND");
  const config = parseJsonObject(String(material.material_config_raw ?? "{}")) ?? {};
  const validation = validateStandardMaterialConfig(config);
  const assets = (await db.prepare("SELECT role,content_type,size FROM assets WHERE material_id=? AND product_id=?").bind(materialId, productId).all<Row>()).results;
  const roles = new Set(assets.map((row) => String(row.role)));
  const preset = String(config.preset ?? "image_to_image");
  const missingMedia = standardMediaRoles(preset).filter((role) => !roles.has(role));
  if (missingMedia.length) validation.errors.push(`缺少必需媒体：${missingMedia.join(", ")}`);
  for (const asset of assets) {
    const role = String(asset.role); const type = String(asset.content_type ?? "");
    if (role === "thumbnail" && !type.startsWith("image/")) validation.errors.push("thumbnail 必须是图片");
    if (preset === "image_to_image" && role === "original" && !type.startsWith("image/")) validation.errors.push("图生图 original 必须是图片");
    if (preset === "image_to_video" && role === "original" && !type.startsWith("video/")) validation.errors.push("图生视频 original 必须是视频");
    if (role === "preview" && !type.startsWith("image/") && !type.startsWith("video/")) validation.errors.push("preview 必须是图片或视频");
  }
  if (Number(material.price ?? -1) !== Number(validation.config.price)) validation.errors.push("material.price 与 config.price 不一致");
  const legacy = config.schema_version !== 1 || !config.preset || !config.extensions;
  if (legacy) validation.warnings.push("该素材使用旧版或非标准 config，建议通过 update_standard_material 重新保存");
  return {
    valid: validation.errors.length === 0,
    legacy,
    errors: validation.errors,
    warnings: validation.warnings,
    config: validation.config,
    media: assets,
    material: await materialRecord(productId, materialId, origin),
  };
}

export async function GET(request: Request) {
  const actor = await authorized(request);
  if (!actor) return Response.json({ error: "INVALID_MCP_TOKEN" }, { status: 401 });
  const url = new URL(request.url);
  try {
    const product = await resolveProduct(url.searchParams.get("product"));
    if (!product) return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
    if (url.searchParams.get("op") !== "inspect") return errorResponse("UNKNOWN_OP", 404);
    const id = String(url.searchParams.get("id") ?? "");
    return Response.json({ data: { product: productDTO(product), ...(await standardInspection(String(product.id), id, url.origin)) } });
  } catch (error) { return errorResponse(error, 500); }
}

export async function POST(request: Request) {
  const actor = await authorized(request);
  if (!actor) return Response.json({ error: "INVALID_MCP_TOKEN" }, { status: 401 });
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (!contentType.includes("multipart/form-data")) {
      const body = await request.json() as Row;
      if (body.action === "validate") {
        const validation = validateStandardMaterialConfig((body.config ?? body) as Row);
        return Response.json({ data: { valid: validation.errors.length === 0, ...validation } });
      }
      const product = await resolveProduct(body.product);
      if (!product) return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
      const productId = String(product.id); const id = String(body.id ?? "");
      if (body.action === "publish") {
        if (body.confirmation !== "CONFIRM_PUBLISH") return errorResponse("CONFIRM_PUBLISH_REQUIRED", 409);
        const inspection = await standardInspection(productId, id, new URL(request.url).origin);
        if (!inspection.valid) return Response.json({ error: "STANDARD_VALIDATION_FAILED", details: inspection }, { status: 400 });
        await platformEnv().DB.prepare("UPDATE materials SET status='published',publish_status=1,archived_at=NULL,updated_at=? WHERE id=? AND product_id=?").bind(nowSeconds(), id, productId).run();
        await audit(actor, productId, "material.published", "material", id, { standard: true });
        return Response.json({ data: { product: productDTO(product), ...(await materialRecord(productId, id, new URL(request.url).origin)) } });
      }
      return errorResponse("UNKNOWN_ACTION", 404);
    }

    const form = await request.formData(); const payload = payloadFromForm(form); const action = String(form.get("action") ?? "create");
    const product = await resolveProduct(payload.product); if (!product) return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
    const productId = String(product.id); const db = platformEnv().DB; const files = mediaFromForm(form); const id = action === "update" ? String(payload.id ?? "") : objectId();
    const current = action === "update" ? await db.prepare("SELECT * FROM materials WHERE id=? AND product_id=? AND archived_at IS NULL").bind(id, productId).first<Row>() : null;
    if (action === "update" && !current) return errorResponse("MATERIAL_NOT_FOUND", 404);
    const inputConfig = payload.config && typeof payload.config === "object"
      ? payload.config as Row
      : current
        ? {
          ...(parseJsonObject(String(current.material_config_raw ?? "{}")) ?? {}),
          ...Object.fromEntries(Object.entries({ preset: payload.preset, type: payload.displayType ?? payload.type, image_count: payload.imageCount, price: payload.price, prompt: payload.prompt, file_url: payload.fileUrl, extensions: payload.extensions }).filter(([, value]) => value !== undefined)),
        }
        : payload;
    const validation = validateStandardMaterialConfig(inputConfig); if (validation.errors.length) return Response.json({ error: "STANDARD_CONFIG_INVALID", details: validation }, { status: 400 });
    const mediaFailure = mediaError(String(validation.config.preset), files, current ? new Set((await db.prepare("SELECT role FROM assets WHERE material_id=? AND product_id=?").bind(id, productId).all<Row>()).results.map((row) => String(row.role))) : new Set());
    if (action === "create" && mediaFailure) return errorResponse(mediaFailure);
    if (action === "update" && mediaFailure && files.size > 0) return errorResponse(mediaFailure);
    const categoryIds = Array.isArray(payload.categoryIds) ? payload.categoryIds.map(String) : current ? (await db.prepare("SELECT category_id FROM material_categories WHERE material_id=? AND product_id=? AND archived_at IS NULL").bind(id, productId).all<Row>()).results.map((row) => String(row.category_id)) : [];
    if (!categoryIds.length) return errorResponse("CATEGORY_REQUIRED");
    const categoryRows = await db.prepare(`SELECT id FROM categories WHERE product_id=? AND parent_id IS NOT NULL AND status='active' AND archived_at IS NULL AND id IN (${categoryIds.map(() => "?").join(",")})`).bind(productId, ...categoryIds).all<Row>();
    const validCategories = categoryRows.results.map((row) => String(row.id)); if (validCategories.length !== new Set(categoryIds).size) return errorResponse("INVALID_CHILD_CATEGORY");
    const name = String(payload.name ?? current?.internal_name ?? "").trim(); if (!name) return errorResponse("MATERIAL_NAME_REQUIRED");
    const titleMap = current ? json(current.title_translations, {}) as Row : {};
    const titles = JSON.stringify({ ...titleMap, en: { code: "en", content: name, is_default: 1 }, "zh-cn": { code: "zh-cn", content: String(payload.nameZh ?? titleMap["zh-cn"]?.content ?? ""), is_default: 0 } });
    const uploaded = await uploadAssets(product, id, files); const now = nowSeconds();
    try {
      if (action === "create") {
        await db.batch([
          db.prepare("INSERT INTO materials (id,product_id,source_key,internal_name,title_translations,activity_translations,material_config_raw,material_config_json,source_snapshot,manual_overrides,min_version,max_version,is_free,price,listing_status,publish_status,status,created_at,updated_at) VALUES (?,?,'mcp-standard',?,?,'{}',?,?,?,'{}',?,?,?, ?,1,0,'draft',?,?)").bind(id, productId, name, titles, JSON.stringify(validation.config), JSON.stringify(validation.config), JSON.stringify({ schema_version: 1, preset: validation.config.preset }), String(payload.minVersion ?? ""), String(payload.maxVersion ?? ""), Number(validation.config.price) === 0 ? 1 : 0, Number(validation.config.price), now, now),
          ...validCategories.map((categoryId, index) => db.prepare("INSERT INTO material_categories (id,product_id,material_id,category_id,sort_order,listing_status,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)").bind(objectId(), productId, id, categoryId, (index + 1) * 10, now, now)),
          ...uploaded.map((asset) => db.prepare("INSERT INTO assets (id,product_id,material_id,role,r2_key,file_name,content_type,size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(asset.id, productId, id, asset.role, asset.key, asset.file.name, asset.file.type || "application/octet-stream", asset.file.size, now, now)),
        ]);
        await audit(actor, productId, "material.standard_created", "material", id, { preset: validation.config.preset, categoryIds: validCategories, assetRoles: uploaded.map((asset) => asset.role) });
      } else if (action === "update") {
        await db.batch([
          db.prepare("UPDATE materials SET internal_name=?,title_translations=?,material_config_raw=?,material_config_json=?,source_key='mcp-standard',min_version=?,max_version=?,is_free=?,price=?,updated_at=? WHERE id=? AND product_id=?").bind(name, titles, JSON.stringify(validation.config), JSON.stringify(validation.config), String(payload.minVersion ?? current?.min_version ?? ""), String(payload.maxVersion ?? current?.max_version ?? ""), Number(validation.config.price) === 0 ? 1 : 0, Number(validation.config.price), now, id, productId),
          ...(payload.categoryIds ? [db.prepare("UPDATE material_categories SET archived_at=?,listing_status=0,updated_at=? WHERE material_id=? AND product_id=?").bind(now, now, id, productId), ...validCategories.map((categoryId, index) => db.prepare("INSERT INTO material_categories (id,product_id,material_id,category_id,sort_order,listing_status,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(material_id,category_id) DO UPDATE SET archived_at=NULL,listing_status=1,updated_at=?").bind(objectId(), productId, id, categoryId, (index + 1) * 10, now, now, now))] : []),
          ...uploaded.flatMap((asset) => [db.prepare("DELETE FROM assets WHERE material_id=? AND role=? AND product_id=?").bind(id, asset.role, productId), db.prepare("INSERT INTO assets (id,product_id,material_id,role,r2_key,file_name,content_type,size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(asset.id, productId, id, asset.role, asset.key, asset.file.name, asset.file.type || "application/octet-stream", asset.file.size, now, now)]),
        ]);
        await audit(actor, productId, "material.standard_updated", "material", id, { preset: validation.config.preset, categoryIds: payload.categoryIds, assetRoles: uploaded.map((asset) => asset.role) });
      } else throw new Error("UNKNOWN_ACTION");
    } catch (error) {
      await Promise.all(uploaded.map((asset) => platformEnv().MATERIAL_ASSETS.delete(asset.key)));
      throw error;
    }
    return Response.json({ data: { product: productDTO(product), ...(await materialRecord(productId, id, new URL(request.url).origin)), validation: { warnings: validation.warnings } } }, { status: action === "create" ? 201 : 200 });
  } catch (error) { return errorResponse(error, 500); }
}
