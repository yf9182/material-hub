#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PREFIX = "materials/8801/nano-banana";
const DB_NAME = process.env.CF_D1_DATABASE ?? "material-hub-db";

function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? fallback : fallback; }
function has(name) { return process.argv.includes(name); }
function loadEnv(file) {
  if (!file || !fsSync.existsSync(file)) return;
  for (const line of fsSync.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `${command} exited ${code}`)));
  });
}
function idKey(value) { return String(value ?? "").replace(/^0+/, "") || "0"; }
function safeName(value) { return String(value ?? "").replace(/[^A-Za-z0-9._-]+/g, "-") || "asset"; }
function objectKey(item) { return `${PREFIX}/${item.id}/${item.role}-${safeName(item.fileName ?? item.file_name)}`; }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function d1Rows() {
  const raw = await run("npx", ["wrangler", "d1", "execute", DB_NAME, "--remote", "--json", "--command", "SELECT id, role, file_name, product_id FROM assets WHERE product_id = '880100000000000000000001'"]);
  const parsed = JSON.parse(raw);
  const result = Array.isArray(parsed) ? parsed.flatMap((item) => item.results ?? []) : (parsed.results ?? []);
  return result;
}

async function objectExists(key) {
  if (has("--skip-head")) return true;
  const bucket = process.env.OSS_BUCKET, endpoint = process.env.OSS_ENDPOINT;
  if (!bucket || !endpoint) throw new Error("缺少 OSS_BUCKET 或 OSS_ENDPOINT");
  try {
    await run(path.resolve(arg("--ossutil", ".tools/ossutil/ossutil")), ["stat", `oss://${bucket}/${key}`, "-e", endpoint, "--output-format", "json"]);
    return true;
  } catch { return false; }
}

async function main() {
  loadEnv(arg("--env", ".env.migration.local"));
  const manifestPath = arg("--manifest", "/tmp/nano-banana-manifest.json");
  const payload = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const items = (Array.isArray(payload) ? payload : payload.assets).map((item) => ({ ...item, id: String(item.id), role: String(item.role ?? "original") }));
  const rows = await d1Rows();
  const used = new Set(); const candidates = []; const missingItems = []; let missing = 0, noObject = 0;
  for (const item of items) {
    const matches = rows.filter((row) => String(row.role) === item.role && !used.has(String(row.id)));
    const row = matches.find((candidate) => idKey(candidate.id) === idKey(item.id))
      ?? matches.find((candidate) => String(candidate.file_name ?? "") === String(item.fileName ?? item.file_name ?? ""))
      ?? matches.find((candidate) => String(candidate.source_url ?? "") === String(item.url ?? item.source_url ?? ""));
    if (!row) { missing++; if (missingItems.length < 12) missingItems.push({ id: item.id, role: item.role, fileName: item.fileName }); continue; }
    used.add(String(row.id));
    candidates.push({ item, row, key: objectKey(item) });
  }
  const queue = [...candidates]; const verified = []; const checkWorker = async () => {
    while (queue.length) {
      const candidate = queue.shift(); if (!candidate) return;
      if (await objectExists(candidate.key)) verified.push(candidate); else noObject++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, candidates.length) }, checkWorker));
  const statements = verified.map(({ key, row }) => `UPDATE assets SET storage_provider = 'aliyun-oss', oss_key = ${sql(key)}, updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ${sql(row.id)};`);
  const sqlText = `${statements.join("\n")}\n`;
  const sqlOut = arg("--sql-out", path.join(os.tmpdir(), "nano-banana-oss-backfill.sql"));
  await fs.writeFile(sqlOut, sqlText, "utf8");
  console.log(JSON.stringify({ manifestAssets: items.length, d1Assets: rows.length, bound: statements.length, missing, missingSamples: missingItems, noObject, sqlOut }, null, 2));
  if (!has("--apply")) { console.log("未指定 --apply，未修改 D1。"); return; }
  if (!statements.length) throw new Error("没有可绑定的资产，停止执行");
  await run("npx", ["wrangler", "d1", "execute", DB_NAME, "--remote", `--file=${sqlOut}`]);
  console.log(`已写入 D1：${statements.length} 条 OSS 绑定。`);
}

main().catch((error) => { console.error(`绑定失败：${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
