import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeReferencePayload } from "../lib/material-platform.ts";

const categoryTreeFixture = { code: 1, data: { list: [{ id: "root-a", parent_id: "", name: "Root A", children: [{ id: "child-a", parent_id: "root-a", name: "Child A", children: [] }] }, { id: "root-b", parent_id: "", name: "Root B", children: [{ id: "child-b", parent_id: "root-b", name: "Child B", children: [] }] }] } };
const material = (prefix, index) => ({ id: `${prefix}-relation-${index}`, material_id: `${prefix}-material-${index}`, public_properties: { material_config: { value: [`{"type":${index % 3 + 1},}`], data: {} }, original_file_id: { data: { id: `${prefix}-original-${index}`, cdn_url: `https://cdn.example.test/${prefix}/${index}.jpg` } } }, independent_properties: { thumbnail_file_id: { data: { id: `${prefix}-thumb-${index}`, cdn_url: `https://cdn.example.test/${prefix}/${index}-thumb.jpg` } } } });
const materialGroupsFixture = { code: 1, data: { group: [{ product_material_category_id: "child-a", pager: { total: 6 }, list: Array.from({ length: 6 }, (_, index) => material("six", index)) }, { product_material_category_id: "child-b", pager: { total: 15 }, list: Array.from({ length: 15 }, (_, index) => material("fifteen", index)) }] } };

test("sanitized 6-plus-15 reference fixture normalizes with owned-storage asset manifests", () => {
  const categories = normalizeReferencePayload(categoryTreeFixture);
  const groups = normalizeReferencePayload(materialGroupsFixture);
  assert.equal(categories.summary.categories, 4);
  assert.equal(groups.summary.materials, 21);
  assert.equal(groups.summary.assets, 42);
  assert.equal(groups.summary.warnings, 0);
  assert.ok(groups.groups.every((group) => group.items.every((item) => item.public_properties.original_file_id.data.cdn_url)));
});

test("integration surfaces keep the durable storage contract", () => {
  const schema = fs.readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  const assets = fs.readFileSync(new URL("../app/api/admin/assets/route.ts", import.meta.url), "utf8");
  const repository = fs.readFileSync(new URL("../lib/catalog-repository.ts", import.meta.url), "utf8");
  const importRoute = fs.readFileSync(new URL("../app/api/admin/import/route.ts", import.meta.url), "utf8");
  for (const table of ["products", "categories", "materials", "material_categories", "assets", "api_keys", "import_jobs", "import_items", "audit_events"]) assert.match(schema, new RegExp(`sqliteTable\\(\\"${table}\\"`));
  assert.match(assets, /MATERIAL_ASSETS\.put/);
  assert.match(assets, /INSERT INTO assets/);
  assert.match(repository, /putOssObject/);
  assert.match(repository, /storage_provider, oss_key/);
  assert.match(importRoute, /mode === "material-id"/);
  assert.match(importRoute, /parent_id IS NOT NULL/);
});

test("admin and client contracts include localized titles, media previews, and price", () => {
  const consoleSource = fs.readFileSync(new URL("../app/admin/MaterialConsole.tsx", import.meta.url), "utf8");
  const repository = fs.readFileSync(new URL("../lib/catalog-repository.ts", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../lib/ensure-schema.ts", import.meta.url), "utf8");
  assert.match(consoleSource, /preferredTitle\(item\.title_translations, item\.internal_name\)/);
  assert.match(consoleSource, /MediaPreview/);
  assert.match(consoleSource, /积分价格/);
  assert.match(repository, /independent\.price = wrapper\("price"/);
  assert.match(schema, /ADD COLUMN price INTEGER DEFAULT 10/);
});

test("image template detail and stable point-price backfill contracts exist", () => {
  const route = fs.readFileSync(new URL("../app/api/v1/product-material/[materialId]/route.ts", import.meta.url), "utf8");
  const script = fs.readFileSync(new URL("../scripts/backfill-image-template-prices.mjs", import.meta.url), "utf8");
  const repository = fs.readFileSync(new URL("../lib/catalog-repository.ts", import.meta.url), "utf8");
  assert.match(route, /requireApiProduct/);
  assert.match(route, /MATERIAL_NOT_FOUND/);
  assert.match(repository, /export async function materialById/);
  assert.match(script, /image-template-price-v2/);
  assert.match(script, /THEN 10 ELSE 20|charCodeAt/);
  assert.match(script, /material\.price\.backup/);
});

test("admin and client use the same category-scoped material order", () => {
  const consoleSource = fs.readFileSync(new URL("../app/admin/MaterialConsole.tsx", import.meta.url), "utf8");
  const adminRoute = fs.readFileSync(new URL("../app/api/admin/catalog/route.ts", import.meta.url), "utf8");
  const repository = fs.readFileSync(new URL("../lib/catalog-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /ORDER BY r\.sort_order ASC, r\.created_at ASC, r\.id ASC/);
  assert.match(repository, /sort_order=excluded\.sort_order/);
  assert.match(adminRoute, /category_relations: categoryRelations/);
  assert.match(consoleSource, /leftRelation\?\.sort_order/);
  assert.match(consoleSource, /leftRelation\?\.created_at/);
});
