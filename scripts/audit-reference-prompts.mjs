import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const envFile = process.env.MATERIAL_HUB_ENV_FILE || ".dev.vars";

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const split = line.indexOf("=");
    return split < 0 ? [line, ""] : [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^(['\"])(.*)\1$/, "$2")];
  }));
}

function value(item, section, key) {
  const wrapper = item?.[section]?.[key];
  return Array.isArray(wrapper?.value) ? wrapper.value[0] : "";
}

function parseConfig(raw) {
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function materialName(item) {
  return String(value(item, "independent_properties", "material_internal_name") || item.material_id || item.id || "");
}

const fileEnv = parseEnv(await readFile(envFile, "utf8"));
const username = process.env.REFERENCE_API_USERNAME || fileEnv.REFERENCE_API_USERNAME;
const password = process.env.REFERENCE_API_PASSWORD || fileEnv.REFERENCE_API_PASSWORD;
const base = (process.env.REFERENCE_API_BASE_URL || fileEnv.REFERENCE_API_BASE_URL || "https://nmaterial-api.afirstsoft.cn").replace(/\/+$/, "");
if (!username || !password) throw new Error(`Missing reference API credentials in ${envFile}`);

const headers = { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
async function get(path, params) {
  const url = new URL(path, base);
  for (const [key, val] of Object.entries(params)) url.searchParams.set(key, String(val));
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const common = { page: 1, page_size: 100, pid: 8801, channel: "English", source: "English" };
const tree = await get("/api/v1/product-material-category/ids/tree-list", common);
const roots = Array.isArray(tree?.data?.list) ? tree.data.list : [];
const nano = roots.find((item) => String(item.name || "").includes("Nano_Banana") || String(item.code || "").includes("Nano_Banana"));
if (!nano) throw new Error("Nano Banana category was not found");
const categoryIds = (Array.isArray(nano.children) ? nano.children : []).map((item) => String(item.id || "")).filter(Boolean);
const grouped = await get("/api/v1/product-material/category-group/list", { ...common, product_material_category_ids: categoryIds.join(",") });
const groups = Array.isArray(grouped?.data?.group) ? grouped.data.group : [];
const items = groups.flatMap((group) => Array.isArray(group.list) ? group.list : []);
const rows = items.map((item) => {
  const config = parseConfig(value(item, "public_properties", "material_config"));
  const prompt = typeof config.prompt === "string" ? config.prompt : "";
  return { id: String(item.material_id || item.id || ""), name: materialName(item), promptLength: prompt.length, prompt };
});
const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
const referencePattern = /(uploaded|provided|input|reference|source|original|portrait|photo|image|person|subject|face|pet|couple)/i;
const summary = {
  categories: categoryIds.length,
  materials: unique.length,
  emptyPrompts: unique.filter((row) => !row.prompt.trim()).length,
  exactly1000: unique.filter((row) => row.promptLength === 1000).length,
  over1000: unique.filter((row) => row.promptLength > 1000).length,
  exactly2000: unique.filter((row) => row.promptLength === 2000).length,
  maxLength: Math.max(0, ...unique.map((row) => row.promptLength)),
  missingImageReference: unique.filter((row) => !referencePattern.test(row.prompt)).length,
};

let productionComparison;
if (process.argv.includes("--compare-production")) {
  const sql = "SELECT id, internal_name, json_extract(material_config_raw,'$.prompt') prompt FROM materials WHERE status='published' AND publish_status=1 AND archived_at IS NULL ORDER BY id";
  const { stdout } = await execFileAsync("npx", ["wrangler", "d1", "execute", "material-hub-db", "--remote", "--config", "wrangler.production.json", "--json", "--command", sql], {
    env: { ...process.env, WRANGLER_LOG_PATH: "/private/tmp/material-hub-wrangler.log" },
    maxBuffer: 16 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  const productionRows = result?.[0]?.results || [];
  const referenceById = new Map(unique.map((row) => [row.id, row]));
  const compared = productionRows.map((row) => {
    const reference = referenceById.get(String(row.id));
    const productionPrompt = typeof row.prompt === "string" ? row.prompt : "";
    return {
      id: String(row.id), name: String(row.internal_name || ""), productionLength: productionPrompt.length,
      referenceLength: reference?.promptLength ?? null,
      relation: !reference ? "missing-reference" : reference.prompt === productionPrompt ? "same" : reference.promptLength > productionPrompt.length ? "reference-longer" : reference.promptLength < productionPrompt.length ? "production-longer" : "changed-same-length",
    };
  });
  const count = (relation) => compared.filter((row) => row.relation === relation).length;
  productionComparison = {
    materials: productionRows.length,
    same: count("same"),
    referenceLonger: count("reference-longer"),
    productionLonger: count("production-longer"),
    changedSameLength: count("changed-same-length"),
    missingReference: count("missing-reference"),
    onlyReference: unique.filter((row) => !productionRows.some((item) => String(item.id) === row.id)).length,
    recoverable: compared.filter((row) => row.relation === "reference-longer"),
  };
}

console.log(JSON.stringify({ summary, productionComparison, details: process.argv.includes("--details") ? unique.map(({ prompt, ...row }) => ({ ...row, tail: prompt.slice(-160) })) : undefined }, null, 2));
