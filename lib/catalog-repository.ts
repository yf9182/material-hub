import { platformEnv } from "./platform-runtime";
import { ensureSchema } from "./ensure-schema";
import { emptyIndependentKeys, langMap, nowSeconds, objectId, parseJsonObject, propertyData, propertyValue, safeObject, translationData, wrapper, type ImportManifest } from "./material-platform";

const productId = "880100000000000000000001";

export async function seedCatalog() {
  await ensureSchema();
  const db = platformEnv().DB;
  const now = nowSeconds();
  await db.prepare("INSERT OR IGNORE INTO products (id, external_pid, name, channel, source, status, created_at, updated_at) VALUES (?, '8801', 'VikPea · English', 'English', 'English', 'active', ?, ?)").bind(productId, now, now).run();
}

type Row = Record<string, unknown>;
const parse = <T>(value: unknown, fallback: T): T => { try { return typeof value === "string" ? JSON.parse(value) as T : (value as T) ?? fallback; } catch { return fallback; } };

export async function productByPid(pid: string) {
  return platformEnv().DB.prepare("SELECT * FROM products WHERE external_pid = ? AND archived_at IS NULL LIMIT 1").bind(pid).first<Row>();
}

export async function categoryTree(product: Row) {
  const rows = (await platformEnv().DB.prepare("SELECT * FROM categories WHERE product_id = ? AND status = 'active' AND archived_at IS NULL ORDER BY sort_order, created_at").bind(product.id).all<Row>()).results;
  return rows.filter((row) => !row.parent_id).map((root) => categoryNode(root, rows.filter((row) => row.parent_id === root.id).map((row) => categoryNode(row, []))));
}

function categoryNode(row: Row, children: unknown[]) {
  return { id: row.id, parent_id: row.parent_id ?? "", name: row.name, code: row.code, config: row.config ?? "", translation: { id: `${String(row.id).slice(0, 22)}t1`, lang: parse(row.translations, {}) }, marks: parse(row.marks, []), children, create_time: row.created_at, update_time: row.updated_at, material_latest_update_time: row.material_latest_update_time ?? 0 };
}

export async function materialGroups(product: Row, categoryIds: string[], page: number, pageSize: number) {
  const groups = [];
  for (const categoryId of categoryIds) {
    const category = await platformEnv().DB.prepare("SELECT id FROM categories WHERE id = ? AND product_id = ? AND parent_id IS NOT NULL AND status = 'active' AND archived_at IS NULL").bind(categoryId, product.id).first();
    if (!category) continue;
    const count = await platformEnv().DB.prepare(`SELECT COUNT(*) total FROM material_categories r JOIN materials m ON m.id = r.material_id WHERE r.category_id = ? AND r.archived_at IS NULL AND r.listing_status = 1 AND m.publish_status = 1 AND m.status = 'published' AND m.archived_at IS NULL`).bind(categoryId).first<{ total: number }>();
    const rows = (await platformEnv().DB.prepare(`SELECT r.id relation_id, r.listing_status relation_listing_status, r.created_at relation_created_at, r.updated_at relation_updated_at, m.* FROM material_categories r JOIN materials m ON m.id = r.material_id WHERE r.category_id = ? AND r.archived_at IS NULL AND r.listing_status = 1 AND m.publish_status = 1 AND m.status = 'published' AND m.archived_at IS NULL ORDER BY r.sort_order, r.created_at DESC LIMIT ? OFFSET ?`).bind(categoryId, pageSize, (page - 1) * pageSize).all<Row>()).results;
    const list = [];
    for (const row of rows) list.push(await materialDto(row));
    groups.push({ pager: { page, page_size: pageSize, total: Number(count?.total ?? 0) }, product_material_category_id: categoryId, list });
  }
  return groups;
}

