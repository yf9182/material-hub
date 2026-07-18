import { env } from "cloudflare:workers";
import { nowSeconds, objectId, sha256Hex } from "./material-platform";

export const ADMIN_SESSION_COOKIE = "mh_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type AdminEnv = {
  DB: D1Database;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
};

function adminEnv() { return env as unknown as AdminEnv; }

export function sessionTokenFromHeaders(headers: Headers) {
  const raw = headers.get("cookie") ?? "";
  for (const item of raw.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === ADMIN_SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

export async function getAdminSession(headers: Headers) {
  const token = sessionTokenFromHeaders(headers);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await adminEnv().DB.prepare("SELECT username, expires_at FROM admin_sessions WHERE token_hash = ? LIMIT 1").bind(hash).first<{ username: string; expires_at: number }>();
  if (!row || Number(row.expires_at) <= nowSeconds()) {
    await adminEnv().DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(hash).run();
    return null;
  }
  return { username: String(row.username), displayName: String(row.username) };
}

export async function verifyAdminCredentials(username: string, password: string) {
  const configuredUsername = String(adminEnv().ADMIN_USERNAME ?? "").trim();
  const configuredHash = String(adminEnv().ADMIN_PASSWORD_HASH ?? "").trim().toLowerCase();
  if (!configuredUsername || !configuredHash || username.trim() !== configuredUsername) return false;
  return (await sha256Hex(password)) === configuredHash;
}

export async function createAdminSession(username: string) {
  const token = `${objectId()}${objectId()}`;
  const now = nowSeconds();
  await adminEnv().DB.prepare("INSERT INTO admin_sessions (id, token_hash, username, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(objectId(), await sha256Hex(token), username, now + SESSION_TTL_SECONDS, now).run();
  return token;
}

export async function revokeAdminSession(headers: Headers) {
  const token = sessionTokenFromHeaders(headers);
  if (token) await adminEnv().DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export function sessionCookie(token: string) {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
