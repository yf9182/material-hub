import { initialProductId, seedCatalog } from "../../../../lib/catalog-repository";
import { nowSeconds, objectId } from "../../../../lib/material-platform";
import { adminEmail, platformEnv } from "../../../../lib/platform-runtime";

type Row = Record<string, unknown>;

function json(value: unknown, fallback: unknown = {}) {
  try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; }
}

async function audit(actor: string, productId: string, action: string, targetType: string, targetId: string, changes: Record<string, unknown>) {
  const db = platformEnv().DB; const now = nowSeconds();
  await db.prepare("INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(objectId(), productId, actor, action, targetType, targetId, JSON.stringify(changes), now).run();
}

async function validProduct(productId: string) {
  return platformEnv().DB.prepare("SELECT id, external_pid, name, channel, source FROM products WHERE id=? AND archived_at IS NULL").bind(productId).first<Row>();
}

export async function GET(request: Request) {
  const actor = adminEmail(request); if (!actor) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  await seedCatalog(); const db = platformEnv().DB; const url = new URL(request.url);
  const selectedId = url.searchParams.get("productId") || initialProductId; const product = await validProduct(selectedId);
  if (!product) return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  const [products, categories, materials, imports, keys, assets] = await Promise.all([
    db.prepare("SELECT id, external_pid, name, channel, source, status FROM products WHERE archived_at IS NULL ORDER BY created_at").all(),
    db.prepare("SELECT id, parent_id, name, code, status, sort_order, archived_at FROM categories WHERE product_id=? ORDER BY COALESCE(parent_id, id), sort_order, created_at").bind(selectedId).all(),
    db.prepare(`SELECT m.id, m.external_material_id, m.source_key, m.internal_name, m.title_translations, m.activity_translations, m.material_config_raw, m.material_config_json, m.source_snapshot, m.manual_overrides, m.status, m.publish_status, m.listing_status, m.min_version, m.max_version, m.is_free, m.archived_at, m.updated_at,
      GROUP_CONCAT(mc.category_id) category_ids, a.id asset_id
      FROM materials m LEFT JOIN material_categories mc ON mc.material_id=m.id AND mc.archived_at IS NULL
      LEFT JOIN assets a ON a.material_id=m.id AND a.role='thumbnail'
      WHERE m.product_id=? GROUP BY m.id ORDER BY m.updated_at DESC`).bind(selectedId).all(),
    db.prepare("SELECT id, mode, status, source_label, summary, created_at, completed_at FROM import_jobs WHERE product_id=? ORDER BY created_at DESC LIMIT 12").bind(selectedId).all(),
    db.prepare("SELECT id, name, prefix, last_used_at, revoked_at, created_at FROM api_keys WHERE product_id=? ORDER BY created_at DESC").bind(selectedId).all(),
    db.prepare("SELECT id, material_id, role, file_name, content_type, size, width, height, source_url FROM assets WHERE product_id=? ORDER BY created_at").bind(selectedId).all(),
  ]);
  const categoryRows = (categories.results as Row[]).map((row) => ({ ...row, archived: Boolean(row.archived_at) }));
  const assetRows = assets.results as Row[]; const materialRows = (materials.results as Row[]).map((row) => ({ ...row, category_ids: String(row.category_ids ?? "").split(",").filter(Boolean), archived: Boolean(row.archived_at), title_translations: json(row.title_translations, {}), activity_translations: json(row.activity_translations, {}), material_config_json: json(row.material_config_json, {}), manual_overrides: json(row.manual_overrides, {}), source_snapshot: json(row.source_snapshot, {}), asset_files: assetRows.filter((asset) => asset.material_id === row.id) }));
  return Response.json({ actor, product: { id: product.id, pid: product.external_pid, name: product.name, channel: product.channel, source: product.source }, products: products.results, categories: categoryRows, materials: materialRows, imports: imports.results, keys: keys.results });
}

export async function POST(request: Request) {
  const actor = adminEmail(request); if (!actor) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  await seedCatalog(); const body = await request.json() as Record<string, unknown>; const db = platformEnv().DB; const now = nowSeconds();
  const productId = String(body.productId ?? initialProductId); if (!await validProduct(productId)) return Response.json({ error: "产品不存在" }, { status: 400 });
  const action = String(body.action ?? "");

  if (action === "create-category") {
    const id = objectId(); const parentId = body.parentId ? String(body.parentId) : null;
    if (parentId) { const parent = await db.prepare("SELECT parent_id FROM categories WHERE id=? AND product_id=? AND archived_at IS NULL").bind(parentId, productId).first<Row>(); if (!parent || parent.parent_id) return Response.json({ error: "只能在一级分类下创建二级分类" }, { status: 400 }); }
    const name = String(body.name ?? "").trim(); if (!name) return Response.json({ error: "分类名称不能为空" }, { status: 400 });
    const code = String(body.code ?? name.replace(/\s+/g, "_")).trim(); const translations = JSON.stringify({ en: { code: "en", content: name, is_default: 1 } });
    const max = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) value FROM categories WHERE product_id=? AND parent_id IS ?").bind(productId, parentId).first<Row>();
    await db.prepare("INSERT INTO categories (id, product_id, parent_id, external_id, name, code, config, translations, marks, sort_order, status, material_latest_update_time, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, '', ?, '[]', ?, 'active', 0, ?, ?)").bind(id, productId, parentId, name, code, translations, Number(max?.value ?? 0) + 10, now, now).run();
    await audit(actor, productId, "category.created", "category", id, { name, parentId, code }); return Response.json({ id }, { status: 201 });
  }

  if (action === "update-category") {
    const id = String(body.id ?? ""); const current = await db.prepare("SELECT * FROM categories WHERE id=? AND product_id=?").bind(id, productId).first<Row>(); if (!current) return Response.json({ error: "分类不存在" }, { status: 404 });
    const parentId = body.parentId === undefined ? (current.parent_id as string | null) : (body.parentId ? String(body.parentId) : null); const name = String(body.name ?? current.name).trim(); const code = String(body.code ?? current.code).trim();
    if (!name || !code) return Response.json({ error: "分类名称和 Code 不能为空" }, { status: 400 });
    if (parentId) { const parent = await db.prepare("SELECT parent_id FROM categories WHERE id=? AND product_id=? AND archived_at IS NULL").bind(parentId, productId).first<Row>(); if (!parent || parent.parent_id || parentId === id) return Response.json({ error: "二级分类上级必须是一级分类" }, { status: 400 }); }
    await db.prepare("UPDATE categories SET parent_id=?, name=?, code=?, sort_order=?, updated_at=? WHERE id=? AND product_id=?").bind(parentId, name, code, Number(body.sortOrder ?? current.sort_order ?? 0), now, id, productId).run();
    await audit(actor, productId, "category.updated", "category", id, { name, code, parentId }); return Response.json({ ok: true });
  }

  if (action === "set-category-status") {
    const id = String(body.id ?? ""); const status = body.status === "archived" ? "archived" : "active"; const archivedAt = status === "archived" ? now : null;
    const result = await db.prepare("UPDATE categories SET status=?, archived_at=?, updated_at=? WHERE (id=? OR parent_id=?) AND product_id=?").bind(status, archivedAt, now, id, id, productId).run();
    if (!result.meta.changes) return Response.json({ error: "分类不存在" }, { status: 404 });
    if (status === "archived") await db.prepare("UPDATE material_categories SET listing_status=0, archived_at=?, updated_at=? WHERE category_id IN (SELECT id FROM categories WHERE (id=? OR parent_id=?) AND product_id=?) AND product_id=?").bind(now, now, id, id, productId, productId).run();
    else await db.prepare("UPDATE material_categories SET listing_status=1, archived_at=NULL, updated_at=? WHERE category_id IN (SELECT id FROM categories WHERE (id=? OR parent_id=?) AND product_id=?) AND product_id=?").bind(now, id, id, productId, productId).run();
    await audit(actor, productId, `category.${status}`, "category", id, { status }); return Response.json({ ok: true });
  }

  if (action === "create-material") {
    const id = objectId(); const relationId = objectId(); const name = String(body.name ?? "").trim(); const categoryId = String(body.categoryId ?? "");
    if (!name || !categoryId) return Response.json({ error: "名称和二级分类不能为空" }, { status: 400 });
    const category = await db.prepare("SELECT id FROM categories WHERE id=? AND product_id=? AND parent_id IS NOT NULL AND archived_at IS NULL").bind(categoryId, productId).first(); if (!category) return Response.json({ error: "二级分类无效" }, { status: 400 });
    const translations = JSON.stringify({ en: { code: "en", content: name, is_default: 1 }, "zh-cn": { code: "zh-cn", content: String(body.nameZh ?? ""), is_default: 0 } }); const configRaw = body.configRaw === undefined ? JSON.stringify({ name, type: Number(body.type ?? 2) }) : String(body.configRaw); const configJson = json(body.configJson ?? configRaw, {}); if (!configJson || typeof configJson !== "object" || Array.isArray(configJson)) return Response.json({ error: "配置必须是 JSON 对象" }, { status: 400 });
    await db.batch([
      db.prepare("INSERT INTO materials (id, product_id, source_key, internal_name, title_translations, activity_translations, material_config_raw, material_config_json, source_snapshot, manual_overrides, min_version, max_version, is_free, listing_status, publish_status, status, created_at, updated_at) VALUES (?, ?, 'manual', ?, ?, '{}', ?, ?, '{}', '{}', ?, ?, ?, 1, 0, 'draft', ?, ?)").bind(id, productId, name, translations, configRaw, JSON.stringify(configJson), String(body.minVersion ?? ""), String(body.maxVersion ?? ""), body.isFree ? 1 : 0, now, now),
      db.prepare("INSERT INTO material_categories (id, product_id, material_id, category_id, sort_order, listing_status, created_at, updated_at) VALUES (?, ?, ?, ?, 100, 1, ?, ?)").bind(relationId, productId, id, categoryId, now, now),
    ]);
    await audit(actor, productId, "material.created", "material", id, { categoryId, name }); return Response.json({ id }, { status: 201 });
  }

  if (action === "update-material") {
    const id = String(body.id ?? ""); const current = await db.prepare("SELECT * FROM materials WHERE id=? AND product_id=?").bind(id, productId).first<Row>(); if (!current) return Response.json({ error: "素材不存在" }, { status: 404 });
    const name = String(body.name ?? current.internal_name).trim(); if (!name) return Response.json({ error: "素材名称不能为空" }, { status: 400 });
    const previousTitles = json(current.title_translations, {}) as Record<string, unknown>; const titles = JSON.stringify({ ...previousTitles, en: { code: "en", content: name, is_default: 1 }, "zh-cn": { code: "zh-cn", content: String(body.nameZh ?? (json(previousTitles, {}) as Row)["zh-cn"]?.content ?? ""), is_default: 0 } });
    const configRaw = body.configRaw === undefined ? String(current.material_config_raw ?? "{}") : String(body.configRaw); const configJson = json(body.configJson ?? configRaw, {}); if (!configJson || typeof configJson !== "object" || Array.isArray(configJson)) return Response.json({ error: "配置必须是 JSON 对象" }, { status: 400 });
    const overrides = json(current.manual_overrides, {}) as Row; const mergedOverrides = { ...overrides, ...(body.overrides && typeof body.overrides === "object" ? body.overrides : {}) };
    await db.prepare("UPDATE materials SET internal_name=?, title_translations=?, material_config_raw=?, material_config_json=?, min_version=?, max_version=?, is_free=?, manual_overrides=?, updated_at=? WHERE id=? AND product_id=?").bind(name, titles, configRaw, JSON.stringify(configJson), String(body.minVersion ?? current.min_version ?? ""), String(body.maxVersion ?? current.max_version ?? ""), body.isFree === undefined ? Number(current.is_free ?? 0) : (body.isFree ? 1 : 0), JSON.stringify(mergedOverrides), now, id, productId).run();
    if (Array.isArray(body.categoryIds)) {
      const categoryIds = body.categoryIds.map(String); const valid = await db.prepare(`SELECT id FROM categories WHERE product_id=? AND parent_id IS NOT NULL AND archived_at IS NULL AND id IN (${categoryIds.map(() => "?").join(",") || "NULL"})`).bind(productId, ...categoryIds).all<Row>(); const validIds = new Set(valid.results.map((row) => String(row.id)));
      await db.prepare("UPDATE material_categories SET archived_at=?, listing_status=0, updated_at=? WHERE material_id=? AND product_id=?").bind(now, now, id, productId).run();
      for (const categoryId of categoryIds.filter((value) => validIds.has(value))) await db.prepare("INSERT INTO material_categories (id, product_id, material_id, category_id, sort_order, listing_status, created_at, updated_at) VALUES (?, ?, ?, ?, 100, 1, ?, ?) ON CONFLICT(material_id, category_id) DO UPDATE SET archived_at=NULL, listing_status=1, updated_at=?").bind(objectId(), productId, id, categoryId, now, now, now).run();
    }
    await audit(actor, productId, "material.updated", "material", id, { name, categoryIds: body.categoryIds }); return Response.json({ ok: true });
  }

  if (action === "set-status") {
    const id = String(body.id ?? ""); const status = String(body.status ?? "draft"); const published = status === "published";
    if (published) { const media = await db.prepare("SELECT role, content_type FROM assets WHERE material_id=?").bind(id).all<Row>(); const rows = media.results; if (!rows.some((item) => item.role === "original")) return Response.json({ error: "发布前必须上传主素材文件" }, { status: 400 }); if (rows.some((item) => String(item.content_type).startsWith("video/")) && !rows.some((item) => item.role === "thumbnail")) return Response.json({ error: "视频发布前必须上传封面" }, { status: 400 }); }
    const archivedAt = status === "archived" ? now : null; const result = await db.prepare("UPDATE materials SET status=?, publish_status=?, archived_at=?, updated_at=? WHERE id=? AND product_id=?").bind(status, published ? 1 : 0, archivedAt, now, id, productId).run(); if (!result.meta.changes) return Response.json({ error: "素材不存在" }, { status: 404 });
    await audit(actor, productId, `material.${status}`, "material", id, { status }); return Response.json({ ok: true });
  }
  return Response.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