async function materialDto(row: Row) {
  const overrides = parse<Record<string, unknown>>(row.manual_overrides, {});
  const effective = { ...row, ...overrides };
  const assets = (await platformEnv().DB.prepare("SELECT * FROM assets WHERE material_id = ? ORDER BY created_at").bind(row.id).all<Row>()).results;
  const asset = (role: string) => assets.find((item) => item.role === role) ?? (role === "original" ? assets.find((item) => item.role === "thumbnail") : undefined);
  const file = (item?: Row) => item ? { cdn_url: `/api/assets/${item.id}`, hash: item.hash ?? "", id: item.id, name: item.file_name, size: item.size ?? 0 } : {};
  const config = parseJsonObject(String(effective.material_config_raw ?? "")) ?? {}; const mediaType = Number(config.type ?? 0); const fileUrl = typeof config.file_url === "string" ? config.file_url : ""; const originalAsset = asset("original"); const originalFile = mediaType === 1 && fileUrl ? { cdn_url: fileUrl, hash: "", id: fileUrl, name: "file_url", size: 0 } : file(originalAsset);
  const titleLang = parse<Record<string, unknown>>(effective.title_translations, {});
  const activityLang = parse<Record<string, unknown>>(effective.activity_translations, {});
  const independent: Record<string, unknown> = {};
  for (const key of emptyIndependentKeys) independent[key] = wrapper(key, key === "min_version" && row.min_version ? [row.min_version] : []);
  independent.material_internal_name = wrapper("material_internal_name", [effective.internal_name]);
  independent.material_lang = wrapper("material_lang", [`${String(row.id).slice(0, 22)}l1`], { id: `${String(row.id).slice(0, 22)}l1`, lang: titleLang });
  independent.activity_lang = wrapper("activity_lang", [`${String(row.id).slice(0, 22)}l2`], { id: `${String(row.id).slice(0, 22)}l2`, lang: activityLang });
  independent.thumbnail_file_id = wrapper("thumbnail_file_id", asset("thumbnail") ? [asset("thumbnail")!.id] : [], file(asset("thumbnail")));
  independent.video_preview_file_id = wrapper("video_preview_file_id", asset("preview") ? [asset("preview")!.id] : [], file(asset("preview")));
  const publicProperties: Record<string, unknown> = { material_config: wrapper("material_config", [effective.material_config_raw]), original_file_id: wrapper("original_file_id", originalAsset ? [originalAsset.id] : [], file(originalAsset)), relation_id: wrapper("relation_id", [""]) }; if (mediaType === 1) publicProperties.file_url = wrapper("file_url", fileUrl ? [fileUrl] : [], fileUrl ? originalFile : {});
  return { id: row.relation_id, material_id: row.id, public_properties: publicProperties, independent_properties: independent, user_behaviors: [], listing_status: row.relation_listing_status, publish_status: effective.publish_status, create_time: row.relation_created_at, update_time: row.relation_updated_at };
}

