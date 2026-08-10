import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stableTemplatePointCost } from "../lib/image-generation-charges.ts";

const execFileAsync = promisify(execFile);
const apply = process.argv.includes("--apply");
const productPid = "8801";

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function execute(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["wrangler", "d1", "execute", "material-hub-db", "--remote", "--config", "wrangler.production.json", "--json", "--command", sql],
    {
      env: { ...process.env, WRANGLER_LOG_PATH: "/private/tmp/material-hub-wrangler.log" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

const selectSql = `SELECT m.id, m.internal_name, m.price
FROM materials m JOIN products p ON p.id=m.product_id
WHERE p.external_pid=${sqlString(productPid)} AND m.archived_at IS NULL
  AND json_valid(m.material_config_raw)
  AND CAST(json_extract(m.material_config_raw,'$.type') AS INTEGER) IN (1,2)
ORDER BY m.id`;

const rows = (await execute(selectSql))?.[0]?.results ?? [];
if (!rows.length) throw new Error("No image templates found for product 8801");
const assignments = rows.map((row) => ({
  id: String(row.id),
  name: String(row.internal_name ?? ""),
  before: row.price === null ? null : Number(row.price),
  after: stableTemplatePointCost(String(row.id)),
}));
const summary = {
  total: assignments.length,
  points10: assignments.filter((row) => row.after === 10).length,
  points20: assignments.filter((row) => row.after === 20).length,
  changed: assignments.filter((row) => row.before !== row.after).length,
};

if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", summary, assignments }, null, 2));
  process.exit(0);
}

const migrationId = "image-template-price-v1";
for (const row of assignments) {
  const backupSql = `INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at)
SELECT lower(hex(randomblob(12))), m.product_id, 'system@material-hub', 'material.price.backup', 'material', m.id,
  json_object('migration_id',${sqlString(migrationId)},'price',m.price,'updated_at',m.updated_at), unixepoch()
FROM materials m WHERE m.id=${sqlString(row.id)}
  AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.action='material.price.backup' AND a.target_id=m.id
    AND json_extract(a.changes,'$.migration_id')=${sqlString(migrationId)})`;
  await execute(backupSql);
  await execute(`UPDATE materials SET price=${row.after}, is_free=0, updated_at=unixepoch() WHERE id=${sqlString(row.id)}`);
}

const verified = (await execute(selectSql))?.[0]?.results ?? [];
const invalid = verified.filter((row) => ![10, 20].includes(Number(row.price)));
if (verified.length !== assignments.length || invalid.length) {
  throw new Error(`Production verification failed: expected=${assignments.length} actual=${verified.length} invalid=${invalid.length}`);
}
console.log(JSON.stringify({ mode: "applied", migrationId, summary }, null, 2));
