import { initialProductId, productById, seedCatalog } from "../../../../lib/catalog-repository";
import { nowSeconds } from "../../../../lib/material-platform";
import { adminEmail, issueApiKey, platformEnv } from "../../../../lib/platform-runtime";

export async function POST(request: Request) {
  const actor = await adminEmail(request); if (!actor) return Response.json({ error: "FORBIDDEN" }, { status: 403 }); await seedCatalog();
  const body = await request.json() as Record<string, unknown>; const productId = String(body.productId ?? initialProductId); if (!await productById(productId)) return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 }); const rawKey = await issueApiKey(productId, String(body.name ?? "App Production"), actor); return Response.json({ apiKey: rawKey }, { status: 201 });
}
export async function DELETE(request: Request) {
  const actor = await adminEmail(request); if (!actor) return Response.json({ error: "FORBIDDEN" }, { status: 403 }); const id = new URL(request.url).searchParams.get("id"); if (!id) return Response.json({ error: "ID_REQUIRED" }, { status: 400 });
  const productId = new URL(request.url).searchParams.get("productId") || initialProductId; await platformEnv().DB.prepare("UPDATE api_keys SET revoked_at=?, updated_at=? WHERE id=? AND product_id=?").bind(nowSeconds(), nowSeconds(), id, productId).run(); return Response.json({ ok: true });
}