export async function importManifest(product: Row, manifest: ImportManifest, actor: string) {
  const db = platformEnv().DB; const now = nowSeconds(); let created = 0, updated = 0, failed = 0;
  for (const node of manifest.categories) {
    const id = String(node.id ?? objectId()); const parent = String(node.parent_id ?? "") || null;
    const exists = await db.prepare("SELECT id FROM categories WHERE product_id = ? AND external_id = ?").bind(product.id, id).first();
    const translations = JSON.stringify(langMap(safeObject(safeObject(node.translation).lang)));
    await db.prepare(`INSERT INTO categories (id, product_id, parent_id, external_id, name, code, config, translations, marks, sort_order, status, material_latest_update_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?) ON CONFLICT(product_id, external_id) DO UPDATE SET parent_id=excluded.parent_id, name=excluded.name, code=excluded.code, config=excluded.config, translations=excluded.translations, marks=excluded.marks, updated_at=excluded.updated_at`)
      .bind(id, product.id, parent, id, String(node.name ?? ""), String(node.code ?? node.name ?? ""), String(node.config ?? ""), translations, JSON.stringify(node.marks ?? []), Number(node.material_latest_update_time ?? 0), Number(node.create_time ?? now), now).run();
    if (exists) updated++; else created++;
  }
  for (const group of manifest.groups) for (const item of group.items) {
    try {
      const relationId = String(item.id ?? objectId()); const materialId = String(item.material_id ?? objectId());
      const exists = await db.prepare("SELECT id FROM materials WHERE product_id = ? AND source_key = 'reference' AND external_material_id = ?").bind(product.id, materialId).first();
      const rawConfig = String(propertyValue(item, "public_properties", "material_config") ?? "{}");
      const internalName = String(propertyValue(item, "independent_properties", "material_internal_name") || materialId);
      await db.prepare(`INSERT INTO materials (id, product_id, external_material_id, source_key, internal_name, title_translations, activity_translations, material_config_raw, material_config_json, source_snapshot, manual_overrides, min_version, max_version, is_free, listing_status, publish_status, status, created_at, updated_at) VALUES (?, ?, ?, 'reference', ?, ?, ?, ?, ?, ?, '{}', ?, ?, 0, ?, ?, ?, ?, ?) ON CONFLICT(product_id, source_key, external_material_id) DO UPDATE SET internal_name=excluded.internal_name, title_translations=excluded.title_translations, activity_translations=excluded.activity_translations, material_config_raw=excluded.material_config_raw, material_config_json=excluded.material_config_json, source_snapshot=excluded.source_snapshot, min_version=excluded.min_version, max_version=excluded.max_version, listing_status=excluded.listing_status, publish_status=excluded.publish_status, status=excluded.status, updated_at=excluded.updated_at`)
        .bind(materialId, product.id, materialId, internalName, JSON.stringify(translationData(item, "material_lang")), JSON.stringify(translationData(item, "activity_lang")), rawConfig, JSON.stringify(parseJsonObject(rawConfig)), JSON.stringify(item), String(propertyValue(item, "independent_properties", "min_version") ?? ""), String(propertyValue(item, "independent_properties", "max_version") ?? ""), Number(item.listing_status ?? 1), Number(item.publish_status ?? 0), Number(item.publish_status ?? 0) ? "published" : "draft", Number(item.create_time ?? now), now).run();
      await db.prepare(`INSERT INTO material_categories (id, product_id, material_id, category_id, external_relation_id, sort_order, listing_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT(material_id, category_id) DO UPDATE SET external_relation_id=excluded.external_relation_id, listing_status=excluded.listing_status, updated_at=excluded.updated_at`)
        .bind(relationId, product.id, materialId, group.categoryId, relationId, Number(item.listing_status ?? 1), Number(item.create_time ?? now), now).run();
      for (const [role, section, key] of [["original", "public_properties", "original_file_id"], ["thumbnail", "independent_properties", "thumbnail_file_id"], ["preview", "independent_properties", "video_preview_file_id"]] as const) {
        const data = propertyData(item, section, key); const url = String(data.cdn_url ?? ""); if (!url) continue;
        const currentAsset = await db.prepare("SELECT id FROM assets WHERE material_id = ? AND role = ? LIMIT 1").bind(materialId, role).first<Row>();
        if (!currentAsset) {
          let assetId = String(data.id ?? objectId()).padStart(24, "0").slice(-24);
          const conflictingAsset = await db.prepare("SELECT material_id, role FROM assets WHERE id = ? LIMIT 1").bind(assetId).first<Row>();
          if (conflictingAsset && (String(conflictingAsset.material_id) !== materialId || String(conflictingAsset.role) !== role)) assetId = objectId();
          const r2Key = `${product.external_pid}/${materialId}/${role}-${assetId}`;
          let contentType = "application/octet-stream";
          try {
            const response = await fetch(url);
            if (response.ok && response.body) {
              contentType = response.headers.get("content-type") ?? contentType;
              await platformEnv().MATERIAL_ASSETS.put(r2Key, response.body, { httpMetadata: { contentType } });
            }
          } catch { /* keep the source URL; the asset route retries lazily */ }
          await db.prepare("INSERT INTO assets (id, product_id, material_id, role, r2_key, source_url, file_name, content_type, size, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(assetId, product.id, materialId, role, r2Key, url, String(data.name ?? `${role}-${assetId}`), contentType, Number(data.size ?? 0), String(data.hash ?? ""), now, now).run();
        }
      }
      if (exists) updated++; else created++;
    } catch { failed++; }
  }
  await db.prepare("INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at) VALUES (?, ?, ?, 'import.completed', 'import', ?, ?, ?)").bind(objectId(), product.id, actor, objectId(), JSON.stringify({ created, updated, failed }), now).run();
  return { created, updated, failed };
}

export const initialProductId = productId;
