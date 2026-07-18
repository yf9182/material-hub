import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("selected material console replaces the starter", async () => {
  const [consoleSource, layout, css, packageJson] = await Promise.all([
    readFile(new URL("app/admin/MaterialConsole.tsx", root), "utf8"), readFile(new URL("app/layout.tsx", root), "utf8"), readFile(new URL("app/globals.css", root), "utf8"), readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.match(consoleSource, /Material Hub/); assert.match(consoleSource, /素材运营总览/); assert.match(consoleSource, /一键导入/); assert.match(consoleSource, /API Key/);
  assert.match(layout, /素材管理平台/); assert.match(css, /--primary:#5b5ce2/); assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("root hands off to the protected admin route", async () => {
  const [page, admin] = await Promise.all([readFile(new URL("app/page.tsx", root), "utf8"), readFile(new URL("app/admin/page.tsx", root), "utf8")]);
  assert.match(page, /redirect\("\/admin"\)/); assert.match(admin, /getChatGPTUser/); assert.match(admin, /ADMIN_EMAILS/); assert.match(admin, /force-dynamic/);
});
