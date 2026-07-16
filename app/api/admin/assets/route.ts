import { initialProductId, seedCatalog } from "../../../../lib/catalog-repository";
import { nowSeconds, objectId } from "../../../../lib/material-platform";
import { adminEmail, platformEnv } from "../../../../lib/platform-runtime";

export async function POST(request: Request) {
  const actor = adminEmail(request); if (!actor) return Response.json({ error: "FORBIDDEN" }, { status: 403 }); await seedCatalog();
  const form = await request.formData(); const file = form.get("file"); const materialId = String(form.get("materialId") ?? ""); const requestedRole = String(form.get("role") ?? "original");
  if (!(file instanceof File) || !materialId) return Response.json({ error: "文件和素材 ID 不能为空" }, { status: 400 });
  if (!["original", "thumbnail", "preview"].includes(requestedRole)) return Response.json({ error: "不支持的素材角色" }, { status: 400 });
  const material = await platformEnv().DB.prepare("SELECT id FROM materials WHERE id=? AND product_id=? AND archived_at IS NULL").bind(materialId, initialProductId).first();
  if (!material) return Response.json({ error: "素材不存在" }, { status: 404 });
  const id = objectId(); const now = nowSeconds(); const r2Key = `8801/${materialId}/${requestedRole}-${id}`; const contentType = file.type || "application/octet-stream";
  await platformEnv().MATERIAL_ASSETS.put(r2Key, file.stream(), { httpMetadata: { contentType } });
  const statements = [platformEnv().DB.prepare("DELETE FROM assets WHERE material_id=? AND role=?").bind(materialId, requestedRole), platformEnv().DB.prepare("INSERT INTO assets (id, product_id, material_id, role, r2_key, file_name, content_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, initialProductId, materialId, requestedRole, r2Key, file.name, contentType, file.size, now, now)];
  if (requestedRole === "original" && contentType.startsWith("image/")) statements.unshift(platformEnv().DB.prepare("DELETE FROM assets WHERE material_id=? AND role=?").bind(materialId, "thumbnail"));
  if (requestedRole === "original" && contentType.startsWith("image/")) statements.push(platformEnv().DB.prepare("INSERT INTO assets (id, product_id, material_id, role, r2_key, file_name, content_type, size, created_at, updated_at) VALUES (?, ?, ?, 'thumbnail', ?, ?, ?, ?, ?, ?)").bind(objectId(), initialProductId, materialId, r2Key, file.name, contentType, file.size, now, now));
  await platformEnv().DB.batch(statements); return Response.json({ id, role: requestedRole }, { status: 201 });
}
