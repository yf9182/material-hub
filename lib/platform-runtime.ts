import { env } from "cloudflare:workers";
import { getAdminSession } from "./admin-auth";
import { objectId, nowSeconds, sha256Hex } from "./material-platform";

export type PlatformEnv = { DB: D1Database; MATERIAL_ASSETS: R2Bucket; ADMIN_EMAILS?: string; ADMIN_USERNAME?: string; ADMIN_PASSWORD_HASH?: string; MATERIAL_HUB_MCP_TOKEN_HASH?: string; MATERIAL_HUB_MCP_ACTOR?: string; REFERENCE_API_USERNAME?: string; REFERENCE_API_PASSWORD?: string; REFERENCE_API_BASE_URL?: string; DEMO_API_KEY?: string; OSS_REGION?: string; OSS_ENDPOINT?: string; OSS_BUCKET?: string; OSS_ACCESS_KEY_ID?: string; OSS_ACCESS_KEY_SECRET?: string; OSS_SESSION_TOKEN?: string; OSS_URL_TTL_SECONDS?: string };
export function platformEnv() { return env as unknown as PlatformEnv; }
export async function sha256(value: string) {
  return sha256Hex(value);
}
export function isLocal(request: Request) { return ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname); }
export async function adminEmail(request: Request) {
  if (isLocal(request)) return "local-admin@materialhub.local";
  const session = await getAdminSession(request.headers);
  return session?.username ?? null;
}
export async function requireApiProduct(request: Request, externalPid: string) {
  const raw = request.headers.get("x-api-key");
  if (!raw) return null;
  const hash = await sha256(raw);
  const row = await platformEnv().DB.prepare(`SELECT p.* FROM api_keys k JOIN products p ON p.id = k.product_id WHERE k.secret_hash = ? AND k.revoked_at IS NULL AND p.external_pid = ? AND p.archived_at IS NULL LIMIT 1`).bind(hash, externalPid).first<Record<string, unknown>>();
  if (row) await platformEnv().DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE secret_hash = ?").bind(nowSeconds(), hash).run();
  return row;
}
export async function issueApiKey(productId: string, name: string, actor: string) {
  const raw = `mat_${objectId()}${objectId()}`;
  const now = nowSeconds();
  await platformEnv().DB.prepare("INSERT INTO api_keys (id, product_id, name, prefix, secret_hash, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(objectId(), productId, name, raw.slice(0, 12), await sha256(raw), actor, now, now).run();
  return raw;
}
