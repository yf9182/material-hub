import { batchDeleteMaterials, initialProductId, productById, productByPid, seedCatalog } from "../../../../../lib/catalog-repository";
import { platformEnv } from "../../../../../lib/platform-runtime";
import { nowSeconds, objectId, parsePrice, prepareMaterialConfig } from "../../../../../lib/material-platform";
import { mcpActor } from "../../../../../lib/mcp-auth";

type Row = Record<string, unknown>;

function parseJSON(value: unknown, fallback: unknown = {}) {
  try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; }
}

async function authorized(request: Request) {
  const actor = await mcpActor(request);
  if (!actor) return null;
  await seedCatalog();
  return actor;
}

async function resolveProduct(value: string | null | undefined) {
  const key = String(value ?? "").trim();
  return key ? (await productByPid(key) ?? await productById(key)) : await productById(initialProductId);
}

async function audit(actor: string, productId: string, action: string, targetType: string, targetId: string, changes: Record<string, unknown>) {
  const now = nowSeconds();
  await platformEnv().DB.prepare("INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(objectId(), productId, actor, action, targetType, targetId, JSON.stringify(changes), now).run();
}

function productDTO(row: Row) {
  return { id: row.id, pid: row.external_pid, name: row.name, channel: row.channel, source: row.source, status: row.status };
}

function materialDTO(row: Row, assets: Row[] = [], categoryIds: string[] = []) {
  return {
    id: row.id,
    externalMaterialId: row.external_material_id ?? "",
    sourceKey: row.source_key,
    name: row.internal_name,
    titleTranslations: parseJSON(row.title_translations),
    activityTranslations: parseJSON(row.activity_translations),
    configRaw: row.material_config_raw ?? "{}",
    config: parseJSON(row.material_config_json),
    sourceSnapshot: parseJSON(row.source_snapshot),
    overrides: parseJSON(row.manual_overrides),
    minVersion: row.min_version ?? "",
    maxVersion: row.max_version ?? "",
    price: row.price,
    isFree: Boolean(row.is_free),
    status: row.status,
    publishStatus: row.publish_status,
    listingStatus: row.listing_status,
    archived: Boolean(row.archived_at),
    updatedAt: row.updated_at,
    categoryIds,
    assets: assets.map((asset) => ({ id: asset.id, role: asset.role, name: asset.file_name, contentType: asset.content_type, size: asset.size, width: asset.width, height: asset.height, sourceUrl: asset.source_url, url: `/api/assets/${asset.id}` })),
  };
}

async function catalog(productId: string, query = "", status = "all", limit = 100) {
  const db = platformEnv().DB;
  const product = await productById(productId);
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  const [categories, materials, relations, assets] = await Promise.all([
    db.prepare("SELECT id, parent_id, name, code, status, sort_order, archived_at FROM categories WHERE product_id=? ORDER BY COALESCE(parent_id, id), sort_order, created_at").bind(productId).all<Row>(),
    db.prepare("SELECT * FROM materials WHERE product_id=? AND (?='all' OR status=?) AND archived_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT ?").bind(productId, status, status, Math.min(Math.max(limit, 1), 200)).all<Row>(),
    db.prepare("SELECT material_id, category_id FROM material_categories WHERE product_id=? AND archived_at IS NULL").bind(productId).all<Row>(),
    db.prepare("SELECT * FROM assets WHERE product_id=? ORDER BY created_at").bind(productId).all<Row>(),
  ]);
  const q = query.trim().toLowerCase();
  const relationRows = relations.results;
  const materialRows = materials.results.filter((row) => !q || [row.id, row.internal_name, row.external_material_id, row.source_key].some((value) => String(value ?? "").toLowerCase().includes(q)));
  return {
    product: productDTO(product),
    categories: categories.results.map((row) => ({ id: row.id, parentId: row.parent_id ?? null, name: row.name, code: row.code, status: row.status, sortOrder: row.sort_order })),
    materials: materialRows.map((row) => materialDTO(row, assets.results.filter((asset) => asset.material_id === row.id), relationRows.filter((relation) => relation.material_id === row.id).map((relation) => String(relation.category_id)))),
    counts: { categories: categories.results.length, materials: materialRows.length },
  };
}

function errorResponse(error: unknown, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(request: Request) {
  const actor = await authorized(request);
  if (!actor) return Response.json({ error: "INVALID_MCP_TOKEN" }, { status: 401 });
  const url = new URL(request.url);
  try {
    const op = url.searchParams.get("op") ?? "products";
    const db = platformEnv().DB;
    if (op === "products") {
      const rows = await db.prepare("SELECT id, external_pid, name, channel, source, status, created_at, updated_at FROM products WHERE archived_at IS NULL ORDER BY CAST(external_pid AS INTEGER), created_at").all<Row>();
      return Response.json({ data: { products: rows.results.map(productDTO), actor } });
    }
    const product = await resolveProduct(url.searchParams.get("product"));
    if (!product) return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
    if (op === "catalog") return Response.json({ data: await catalog(String(product.id), url.searchParams.get("q") ?? "", url.searchParams.get("status") ?? "all", Number(url.searchParams.get("limit") ?? 100)) });
    if (op === "material") {
      const id = String(url.searchParams.get("id") ?? "");
      const row = await db.prepare("SELECT * FROM materials WHERE id=? AND product_id=? LIMIT 1").bind(id, product.id).first<Row>();
      if (!row) return Response.json({ error: "MATERIAL_NOT_FOUND" }, { status: 404 });
      const [assets, relations] = await Promise.all([
        db.prepare("SELECT * FROM assets WHERE material_id=? AND product_id=? ORDER BY created_at").bind(id, product.id).all<Row>(),
        db.prepare("SELECT category_id FROM material_categories WHERE material_id=? AND product_id=? AND archived_at IS NULL").bind(id, product.id).all<Row>(),
      ]);
      return Response.json({ data: materialDTO(row, assets.results, relations.results.map((item) => String(item.category_id))) });
    }
    return errorResponse("UNKNOWN_OP", 404);
  } catch (error) { return errorResponse(error, 500); }
}

export async function POST(request: Request) {
  const actor = await authorized(request);
  if (!actor) return Response.json({ error: "INVALID_MCP_TOKEN" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const product = await resolveProduct(String(body.product ?? ""));
  if (!product) return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  const productId = String(product.id); const db = platformEnv().DB; const now = nowSeconds(); const action = String(body.action ?? "");
  try {
    if (action === "create-category") {
      const name = String(body.name ?? "").trim(); if (!name) return errorResponse("CATEGORY_NAME_REQUIRED");
      const parentId = body.parentId ? String(body.parentId) : null;
      if (parentId) { const parent = await db.prepare("SELECT parent_id FROM categories WHERE id=? AND product_id=? AND archived_at IS NULL").bind(parentId, productId).first<Row>(); if (!parent || parent.parent_id) return errorResponse("PARENT_MUST_BE_ROOT_CATEGORY"); }
      const id = objectId(); const code = String(body.code ?? name.replace(/\\s+/g, "_")).trim(); const translation = JSON.stringify({ en: { code: "en", content: name, is_default: 1 } });
      const max = await db.prepare("SELECT COALESCE(MAX(sort_order),0) value FROM categories WHERE product_id=? AND parent_id IS ?").bind(productId, parentId).first<Row>();
      await db.prepare("INSERT INTO categories (id,product_id,parent_id,name,code,config,translations,marks,sort_order,status,material_latest_update_time,created_at,updated_at) VALUES (?,?,?,?,?, '',?,'[]',?,'active',0,?,?)").bind(id, productId, parentId, name, code, translation, Number(max?.value ?? 0) + 10, now, now).run();
      await audit(actor, productId, "category.created", "category", id, { name, parentId, code });
      return Response.json({ data: { id, name, code, parentId } }, { status: 201 });
    }
    if (action === "create-material" || action === "update-material") {
      const id = action === "update-material" ? String(body.id ?? "") : objectId();
      const current = action === "update-material" ? await db.prepare("SELECT * FROM materials WHERE id=? AND product_id=?").bind(id, productId).first<Row>() : null;
      if (action === "update-material" && !current) return errorResponse("MATERIAL_NOT_FOUND", 404);
      const name = String(body.name ?? current?.internal_name ?? "").trim(); const categoryId = String(body.categoryId ?? "");
      if (!name) return errorResponse("MATERIAL_NAME_REQUIRED");
      const categoryIds = Array.isArray(body.categoryIds) ? body.categoryIds.map(String) : categoryId ? [categoryId] : [];
      if (action === "create-material" && !categoryIds.length) return errorResponse("CATEGORY_REQUIRED");
      const valid = categoryIds.length ? await db.prepare(`SELECT id FROM categories WHERE product_id=? AND parent_id IS NOT NULL AND archived_at IS NULL AND id IN (${categoryIds.map(() => "?").join(",")})`).bind(productId, ...categoryIds).all<Row>() : { results: [] } as { results: Row[] };
      const validIds = valid.results.map((row) => String(row.id));
      if (action === "create-material" && !validIds.length) return errorResponse("INVALID_CHILD_CATEGORY");
      const titles = parseJSON(current?.title_translations, {}) as Row; const titleTranslations = JSON.stringify({ ...titles, en: { code: "en", content: name, is_default: 1 }, "zh-cn": { code: "zh-cn", content: String(body.nameZh ?? titles["zh-cn"]?.content ?? ""), is_default: 0 } });
      const configInput = body.configRaw === undefined ? String(current?.material_config_raw ?? JSON.stringify({ name, type: Number(body.type ?? 2) })) : String(body.configRaw); const prepared = prepareMaterialConfig(configInput); if ("error" in prepared) return errorResponse(prepared.error);
      const priceResult = parsePrice(body.price, current?.price === undefined ? 10 : current?.price === null ? null : Number(current.price)); if ("error" in priceResult) return errorResponse(priceResult.error);
      if (action === "create-material") {
        const relationIds = validIds.map(() => objectId());
        await db.batch([
          db.prepare("INSERT INTO materials (id,product_id,source_key,internal_name,title_translations,activity_translations,material_config_raw,material_config_json,source_snapshot,manual_overrides,min_version,max_version,is_free,price,listing_status,publish_status,status,created_at,updated_at) VALUES (?,?, 'manual',?,?, '{}',?,?, '{}','{}',?,?,?, ?,1,0,'draft',?,?)").bind(id, productId, name, titleTranslations, prepared.raw, JSON.stringify(prepared.config), String(body.minVersion ?? ""), String(body.maxVersion ?? ""), priceResult.value === 0 ? 1 : 0, priceResult.value, now, now),
          ...validIds.map((category, index) => db.prepare("INSERT INTO material_categories (id,product_id,material_id,category_id,sort_order,listing_status,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)").bind(relationIds[index], productId, id, category, (index + 1) * 10, now, now)),
        ]);
        await audit(actor, productId, "material.created", "material", id, { name, categoryIds: validIds });
        return Response.json({ data: { id, status: "draft", categoryIds: validIds } }, { status: 201 });
      }
      const overrides = parseJSON(current?.manual_overrides, {}) as Row;
      await db.prepare("UPDATE materials SET internal_name=?,title_translations=?,material_config_raw=?,material_config_json=?,min_version=?,max_version=?,is_free=?,price=?,manual_overrides=?,updated_at=? WHERE id=? AND product_id=?").bind(name, titleTranslations, prepared.raw, JSON.stringify(prepared.config), String(body.minVersion ?? current?.min_version ?? ""), String(body.maxVersion ?? current?.max_version ?? ""), priceResult.value === 0 ? 1 : 0, priceResult.value, JSON.stringify({ ...overrides, ...(body.overrides && typeof body.overrides === "object" ? body.overrides : {}) }), now, id, productId).run();
      if (Array.isArray(body.categoryIds)) {
        await db.prepare("UPDATE material_categories SET archived_at=?,listing_status=0,updated_at=? WHERE material_id=? AND product_id=?").bind(now, now, id, productId).run();
        for (const category of validIds) await db.prepare("INSERT INTO material_categories (id,product_id,material_id,category_id,sort_order,listing_status,created_at,updated_at) VALUES (?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+10 FROM material_categories WHERE product_id=? AND category_id=? AND archived_at IS NULL),1,?,?) ON CONFLICT(material_id,category_id) DO UPDATE SET archived_at=NULL,listing_status=1,updated_at=?").bind(objectId(), productId, id, category, productId, category, now, now, now).run();
      }
      await audit(actor, productId, "material.updated", "material", id, { name, categoryIds: body.categoryIds }); return Response.json({ data: { id, updated: true } });
    }
    if (action === "set-material-status") {
      const id = String(body.id ?? ""); const status = String(body.status ?? "draft"); if (!["draft", "published", "archived"].includes(status)) return errorResponse("INVALID_STATUS");
      if (status === "published") { const assets = await db.prepare("SELECT role,content_type FROM assets WHERE material_id=? AND product_id=?").bind(id, productId).all<Row>(); if (!assets.results.some((row) => row.role === "original")) return errorResponse("PUBLISH_REQUIRES_ORIGINAL_ASSET"); }
      const result = await db.prepare("UPDATE materials SET status=?,publish_status=?,archived_at=?,updated_at=? WHERE id=? AND product_id=?").bind(status, status === "published" ? 1 : 0, status === "archived" ? now : null, now, id, productId).run(); if (!result.meta.changes) return errorResponse("MATERIAL_NOT_FOUND", 404);
      await audit(actor, productId, `material.${status}`, "material", id, { status }); return Response.json({ data: { id, status } });
    }
    if (action === "delete-material" || action === "batch-delete-materials") {
      if (body.confirmation !== "CONFIRM_DELETE") return errorResponse("CONFIRM_DELETE_REQUIRED", 409);
      const ids = action === "delete-material" ? [String(body.id ?? "")] : Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : [];
      if (!ids.length || ids.some((id) => !id)) return errorResponse("MATERIAL_IDS_REQUIRED");
      await batchDeleteMaterials(ids, productId); await audit(actor, productId, "materials.deleted", "materials", ids.join(","), { count: ids.length });
      return Response.json({ data: { deleted: ids.length } });
    }
    return errorResponse("UNKNOWN_ACTION", 404);
  } catch (error) { return errorResponse(error, 500); }
}
