import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { IMAGE_REFERENCE_INSTRUCTION, INCOMPLETE_PROMPT_INSTRUCTION } from "../lib/material-platform.ts";

const execFileAsync = promisify(execFile);
const apply = process.argv.includes("--apply");
const repairId = "prompt-policy-2026-08-01";
const published = "status='published' AND publish_status=1 AND archived_at IS NULL";
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function execute(sql) {
  const { stdout } = await execFileAsync("npx", ["wrangler", "d1", "execute", "material-hub-db", "--remote", "--config", "wrangler.production.json", "--json", "--command", sql], {
    env: { ...process.env, WRANGLER_LOG_PATH: "/private/tmp/material-hub-wrangler.log" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

const auditSql = `WITH p AS (
  SELECT id, json_extract(material_config_raw,'$.prompt') prompt
  FROM materials WHERE ${published}
) SELECT COUNT(*) total,
  SUM(prompt IS NULL OR trim(prompt)='') empty_prompt,
  SUM(length(prompt)>=1000) truncation_risk,
  SUM(instr(prompt,${sqlString(IMAGE_REFERENCE_INSTRUCTION)})>0) image_policy,
  SUM(instr(prompt,${sqlString(INCOMPLETE_PROMPT_INSTRUCTION)})>0) completion_policy,
  MAX(length(prompt)) max_length
FROM p`;

const before = (await execute(auditSql))?.[0]?.results?.[0];
if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", before }, null, 2));
  process.exit(0);
}
if (!before || Number(before.total) !== 217 || Number(before.empty_prompt) !== 0) throw new Error(`Production precondition failed: ${JSON.stringify(before)}`);

const backupSql = `INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at)
SELECT lower(hex(randomblob(12))), product_id, 'system@material-hub', 'material.prompt_policy.backup', 'material', id,
  json_object('repair_id',${sqlString(repairId)},'prompt',json_extract(material_config_raw,'$.prompt'),'updated_at',updated_at), unixepoch()
FROM materials m
WHERE ${published}
  AND NOT EXISTS (
    SELECT 1 FROM audit_events a
    WHERE a.action='material.prompt_policy.backup' AND a.target_id=m.id
      AND json_extract(a.changes,'$.repair_id')=${sqlString(repairId)}
  )`;
await execute(backupSql);

const promptExpression = `trim(json_extract(material_config_raw,'$.prompt'))
  || CASE WHEN length(json_extract(material_config_raw,'$.prompt'))>=1000
    AND instr(json_extract(material_config_raw,'$.prompt'),${sqlString(INCOMPLETE_PROMPT_INSTRUCTION)})=0
    THEN char(10)||char(10)||${sqlString(INCOMPLETE_PROMPT_INSTRUCTION)} ELSE '' END
  || CASE WHEN instr(json_extract(material_config_raw,'$.prompt'),${sqlString(IMAGE_REFERENCE_INSTRUCTION)})=0
    THEN char(10)||char(10)||${sqlString(IMAGE_REFERENCE_INSTRUCTION)} ELSE '' END`;
const updateSql = `UPDATE materials SET
  material_config_json=json_set(CASE WHEN json_valid(material_config_json) THEN material_config_json ELSE material_config_raw END,'$.prompt',${promptExpression}),
  material_config_raw=json_set(material_config_raw,'$.prompt',${promptExpression}),
  updated_at=unixepoch()
WHERE ${published}
  AND json_valid(material_config_raw)
  AND trim(json_extract(material_config_raw,'$.prompt'))<>''
  AND (instr(json_extract(material_config_raw,'$.prompt'),${sqlString(IMAGE_REFERENCE_INSTRUCTION)})=0
    OR (length(json_extract(material_config_raw,'$.prompt'))>=1000
      AND instr(json_extract(material_config_raw,'$.prompt'),${sqlString(INCOMPLETE_PROMPT_INSTRUCTION)})=0))`;
await execute(updateSql);

const after = (await execute(auditSql))?.[0]?.results?.[0];
if (!after || Number(after.total) !== 217 || Number(after.image_policy) !== 217 || Number(after.completion_policy) !== 182) {
  throw new Error(`Production verification failed: ${JSON.stringify(after)}`);
}
console.log(JSON.stringify({ mode: "applied", before, after, repairId }, null, 2));
