import { importManifest, productByPid, seedCatalog } from "../../../../lib/catalog-repository";
import { normalizeReferencePayload, nowSeconds, objectId } from "../../../../lib/material-platform";
import { adminEmail, platformEnv } from "../../../../lib/platform-runtime";

async function fetchReference(categoryIds?: string) {
  const env = platformEnv(); if (!env.REFERENCE_API_USERNAME || !env.REFERENCE_API_PASSWORD) throw new Error("尚未配置参考接口凭据");
  const base = env.REFERENCE_API_BASE_URL ?? "https://nmaterial-api.afirstsoft.cn";
  const path = categoryIds ? "/api/v1/product-material/category-group/list" : "/api/v1/product-material-category/ids/tree-list";
  const query = new URLSearchParams({ page: "1", page_size: "100", pid: "8801", channel: "English", source: "English" }); if (categoryIds) query.set("product_material_category_ids", categoryIds);
  const response = await fetch(`${base}${path}?${query}`, { headers: { authorization: `Basic ${btoa(`${env.REFERENCE_API_USERNAME}:${env.REFERENCE_API_PASSWORD}`)}` } });
  if (!response.ok) throw new Error(`参考接口请求失败：${response.status}`); return response.json();
}

function scopeNanoBananaTree(payload: unknown) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : {};
  const list = Array.isArray(data.list) ? data.list as Record<string, unknown>[] : [];
  const nano = list.find((item) => String(item.name ?? "").includes("Nano_Banana") || String(item.code ?? "").includes("Nano_Banana"));
  if (!nano) throw new Error("参考接口中未找到 Nano Banana 一级分类");
  return { payload: { ...root, data: { ...data, list: [nano] } }, childIds: Array.isArray(nano.children) ? (nano.children as Record<string, unknown>[]).map((item) => String(item.id ?? "")).filter(Boolean) : [] };
}

export async function POST(request: Request) {
  const actor = await adminEmail(request); if (!actor) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  try {
    await seedCatalog(); const body = await request.json() as Record<string, unknown>; const mode = String(body.mode ?? "json");
    if (body.resumeJobId) return Response.json(await processJob(String(body.resumeJobId), actor));
    let payloads: unknown[];
    if (mode === "reference") {
      const scoped = scopeNanoBananaTree(await fetchReference());
      const categoryIds = String(body.categoryIds ?? scoped.childIds.join(","));
      if (!categoryIds) throw new Error("Nano Banana 没有可同步的二级分类");
      payloads = [scoped.payload, await fetchReference(categoryIds)];
    } else payloads = [typeof body.payload === "string" ? JSON.parse(body.payload) : body.payload];
    const manifests = payloads.map(normalizeReferencePayload); const summary = manifests.reduce((sum, item) => ({ categories: sum.categories + item.summary.categories, materials: sum.materials + item.summary.materials, assets: sum.assets + item.summary.assets, warnings: sum.warnings + item.summary.warnings }), { categories: 0, materials: 0, assets: 0, warnings: 0 });
    if (!body.commit) return Response.json({ summary, kinds: manifests.map((item) => item.kind) });
    const product = await productByPid("8801"); if (!product) throw new Error("产品不存在"); const now = nowSeconds(); const jobId = objectId();
    await platformEnv().DB.prepare("INSERT INTO import_jobs (id, product_id, mode, status, source_label, manifest, summary, created_by, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)")
      .bind(jobId, product.id, mode, mode === "reference" ? "参考接口" : "JSON 导入", JSON.stringify({ kinds: manifests.map((m) => m.kind) }), JSON.stringify(summary), actor, now, now).run();
    const items = manifests.flatMap((manifest) => manifest.kind === "category-tree"
      ? manifest.categories.map((category) => ({ kind: "category", manifest: { kind: "category-tree", categories: [category], groups: [], summary: { categories: 1, materials: 0, assets: 0, warnings: 0 } } }))
      : manifest.groups.flatMap((group) => group.items.map((item) => ({ kind: "material", manifest: { kind: "material-groups", categories: [], groups: [{ categoryId: group.categoryId, items: [item] }], summary: { categories: 1, materials: 1, assets: 0, warnings: 0 } } }))));
    for (const item of items) await platformEnv().DB.prepare("INSERT INTO import_items (id, job_id, item_type, status, payload, attempts, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?)").bind(objectId(), jobId, item.kind, JSON.stringify(item.manifest), now, now).run();
    return Response.json({ summary, ...(await processJob(jobId, actor)) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 }); }
}

async function processJob(jobId: string, actor: string) {
  const db = platformEnv().DB; const job = await db.prepare("SELECT * FROM import_jobs WHERE id=? LIMIT 1").bind(jobId).first<Record<string, unknown>>(); if (!job) throw new Error("导入任务不存在");
  const product = await productByPid("8801"); if (!product || product.id !== job.product_id) throw new Error("导入产品无效");
  const pending = (await db.prepare("SELECT * FROM import_items WHERE job_id=? AND status IN ('pending','failed') AND attempts < 3 ORDER BY created_at LIMIT 5").bind(jobId).all<Record<string, unknown>>()).results;
  let created = 0, updated = 0, failed = 0;
  for (const item of pending) {
    try { await db.prepare("UPDATE import_items SET status='processing', attempts=attempts+1, updated_at=? WHERE id=?").bind(nowSeconds(), item.id).run(); const result = await importManifest(product, JSON.parse(String(item.payload)), actor); created += result.created; updated += result.updated; failed += result.failed; await db.prepare("UPDATE import_items SET status=?, result=?, error=NULL, updated_at=? WHERE id=?").bind(result.failed ? "failed" : "completed", JSON.stringify(result), nowSeconds(), item.id).run(); }
    catch (error) { failed++; await db.prepare("UPDATE import_items SET status='failed', error=?, updated_at=? WHERE id=?").bind(error instanceof Error ? error.message : "处理失败", nowSeconds(), item.id).run(); }
  }
  const remaining = await db.prepare("SELECT COUNT(*) total FROM import_items WHERE job_id=? AND status IN ('pending','processing','failed') AND attempts < 3").bind(jobId).first<{total:number}>(); const pendingCount = Number(remaining?.total ?? 0); const status = pendingCount ? "running" : "completed";
  await db.prepare("UPDATE import_jobs SET status=?, completed_at=?, updated_at=? WHERE id=?").bind(status, status === "completed" ? nowSeconds() : null, nowSeconds(), jobId).run();
  return { jobId, status, pending: pendingCount, results: [{ created, updated, failed }] };
}
