import { clearSessionCookie, revokeAdminSession } from "../../../../../lib/admin-auth";

export async function POST(request: Request) {
  await revokeAdminSession(request.headers);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
