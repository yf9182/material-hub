import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const apply = process.argv.includes("--apply");
const repairId = "trending-config-standardize-2026-08-22";
const PRODUCT_ID = "880100000000000000000001";
// 覆盖 8801 下全部素材；8801 当前全部为 image_to_image（尚未做图生视频）
const TARGET = `product_id='${PRODUCT_ID}' AND json_valid(material_config_raw)`;
const setPreset = `'image_to_image'`;
const legacyCondition = `(json_extract(material_config_raw,'$.schema_version') IS NULL
   OR json_extract(material_config_raw,'$.preset') IS NULL
   OR json_extract(material_config_raw,'$.extensions') IS NULL)`;

async function execute(sql) {
  const { stdout } = await execFileAsync("npx", ["wrangler", "d1", "execute", "material-hub-db", "--remote", "--config", "wrangler.production.json", "--json", "--command", sql], {
    env: { ...process.env, WRANGLER_LOG_PATH: "/private/tmp/material-hub-wrangler.log" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

const auditSql = `SELECT COUNT(*) total,
  SUM(json_extract(material_config_raw,'$.schema_version') IS NULL) no_schema,
  SUM(json_extract(material_config_raw,'$.preset') IS NULL) no_preset,
  SUM(json_extract(material_config_raw,'$.extensions') IS NULL) no_extensions,
  SUM(json_extract(material_config_raw,'$.preset')='image_to_video') video
FROM materials WHERE ${TARGET}`;

const before = (await execute(auditSql))?.[0]?.results?.[0];
if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", before }, null, 2));
  process.exit(0);
}
if (!before || Number(before.total) === undefined) throw new Error(`Production precondition failed: ${JSON.stringify(before)}`);

const setJson = `json_set(
  CASE WHEN json_valid(material_config_json) THEN material_config_json ELSE material_config_raw END,
  '$.schema_version', 1,
  '$.preset', ${setPreset},
  '$.extensions', CASE WHEN json_valid(json_extract(material_config_raw,'$.extensions')) THEN json_extract(material_config_raw,'$.extensions') ELSE json_object() END
)`;
const setRaw = `json_set(material_config_raw,
  '$.schema_version', 1,
  '$.preset', ${setPreset},
  '$.extensions', CASE WHEN json_valid(json_extract(material_config_raw,'$.extensions')) THEN json_extract(material_config_raw,'$.extensions') ELSE json_object() END
)`;

if (apply) {
  const backupSql = `INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at)
SELECT lower(hex(randomblob(12))), product_id, 'system@material-hub', 'material.trending_config.backup', 'material', id,
  json_object('repair_id',${`'${repairId}'`},'material_config_raw',material_config_raw,'updated_at',updated_at), unixepoch()
FROM materials
WHERE ${TARGET} AND ${legacyCondition}
  AND NOT EXISTS (
    SELECT 1 FROM audit_events a
    WHERE a.action='material.trending_config.backup' AND a.target_id=materials.id
      AND json_extract(a.changes,'$.repair_id')=${`'${repairId}'`}
  )`;
  await execute(backupSql);

  const updateSql = `UPDATE materials SET
    material_config_json=${setJson},
    material_config_raw=${setRaw},
    updated_at=unixepoch()
  WHERE ${TARGET} AND ${legacyCondition}`;
  await execute(updateSql);
}

const after = (await execute(auditSql))?.[0]?.results?.[0];
if (!after || Number(after.no_schema) !== 0 || Number(after.no_preset) !== 0 || Number(after.no_extensions) !== 0) {
  throw new Error(`Production verification failed: ${JSON.stringify(after)}`);
}
console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", before, after, repairId }, null, 2));