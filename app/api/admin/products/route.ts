import { initialProductId, seedCatalog } from "../../../../lib/catalog-repository";
import { nowSeconds, objectId } from "../../../../lib/material-platform";
import { adminEmail, platformEnv } from "../../../../lib/platform-runtime";

type ProductRow = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

export async function GET(request: Request) {
  const actor = await adminEmail(request);
  if (!actor) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  await seedCatalog();
  const rows = await platformEnv().DB.prepare("SELECT id, external_pid, name, channel, source, status FROM products WHERE archived_at IS NULL ORDER BY CAST(external_pid AS INTEGER), created_at").all<ProductRow>();
  return Response.json({ products: rows.results });
}

export async function POST(request: Request) {
  const actor = await adminEmail(request);
  if (!actor) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  await seedCatalog();
  const body = await request.json() as Record<string, unknown>;
  const db = platformEnv().DB;
  const name = text(body.name);
  if (!name) return Response.json({ error: "产品名称不能为空" }, { status: 400 });

  let pid = text(body.externalPid);
  if (pid) {
    if (!/^\d+$/.test(pid) || Number(pid) < 8802) return Response.json({ error: "新产品 PID 必须是未占用且不小于 8802 的数字" }, { status: 400 });
    const duplicate = await db.prepare("SELECT id FROM products WHERE external_pid=? LIMIT 1").bind(pid).first<ProductRow>();
    if (duplicate) return Response.json({ error: "PID 已被占用" }, { status: 409 });
  } else {
    const maxRow = await db.prepare("SELECT MAX(CAST(external_pid AS INTEGER)) AS max_pid FROM products WHERE CAST(external_pid AS INTEGER) >= 8802").first<{ max_pid?: number }>();
    pid = String(Math.max(8801, Number(maxRow?.max_pid ?? 8801)) + 1);
  }

  const id = objectId();
  const now = nowSeconds();
  const channel = text(body.channel, "English") || "English";
  const source = text(body.source, "English") || "English";
  await db.prepare("INSERT INTO products (id, external_pid, name, channel, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)")
    .bind(id, pid, name, channel, source, now, now).run();

  const rootName = text(body.rootName, name) || name;
  const rootCode = text(body.rootCode, "Nano_Banana") || "Nano_Banana";
  const rootId = objectId();
  await db.prepare("INSERT INTO categories (id, product_id, parent_id, external_id, name, code, config, translations, marks, sort_order, status, material_latest_update_time, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?, '', ?, '[]', 10, 'active', 0, ?, ?)")
    .bind(rootId, id, rootName, rootCode, JSON.stringify({ en: { code: "en", content: rootName, is_default: 1 } }), now, now).run();

  const categoryNames = Array.isArray(body.categories) ? body.categories.map((item) => text(item)).filter(Boolean) : ["Festival", "Poster", "3D", "Video"];
  const uniqueNames = [...new Set(categoryNames)].slice(0, 20);
  await db.batch(uniqueNames.map((categoryName, index) => {
    const categoryId = objectId();
    const code = categoryName.replace(/\s+/g, "_");
    return db.prepare("INSERT INTO categories (id, product_id, parent_id, external_id, name, code, config, translations, marks, sort_order, status, material_latest_update_time, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, '', ?, '[]', ?, 'active', 0, ?, ?)")
      .bind(categoryId, id, rootId, categoryName, code, JSON.stringify({ en: { code: "en", content: categoryName, is_default: 1 } }), (index + 1) * 10, now, now);
  }));
  await db.prepare("INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at) VALUES (?, ?, ?, 'product.created', 'product', ?, ?, ?)")
    .bind(objectId(), id, actor, id, JSON.stringify({ pid, name, categories: uniqueNames }), now).run();
  return Response.json({ id, external_pid: pid, name, root_id: rootId, categories: uniqueNames }, { status: 201 });
}
