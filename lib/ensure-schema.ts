import { platformEnv } from "./platform-runtime";

let ready: Promise<void> | null = null;
export function ensureSchema() {
  ready ??= (async () => {
    const db = platformEnv().DB;
    const statements = [
      `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY NOT NULL, external_pid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'English', source TEXT NOT NULL DEFAULT 'English', status TEXT NOT NULL DEFAULT 'active', archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL, parent_id TEXT, external_id TEXT, name TEXT NOT NULL, code TEXT NOT NULL, config TEXT NOT NULL DEFAULT '', translations TEXT NOT NULL, marks TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', archived_at INTEGER, material_latest_update_time INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(product_id, external_id))`,
      `CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL, external_material_id TEXT, source_key TEXT NOT NULL DEFAULT 'manual', internal_name TEXT NOT NULL, title_translations TEXT NOT NULL, activity_translations TEXT NOT NULL, material_config_raw TEXT NOT NULL DEFAULT '{}', material_config_json TEXT, source_snapshot TEXT NOT NULL, manual_overrides TEXT NOT NULL, min_version TEXT NOT NULL DEFAULT '', max_version TEXT NOT NULL DEFAULT '', is_free INTEGER NOT NULL DEFAULT 0, listing_status INTEGER NOT NULL DEFAULT 1, publish_status INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft', archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(product_id, source_key, external_material_id))`,
      `CREATE TABLE IF NOT EXISTS material_categories (id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL, material_id TEXT NOT NULL, category_id TEXT NOT NULL, external_relation_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, listing_status INTEGER NOT NULL DEFAULT 1, archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(material_id, category_id))`,
      `CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL, material_id TEXT, role TEXT NOT NULL, r2_key TEXT NOT NULL, source_url TEXT, file_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, hash TEXT, width INTEGER, height INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, last_used_at INTEGER, revoked_at INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS import_jobs (id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', source_label TEXT NOT NULL, manifest TEXT NOT NULL, summary TEXT NOT NULL, created_by TEXT NOT NULL, completed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS import_items (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, external_id TEXT, item_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL, result TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY NOT NULL, product_id TEXT, actor_email TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, changes TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    ];
    await db.batch(statements.map((sql) => db.prepare(sql))); return undefined;
  })();
  return ready;
}
