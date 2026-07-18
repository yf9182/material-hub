import { adminEmail, platformEnv } from "../../../../lib/platform-runtime";

export async function GET(request: Request) {
  if (!(await adminEmail(request))) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const key = platformEnv().DEMO_API_KEY;
  if (!key) return Response.json({ error: "DEMO_API_KEY_NOT_CONFIGURED" }, { status: 404 });
  return Response.json({ apiKey: key });
}
