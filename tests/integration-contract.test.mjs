import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeReferencePayload } from "../lib/material-platform.ts";

const categoryTreeFixture = { code: 1, data: { list: [{ id: "root-a", parent_id: "", name: "Root A", children: [{ id: "child-a", parent_id: "root-a", name: "Child A", children: [] }] }, { id: "root-b", parent_id: "", name: "Root B", children: [{ id: "child-b", parent_id: "root-b", name: "Child B", children: [] }] }] } };
const material = (prefix, index) => ({ id: `${prefix}-relation-${index}`, material_id: `${prefix}-material-${index}`, public_properties: { material_config: { value: [`{"type":${index % 3 + 1},}`], data: {} }, original_file_id: { data: { id: `${prefix}-original-${index}`, cdn_url: `https://cdn.example.test/${prefix}/${index}.jpg` } } }, independent_properties: { thumbnail_file_id: { data: { id: `${prefix}-thumb-${index}`, cdn_url: `https://cdn.example.test/${prefix}/${index}-thumb.jpg` } } } });
const materialGroupsFixture = { code: 1, data: { group: [{ product_material_category_id: "child-a", pager: { total: 6 }, list: Array.from({ length: 6 }, (_, index) => material("six", index)) }, { product_material_category_id: "child-b", pager: { total: 15 }, list: Array.from({ length: 15 }, (_, index) => material("fifteen", index)) }] } };

test("sanitized 6-plus-15 reference fixture normalizes with D1/R2-ready asset manifests", () => {
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
  for (const table of ["products", "categories", "materials", "material_categories", "assets", "api_keys", "import_jobs", "import_items", "audit_events"]) assert.match(schema, new RegExp(`sqliteTable\\(\\"${table}\\"`));
  assert.match(assets, /MATERIAL_ASSETS\.put/);
  assert.match(assets, /INSERT INTO assets/);
});
