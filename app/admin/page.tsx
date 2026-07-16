import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import { platformEnv } from "../../lib/platform-runtime";
import MaterialConsole from "./MaterialConsole";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const requestHeaders = await headers(); const host = requestHeaders.get("host") ?? ""; const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const user = await getChatGPTUser(); if (!local && !user) redirect(chatGPTSignInPath("/admin"));
  const allowed = (platformEnv().ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!local && (!user || !allowed.includes(user.email.toLowerCase()))) return <main className="access-denied"><div><span>403</span><h1>没有管理权限</h1><p>你的账号不在管理员白名单中，请联系站点所有者。</p></div></main>;
  return <MaterialConsole actor={user?.displayName ?? "本地管理员"} />;
}
