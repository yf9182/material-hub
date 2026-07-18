export type JsonObject = Record<string, unknown>;
export type LangMap = Record<string, { code: string; content: string; is_default: number }>;

export function nowSeconds() { return Math.floor(Date.now() / 1000); }
export function objectId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export function parseJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "string" || !value.trim()) return {};
  try { return safeObject(JSON.parse(value)); } catch {}
  try { return safeObject(JSON.parse(value.replace(/,\s*([}\]])/g, "$1"))); } catch { return null; }
}

export function propertyValue(item: JsonObject, section: "public_properties" | "independent_properties", key: string) {
  const wrapper = safeObject(safeObject(item[section])[key]);
  const values = Array.isArray(wrapper.value) ? wrapper.value : [];
  return values[0] ?? "";
}

export function propertyData(item: JsonObject, section: "public_properties" | "independent_properties", key: string) {
  return safeObject(safeObject(safeObject(item[section])[key]).data);
}

export type ImportManifest = {
  kind: "category-tree" | "material-groups";
  categories: JsonObject[];
  groups: Array<{ categoryId: string; items: JsonObject[] }>;
  summary: { categories: number; materials: number; assets: number; warnings: number };
};

export function normalizeReferencePayload(payload: unknown): ImportManifest {
  const root = safeObject(payload);
  const data = safeObject(root.data);
  if (Array.isArray(data.list)) {
    const roots = data.list.map(safeObject);
    const children = roots.flatMap((node) => Array.isArray(node.children) ? node.children.map(safeObject) : []);
    return { kind: "category-tree", categories: [...roots, ...children], groups: [], summary: { categories: roots.length + children.length, materials: 0, assets: 0, warnings: 0 } };
  }
  if (Array.isArray(data.group)) {
    let warnings = 0;
    const groups = data.group.map((raw) => {
      const group = safeObject(raw);
      const items = Array.isArray(group.list) ? group.list.map(safeObject) : [];
      for (const item of items) if (parseJsonObject(propertyValue(item, "public_properties", "material_config")) === null) warnings++;
      return { categoryId: String(group.product_material_category_id ?? ""), items };
    }).filter((group) => group.categoryId);
    const items = groups.flatMap((group) => group.items);
    const assets = items.reduce((count, item) => count + [
      propertyData(item, "public_properties", "original_file_id").cdn_url,
      propertyData(item, "independent_properties", "thumbnail_file_id").cdn_url,
      propertyData(item, "independent_properties", "video_preview_file_id").cdn_url,
    ].filter(Boolean).length, 0);
    return { kind: "material-groups", categories: [], groups, summary: { categories: groups.length, materials: items.length, assets, warnings } };
  }
  throw new Error("JSON 不是受支持的分类树或素材分组响应");
}

export function langMap(value: unknown): LangMap {
  const source = safeObject(value);
  const output: LangMap = {};
  for (const [key, raw] of Object.entries(source)) {
    const item = safeObject(raw);
    output[key] = { code: String(item.code ?? key), content: String(item.content ?? ""), is_default: Number(item.is_default ?? 0) };
  }
  return output;
}

export function translationData(item: JsonObject, key: "material_lang" | "activity_lang") {
  const data = propertyData(item, "independent_properties", key);
  return langMap(safeObject(data.lang));
}

export function wrapper(code: string, value: unknown[] = [], data: JsonObject = {}) { return { code, value, data }; }

export const emptyIndependentKeys = ["audio_file_id", "hp_ol_original_1_file_id", "hp_ol_original_2_file_id", "hp_ol_original_3_file_id", "hp_ol_thumbnail_2_file_id", "independent_config", "is_free", "material_mark_list", "max_version", "min_version", "video_height", "video_preview_file_id", "video_width"];

export function ok(data: unknown, status = 200) { return Response.json({ code: 1, data, msg: "OK" }, { status }); }
export function fail(error: string, status = 400, message = "请求失败") { return Response.json({ code: 0, data: { error }, msg: message }, { status }); }
export function pageParams(url: URL) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("page_size") ?? "100", 10) || 100));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export function matchesProductContext(url: URL, product: Record<string, unknown>) {
  const channel = url.searchParams.get("channel"); const source = url.searchParams.get("source");
  return (!channel || channel === product.channel) && (!source || source === product.source);
}
