import { createAdminSession, sessionCookie, verifyAdminCredentials } from "../../../../../lib/admin-auth";

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try { body = await request.json() as { username?: string; password?: string }; } catch { return Response.json({ error: "INVALID_BODY" }, { status: 400 }); }
  const username = String(body.username ?? ""); const password = String(body.password ?? "");
  if (!(await verifyAdminCredentials(username, password))) return Response.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  const token = await createAdminSession(username.trim());
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token) } });
}
