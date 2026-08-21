import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Trending service keeps display type independent from input image count", async () => {
  const source = await readFile(new URL("lib/trending-template-service.ts", root), "utf8");
  assert.match(source, /type: input\.displayType, image_count: input\.imageCount, price: input\.price/);
  assert.match(source, /displayType === 1 && \(!input\.beforeCover \|\| !input\.afterCover\)/);
  assert.match(source, /displayType === 2 && !input\.cover/);
  assert.match(source, /source_key=\? AND external_material_id=\?/);
  assert.match(source, /相同标题或 Prompt/);
  assert.match(source, /type=1 必须记录生成 before 图时使用的 beforePrompt/);
  assert.match(source, /beforePrompt: safeText\(input\.beforePrompt\)/);
  assert.match(source, /db\.batch\(statements\)/);
});

test("MCP endpoint and auth enforce bearer hash, safe media, evidence, and revision checks", async () => {
  const [auth, route, server, service] = await Promise.all([
    readFile(new URL("lib/mcp-auth.ts", root), "utf8"),
    readFile(new URL("app/api/internal/mcp/trending/route.ts", root), "utf8"),
    readFile(new URL("mcp/trending-template-server.ts", root), "utf8"),
    readFile(new URL("lib/trending-template-service.ts", root), "utf8"),
  ]);
  assert.match(auth, /MATERIAL_HUB_MCP_TOKEN_HASH/);
  assert.match(auth, /sha256Hex\(match\[1\]\.trim\(\)\)/);
  assert.doesNotMatch(route, /adminEmail|isLocal/);
  assert.match(server, /realpath\(resolve\(value\)\)/);
  assert.match(server, /MATERIAL_HUB_MCP_TOKEN_FILE/);
  assert.match(server, /\.config.*material-hub.*mcp-token/);
  assert.match(server, /10 \* 1024 \* 1024/);
  assert.match(server, /resize\(1000, 1200/);
  assert.match(service, /最近 30 天/);
  assert.match(service, /revisionFor/);
  assert.match(service, /模板 \$\{preview\.id\} 在预览后已发生变化/);
  assert.match(server, /beforePrompt: z\.string\(\)\.min\(1\)\.max\(8000\)\.optional\(\)/);
});

test("stdio MCP advertises the five tools without contaminating stdout", async () => {
  const mediaRoot = await mkdtemp(join(tmpdir(), "material-hub-mcp-"));
  const child = spawn(process.execPath, ["--import", "tsx", "mcp/trending-template-server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, MATERIAL_HUB_BASE_URL: "http://127.0.0.1:9", MATERIAL_HUB_MCP_TOKEN: "test-token", MATERIAL_HUB_MCP_MEDIA_ROOT: mediaRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  const pending = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const index = pending.findIndex((item) => item.id === message.id);
      if (index >= 0) pending.splice(index, 1)[0].resolve(message);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const request = (id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP request timed out: ${method}`)), 8_000);
    pending.push({ id, resolve: (message) => { clearTimeout(timer); resolve(message); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  try {
    const initialized = await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contract-test", version: "1" } });
    assert.equal(initialized.result.serverInfo.name, "material-hub-ai");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await request(2, "tools/list", {});
    const tools = listed.result.tools;
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["create_category", "create_material", "create_standard_material", "delete_materials", "ensure_trending_category", "get_material", "inspect_catalog", "inspect_material_standard", "inspect_trending_context", "list_products", "preview_trending_templates", "publish_standard_material", "publish_trending_templates", "set_material_status", "stage_trending_template", "update_material", "update_standard_material", "validate_material_config"].sort());
    assert.equal(tools.find((tool) => tool.name === "publish_trending_templates").annotations.destructiveHint, true);
    assert.equal(tools.find((tool) => tool.name === "inspect_trending_context").annotations.readOnlyHint, true);
    assert.equal(tools.find((tool) => tool.name === "validate_material_config").annotations.readOnlyHint, true);
    assert.equal(stderr, "");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(mediaRoot, { recursive: true, force: true });
  }
});

test("project MCP config forwards only local environment variables", async () => {
  const config = await readFile(new URL(".codex/config.toml", root), "utf8");
  assert.match(config, /command = "node"/);
  assert.match(config, /env_vars = \["MATERIAL_HUB_BASE_URL", "MATERIAL_HUB_MCP_TOKEN", "MATERIAL_HUB_MCP_TOKEN_FILE", "MATERIAL_HUB_MCP_MEDIA_ROOT"\]/);
  assert.doesNotMatch(config, /MATERIAL_HUB_MCP_TOKEN = "[^\"]+"/);
});
