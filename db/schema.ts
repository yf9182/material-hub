import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = { createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull() };

export const products = sqliteTable("products", {
  id: text("id").primaryKey(), externalPid: text("external_pid").notNull(), name: text("name").notNull(),
  channel: text("channel").notNull().default("English"), source: text("source").notNull().default("English"),
  status: text("status").notNull().default("active"), archivedAt: integer("archived_at"), ...timestamps,
}, (t) => [uniqueIndex("products_external_pid_uq").on(t.externalPid)]);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(), productId: text("product_id").notNull().references(() => products.id), parentId: text("parent_id"),
  externalId: text("external_id"), name: text("name").notNull(), code: text("code").notNull(), config: text("config").notNull().default(""),
  translations: text("translations", { mode: "json" }).$type<Record<string, { code: string; content: string; is_default: number }>>().notNull(),
  marks: text("marks", { mode: "json" }).$type<unknown[]>().notNull(), sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("active"), archivedAt: integer("archived_at"), materialLatestUpdateTime: integer("material_latest_update_time").notNull().default(0), ...timestamps,
}, (t) => [uniqueIndex("categories_product_external_uq").on(t.productId, t.externalId), index("categories_parent_idx").on(t.productId, t.parentId, t.sortOrder)]);

export const materials = sqliteTable("materials", {
  id: text("id").primaryKey(), productId: text("product_id").notNull().references(() => products.id), externalMaterialId: text("external_material_id"), sourceKey: text("source_key").notNull().default("manual"),
  internalName: text("internal_name").notNull(), titleTranslations: text("title_translations", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  activityTranslations: text("activity_translations", { mode: "json" }).$type<Record<string, unknown>>().notNull(), materialConfigRaw: text("material_config_raw").notNull().default("{}"),
  materialConfigJson: text("material_config_json", { mode: "json" }).$type<Record<string, unknown> | null>(), sourceSnapshot: text("source_snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  manualOverrides: text("manual_overrides", { mode: "json" }).$type<Record<string, unknown>>().notNull(), minVersion: text("min_version").notNull().default(""), maxVersion: text("max_version").notNull().default(""),
  isFree: integer("is_free").notNull().default(0), listingStatus: integer("listing_status").notNull().default(1), publishStatus: integer("publish_status").notNull().default(0),
  status: text("status").notNull().default("draft"), archivedAt: integer("archived_at"), ...timestamps,
}, (t) => [uniqueIndex("materials_source_external_uq").on(t.productId, t.sourceKey, t.externalMaterialId), index("materials_product_status_idx").on(t.productId, t.status, t.updatedAt)]);

export const materialCategories = sqliteTable("material_categories", {
  id: text("id").primaryKey(), productId: text("product_id").notNull().references(() => products.id), materialId: text("material_id").notNull().references(() => materials.id),
  categoryId: text("category_id").notNull().references(() => categories.id), externalRelationId: text("external_relation_id"), sortOrder: integer("sort_order").notNull().default(0),
  listingStatus: integer("listing_status").notNull().default(1), archivedAt: integer("archived_at"), ...timestamps,
}, (t) => [uniqueIndex("material_categories_pair_uq").on(t.materialId, t.categoryId), index("material_categories_category_idx").on(t.categoryId, t.sortOrder)]);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(), productId: text("product_id").notNull().references(() => products.id), materialId: text("material_id").references(() => materials.id), role: text("role").notNull(),
  r2Key: text("r2_key").notNull(), sourceUrl: text("source_url"), fileName: text("file_name").notNull(), contentType: text("content_type").notNull(), size: integer("size").notNull().default(0),
  hash: text("hash"), width: integer("width"), height: integer("height"), ...timestamps,
}, (t) => [index("assets_material_role_idx").on(t.materialId, t.role), index("assets_hash_idx").on(t.productId, t.hash)]);

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(), productId: text("product_id").notNull().references(() => products.id), name: text("name").notNull(), prefix: text("prefix").notNull(), secretHash: text("secret_hash").notNull(),
  lastUsedAt: integer("last_used_at"), revokedAt: integer("revoked_at"), createdBy: text("created_by").notNull(), ...timestamps,
}, (t) => [uniqueIndex("api_keys_hash_uq").on(t.secretHash), index("api_keys_product_idx").on(t.productId, t.revokedAt)]);

export const importJobs = sqliteTable("import_jobs", {
  id: text("id").primaryKey(), productId: text("product_id").notNull().references(() => products.id), mode: text("mode").notNull(), status: text("status").notNull().default("pending"), sourceLabel: text("source_label").notNull(),
  manifest: text("manifest", { mode: "json" }).$type<Record<string, unknown>>().notNull(), summary: text("summary", { mode: "json" }).$type<Record<string, number>>().notNull(), createdBy: text("created_by").notNull(), completedAt: integer("completed_at"), ...timestamps,
}, (t) => [index("import_jobs_product_idx").on(t.productId, t.createdAt)]);

export const importItems = sqliteTable("import_items", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull().references(() => importJobs.id), externalId: text("external_id"), itemType: text("item_type").notNull(), status: text("status").notNull().default("pending"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(), result: text("result", { mode: "json" }).$type<Record<string, unknown>>(), attempts: integer("attempts").notNull().default(0), error: text("error"), ...timestamps,
}, (t) => [index("import_items_job_idx").on(t.jobId, t.status)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), productId: text("product_id").references(() => products.id), actorEmail: text("actor_email").notNull(), action: text("action").notNull(),
  targetType: text("target_type").notNull(), targetId: text("target_id").notNull(), changes: text("changes", { mode: "json" }).$type<Record<string, unknown>>().notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [index("audit_events_product_idx").on(t.productId, t.createdAt)]);

export const adminSessions = sqliteTable("admin_sessions", {
  id: text("id").primaryKey(), tokenHash: text("token_hash").notNull(), username: text("username").notNull(),
  expiresAt: integer("expires_at").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("admin_sessions_token_hash_uq").on(t.tokenHash), index("admin_sessions_expires_idx").on(t.expiresAt)]);
