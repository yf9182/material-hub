import { importManifest, productById, productByPid, seedCatalog } from "../../../../lib/catalog-repository";
import { isMaterialImportId, normalizeReferencePayload, normalizeSingleMaterialPayload, nowSeconds, objectId, preferredTitle, propertyValue, translationData } from "../../../../lib/material-platform";
import { adminEmail, platformEnv } from "../../../../lib/platform-runtime";

function referenceHeaders() {
  const env = platformEnv(); if (!env.REFERENCE_API_USERNAME || !env.REFERENCE_API_PASSWORD) throw new Error("尚未配置参考接口凭据");
  return { authorization: `Basic ${btoa(`${env.REFERENCE_API_USERNAME}:${env.REFERENCE_API_PASSWORD}`)}` };
}

async function fetchReference(categoryIds?: string) {
  const env = platformEnv();
  const base = env.REFERENCE_API_BASE_URL ?? "https://nmaterial-api.afirstsoft.cn";
  const path = categoryIds ? "/api/v1/product-material/category-group/list" : "/api/v1/product-material-category/ids/tree-list";
  const query = new URLSearchParams({ page: "1", page_size: "100", pid: "8801", channel: "English", source: "English" }); if (categoryIds) query.set("product_material_category_ids", categoryIds);
  const response = await fetch(`${base}${path}?${query}`, { headers: referenceHeaders() });
  if (!response.ok) throw new Error(`参考接口请求失败：${response.status}`); return response.json();
}

async function fetchReferenceMaterial(materialId: string) {
  const base = (platformEnv().REFERENCE_API_BASE_URL ?? "https://nmaterial-api.afirstsoft.cn").replace(/\/+$/, "");
  const response = await fetch(`${base}/api/v1/product-material/id/${encodeURIComponent(materialId)}`, { headers: referenceHeaders() });
  if (response.status === 404) throw new Error("参考接口中未找到该素材");
  if (!response.ok) throw new Error(`参考接口请求失败：${response.status}`);
  return response.json();
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
    let manifests;
    let product = await productByPid("8801");
    let sourceLabel = mode === "reference" ? "参考接口" : "JSON 导入";
    let preview: Record<string, unknown> | undefined;
    if (mode === "material-id") {
      const materialId = String(body.materialId ?? "").trim().toLowerCase();
      const productId = String(body.productId ?? "").trim();
      const categoryId = String(body.categoryId ?? "").trim();
      if (!isMaterialImportId(materialId)) throw new Error("素材 ID 必须是 24 位十六进制字符");
      product = await productById(productId);
      if (!product) throw new Error("产品不存在或已归档");
      const category = await platformEnv().DB.prepare("SELECT id, name, parent_id FROM categories WHERE id=? AND product_id=? AND parent_id IS NOT NULL AND status='active' AND archived_at IS NULL LIMIT 1").bind(categoryId, product.id).first<Record<string, unknown>>();
      if (!category) throw new Error("目标分类必须是当前产品中有效的二级分类");
      const manifest = normalizeSingleMaterialPayload(await fetchReferenceMaterial(materialId), categoryId);
      const item = manifest.groups[0].items[0];
      const externalMaterialId = String(item.material_id ?? item.id ?? materialId);
      const existing = await platformEnv().DB.prepare("SELECT id FROM materials WHERE product_id=? AND source_key='reference' AND external_material_id=? LIMIT 1").bind(product.id, externalMaterialId).first();
      const internalName = String(propertyValue(item, "independent_properties", "material_internal_name") || externalMaterialId);
      preview = { materialId: externalMaterialId, title: preferredTitle(translationData(item, "material_lang"), internalName), categoryId, categoryName: category.name, existing: Boolean(existing), assets: manifest.summary.assets };
      manifests = [manifest];
      sourceLabel = `按 ID 导入 · ${materialId}`;
    } else if (mode === "reference") {
      const scoped = scopeNanoBananaTree(await fetchReference());
      const categoryIds = String(body.categoryIds ?? scoped.childIds.join(","));
      if (!categoryIds) throw new Error("Nano Banana 没有可同步的二级分类");
      manifests = [normalizeReferencePayload(scoped.payload), normalizeReferencePayload(await fetchReference(categoryIds))];
    } else manifests = [normalizeReferencePayload(typeof body.payload === "string" ? JSON.parse(body.payload) : body.payload)];
    const summary = manifests.reduce((sum, item) => ({ categories: sum.categories + item.summary.categories, materials: sum.materials + item.summary.materials, assets: sum.assets + item.summary.assets, warnings: sum.warnings + item.summary.warnings }), { categories: 0, materials: 0, assets: 0, warnings: 0 });
    if (!body.commit) return Response.json({ summary, kinds: manifests.map((item) => item.kind), preview });
    if (!product) throw new Error("产品不存在"); const now = nowSeconds(); const jobId = objectId();
    await platformEnv().DB.prepare("INSERT INTO import_jobs (id, product_id, mode, status, source_label, manifest, summary, created_by, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)")
      .bind(jobId, product.id, mode, sourceLabel, JSON.stringify({ kinds: manifests.map((m) => m.kind), preview }), JSON.stringify(summary), actor, now, now).run();
    const items = manifests.flatMap((manifest) => manifest.kind === "category-tree"
      ? manifest.categories.map((category) => ({ kind: "category", manifest: { kind: "category-tree", categories: [category], groups: [], summary: { categories: 1, materials: 0, assets: 0, warnings: 0 } } }))
      : manifest.groups.flatMap((group) => group.items.map((item, index) => ({ kind: "material", manifest: { kind: "material-groups", categories: [], groups: [{ categoryId: group.categoryId, items: [item], ...(mode === "material-id" ? {} : { sortOrder: (index + 1) * 10 }) }], summary: { categories: 1, materials: 1, assets: 0, warnings: 0 } } }))));
    for (const item of items) await platformEnv().DB.prepare("INSERT INTO import_items (id, job_id, item_type, status, payload, attempts, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?)").bind(objectId(), jobId, item.kind, JSON.stringify(item.manifest), now, now).run();
    return Response.json({ summary, ...(await processJob(jobId, actor)) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 }); }
}

