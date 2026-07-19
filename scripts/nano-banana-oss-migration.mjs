#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const PREFIX = "materials/8801/nano-banana";
const LIMIT_BYTES = 32 * 1024 ** 3;

function loadEnv(file) {
  const text = requireText(file);
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function requireText(file) {
  return fsSync.readFileSync(file, "utf8");
}

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function has(name) { return process.argv.includes(name); }

function fail(message) {
  console.error(`迁移失败：${message}`);
  process.exitCode = 1;
}

async function readManifest(file) {
  if (!file) throw new Error("请提供 --manifest manifest.json");
  const payload = JSON.parse(await fs.readFile(file, "utf8"));
  const assets = Array.isArray(payload) ? payload : payload.assets;
  if (!Array.isArray(assets)) throw new Error("manifest 必须是数组，或包含 assets 数组");
  return assets.map((item, index) => {
    const url = String(item.url ?? item.source_url ?? item.cdn_url ?? "").trim();
    const id = String(item.id ?? item.asset_id ?? index + 1);
    const role = String(item.role ?? "original");
    if (!url) throw new Error(`第 ${index + 1} 项缺少 url/source_url/cdn_url`);
    return { ...item, id, role, url, size: Number(item.size ?? 0) || 0 };
  });
}

function objectKey(item) {
  const safeName = String(item.fileName ?? item.file_name ?? path.basename(new URL(item.url).pathname) ?? `${item.role}-${item.id}`)
    .replace(/[^A-Za-z0-9._-]+/g, "-") || `${item.role}-${item.id}`;
  return `${PREFIX}/${item.id}/${item.role}-${safeName}`;
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `${command} exited ${code}`)));
  });
}

async function statObject(ossutil, uri) {
  try {
    const text = await run(ossutil, ["stat", uri, "--output-format", "json"]);
    return JSON.parse(text);
  } catch { return null; }
}

async function main() {
  loadEnv(arg("--env", ".env.migration.local"));
  const manifest = await readManifest(arg("--manifest"));
  const total = manifest.reduce((sum, item) => sum + item.size, 0);
  const unknown = manifest.filter((item) => !item.size).length;
  console.log(JSON.stringify({ assets: manifest.length, bytes: total, gib: Number((total / 1024 ** 3).toFixed(3)), unknownSize: unknown, limitGib: 32 }, null, 2));
  if (total > LIMIT_BYTES) throw new Error(`预计容量超过 32 GiB 安全门槛：${(total / 1024 ** 3).toFixed(2)} GiB`);
  if (unknown && has("--require-known-size")) throw new Error(`仍有 ${unknown} 个素材缺少 size，无法执行安全同步`);

  const rows = manifest.map((item) => ({ id: item.id, role: item.role, size: item.size, key: objectKey(item), url: item.url }));
  if (has("--dry-run") || !has("--sync")) {
    for (const row of rows) console.log(`${row.size}\t${row.key}\t${row.url}`);
    console.log(has("--dry-run") ? "dry-run 完成，未写入 OSS。" : "未指定 --sync，仅输出计划；使用 --dry-run 明确执行预检。\n");
    return;
  }

  const ossutil = path.resolve(arg("--ossutil", ".tools/ossutil/ossutil"));
  const bucket = process.env.OSS_BUCKET;
  const endpoint = process.env.OSS_ENDPOINT;
  if (!bucket || !endpoint) throw new Error("缺少 OSS_BUCKET 或 OSS_ENDPOINT");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nano-banana-oss-"));
  let uploaded = 0, skipped = 0;
  try {
    const queue = [...manifest];
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) return;
        const key = objectKey(item);
        const uri = `oss://${bucket}/${key}`;
        const existing = await statObject(ossutil, uri);
        if (existing && item.size && Number(existing["Content-Length"] ?? existing.contentLength ?? 0) === item.size) { skipped++; continue; }
        const response = await fetch(item.url);
        if (!response.ok) throw new Error(`${item.url} 返回 HTTP ${response.status}`);
        const body = Buffer.from(await response.arrayBuffer());
        const actualHash = crypto.createHash("sha256").update(body).digest("hex");
        if (item.sha256 && item.sha256 !== actualHash) throw new Error(`${item.id} SHA-256 不匹配`);
        const local = path.join(tempDir, `${item.id}-${item.role}`);
        await fs.writeFile(local, body);
        await run(ossutil, ["cp", local, uri, "-e", endpoint, "-f"]);
        uploaded++;
        console.log(`uploaded ${key} sha256=${actualHash}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, manifest.length) }, worker));
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  console.log(JSON.stringify({ uploaded, skipped, total: manifest.length }, null, 2));
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
