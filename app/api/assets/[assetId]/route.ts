import { platformEnv } from "../../../../lib/platform-runtime";

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const row = await platformEnv().DB.prepare("SELECT * FROM assets WHERE id = ? LIMIT 1").bind(assetId).first<Record<string, unknown>>();
  if (!row) return new Response("Not found", { status: 404 });
  let object = await platformEnv().MATERIAL_ASSETS.get(String(row.r2_key));
  if (!object && row.source_url) {
    const response = await fetch(String(row.source_url));
    if (response.ok && response.body) {
      await platformEnv().MATERIAL_ASSETS.put(String(row.r2_key), response.body, { httpMetadata: { contentType: String(row.content_type) } });
      object = await platformEnv().MATERIAL_ASSETS.get(String(row.r2_key));
    }
  }
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": String(row.content_type), "cache-control": "public, max-age=31536000, immutable", etag: object.httpEtag } });
}