async function processJob(jobId: string, actor: string) {
  const db = platformEnv().DB; const job = await db.prepare("SELECT * FROM import_jobs WHERE id=? LIMIT 1").bind(jobId).first<Record<string, unknown>>(); if (!job) throw new Error("导入任务不存在");
  const product = await productById(String(job.product_id)); if (!product) throw new Error("导入产品无效");
  const pending = (await db.prepare("SELECT * FROM import_items WHERE job_id=? AND status IN ('pending','failed') AND attempts < 3 ORDER BY created_at LIMIT 5").bind(jobId).all<Record<string, unknown>>()).results;
  let created = 0, updated = 0, linked = 0, failed = 0;
  for (const item of pending) {
    try { await db.prepare("UPDATE import_items SET status='processing', attempts=attempts+1, updated_at=? WHERE id=?").bind(nowSeconds(), item.id).run(); const result = await importManifest(product, JSON.parse(String(item.payload)), actor); created += result.created; updated += result.updated; linked += result.linked; failed += result.failed; await db.prepare("UPDATE import_items SET status=?, result=?, error=NULL, updated_at=? WHERE id=?").bind(result.failed ? "failed" : "completed", JSON.stringify(result), nowSeconds(), item.id).run(); }
    catch (error) { failed++; await db.prepare("UPDATE import_items SET status='failed', error=?, updated_at=? WHERE id=?").bind(error instanceof Error ? error.message : "处理失败", nowSeconds(), item.id).run(); }
  }
  const remaining = await db.prepare("SELECT COUNT(*) total FROM import_items WHERE job_id=? AND status IN ('pending','processing','failed') AND attempts < 3").bind(jobId).first<{total:number}>(); const pendingCount = Number(remaining?.total ?? 0);
  const exhausted = await db.prepare("SELECT COUNT(*) total FROM import_items WHERE job_id=? AND status='failed' AND attempts >= 3").bind(jobId).first<{total:number}>(); const exhaustedCount = Number(exhausted?.total ?? 0); const status = pendingCount ? "running" : exhaustedCount ? "failed" : "completed";
  await db.prepare("UPDATE import_jobs SET status=?, completed_at=?, updated_at=? WHERE id=?").bind(status, status === "completed" ? nowSeconds() : null, nowSeconds(), jobId).run();
  return { jobId, status, pending: pendingCount, results: [{ created, updated, linked, failed }] };
}
