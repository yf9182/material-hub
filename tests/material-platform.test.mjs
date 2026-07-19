import assert from "node:assert/strict";
import test from "node:test";
import { langMap, matchesProductContext, normalizeReferencePayload, pageParams, parseJsonObject, parsePrice, preferredTitle, propertyData, propertyValue, sha256Hex, wrapper } from "../lib/material-platform.ts";

test("repairs conservative trailing commas but preserves unrepairable configs", () => {
  assert.deepEqual(parseJsonObject('{"name":"Face", "type":2,}'), { name: "Face", type: 2 });
  assert.equal(parseJsonObject('{"name":"truncated'), null);
});

test("normalizes category trees", () => {
  const manifest = normalizeReferencePayload({ code: 1, data: { list: [{ id: "root", children: [{ id: "child", children: [] }] }] } });
  assert.equal(manifest.kind, "category-tree"); assert.equal(manifest.summary.categories, 2);
});

test("normalizes grouped materials and counts invalid configs", () => {
  const item = { id: "rel", material_id: "mat", public_properties: { material_config: { value: ['{"name":"broken"'] }, original_file_id: { data: { cdn_url: "https://cdn.test/a.jpg" } } }, independent_properties: {} };
  const manifest = normalizeReferencePayload({ code: 1, data: { group: [{ product_material_category_id: "cat", list: [item] }] } });
  assert.equal(manifest.kind, "material-groups"); assert.equal(manifest.summary.materials, 1); assert.equal(manifest.summary.assets, 1); assert.equal(manifest.summary.warnings, 1);
});

test("preserves the observed 6 plus 15 grouped pagination shape", () => {
  const make = (count, prefix) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-rel-${index}`, material_id: `${prefix}-mat-${index}`, public_properties: { material_config: { value: [index === 0 ? '{"type":2,}' : '{"type":2}'] } }, independent_properties: {} }));
  const manifest = normalizeReferencePayload({ code: 1, data: { group: [{ product_material_category_id: "creation", pager: { total: 6 }, list: make(6, "a") }, { product_material_category_id: "birthday", pager: { total: 15 }, list: make(15, "b") }] } });
  assert.equal(manifest.groups.length, 2); assert.equal(manifest.summary.materials, 21); assert.equal(manifest.summary.warnings, 0);
});

test("keeps DTO wrapper data and effective property lookup stable", () => {
  const item = { public_properties: { material_config: { code: "material_config", value: ["{\"type\":2}"], data: { format: "json" } } } };
  assert.equal(propertyValue(item, "public_properties", "material_config"), '{"type":2}');
  assert.deepEqual(propertyData(item, "public_properties", "material_config"), { format: "json" });
  assert.deepEqual(wrapper("demo", ["id"], { file: "a.jpg" }), { code: "demo", value: ["id"], data: { file: "a.jpg" } });
});

test("uses the agreed integer price semantics", () => {
  assert.deepEqual(parsePrice(undefined, 10), { value: 10 });
  assert.deepEqual(parsePrice("", 10), { value: null });
  assert.deepEqual(parsePrice("0", 10), { value: 0 });
  assert.deepEqual(parsePrice("25", 10), { value: 25 });
  assert.equal("error" in parsePrice("1.5", 10), true);
  assert.equal("error" in parsePrice("-1", 10), true);
});

test("prefers Chinese titles and falls back predictably", () => {
  assert.equal(preferredTitle({ en: { content: "English" }, "zh-cn": { content: "中文" } }, "Internal"), "中文");
  assert.equal(preferredTitle({ en: { content: "English" } }, "Internal"), "English");
  assert.equal(preferredTitle({}, "Internal"), "Internal");
});

test("preserves translations, pagination limits, and product context", () => {
  assert.deepEqual(langMap({ en: { content: "Hello", is_default: 1 }, "zh-cn": { content: "你好" } }), { en: { code: "en", content: "Hello", is_default: 1 }, "zh-cn": { code: "zh-cn", content: "你好", is_default: 0 } });
  assert.deepEqual(pageParams(new URL("https://example.test/?page=0&page_size=1000")), { page: 1, pageSize: 100, offset: 0 });
  assert.equal(matchesProductContext(new URL("https://example.test/?channel=English&source=English"), { channel: "English", source: "English" }), true);
  assert.equal(matchesProductContext(new URL("https://example.test/?channel=Chinese"), { channel: "English", source: "English" }), false);
});

test("hashes API key material deterministically without storing plaintext", async () => {
  const first = await sha256Hex("mat_test_secret");
  assert.equal(first, await sha256Hex("mat_test_secret"));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, "mat_test_secret");
});
