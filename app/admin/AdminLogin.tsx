"use client";

import { useState } from "react";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "INVALID_CREDENTIALS" ? "账号或密码错误" : "登录服务暂不可用");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败");
    } finally { setBusy(false); }
  }

  return <main className="admin-login-page"><form className="admin-login-card" onSubmit={submit}>
    <div className="admin-login-brand"><b>M</b><span><strong>Material Hub</strong><small>生产环境管理后台</small></span></div>
    <h1>管理员登录</h1><p>请输入生产环境管理员账号和密码。</p>
    <label>账号<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
    <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
    {error && <div className="admin-login-error">{error}</div>}
    <button className="button primary admin-login-submit" disabled={busy}>{busy ? "登录中…" : "登录后台"}</button>
  </form></main>;
}
