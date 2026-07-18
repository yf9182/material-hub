import { headers } from "next/headers";
import { getAdminSession } from "../../lib/admin-auth";
import MaterialConsole from "./MaterialConsole";
import AdminLogin from "./AdminLogin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const requestHeaders = await headers(); const host = requestHeaders.get("host") ?? ""; const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (local) return <MaterialConsole actor="本地管理员" />;
  const session = await getAdminSession(requestHeaders);
  if (!session) return <AdminLogin />;
  return <MaterialConsole actor={session.displayName} />;
}
