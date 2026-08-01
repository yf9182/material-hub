export type JsonObject = Record<string, unknown>;
export type LangMap = Record<string, { code: string; content: string; is_default: number }>;

export const IMAGE_REFERENCE_INSTRUCTION = "Use the uploaded image as the primary reference. Preserve the subject's identity and key visual features.";
export const INCOMPLETE_PROMPT_INSTRUCTION = "If the preceding description ends mid-phrase, complete it coherently while preserving the stated concept, composition, lighting, and style.";
export const MAX_PROMPT_LENGTH = 8000;

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

export function preferredTitle(value: unknown, fallback: string) {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return {}; } })() : value;
  const translations = safeObject(parsed);
  const content = (lang: string) => { const item = safeObject(translations[lang]); return String(item.content ?? "").trim(); };
  return content("zh-cn") || content("en") || fallback;
}

export function parseJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "string" || !value.trim()) return {};
  try { return safeObject(JSON.parse(value)); } catch {}
  try { return safeObject(JSON.parse(value.replace(/,\s*([}\]])/g, "$1"))); } catch { return null; }
}

export function applyPromptPolicy(config: JsonObject) {
  const rawPrompt = typeof config.prompt === "string" ? config.prompt : "";
  const sourcePrompt = rawPrompt.trim();
  if (!sourcePrompt) return { config, sourcePromptLength: 0, promptLength: 0, changed: false };
  const hadImageInstruction = sourcePrompt.includes(IMAGE_REFERENCE_INSTRUCTION);
  const hadIncompleteInstruction = sourcePrompt.includes(INCOMPLETE_PROMPT_INSTRUCTION);
  let basePrompt = sourcePrompt;
  for (const instruction of [IMAGE_REFERENCE_INSTRUCTION, INCOMPLETE_PROMPT_INSTRUCTION]) {
    if (basePrompt.endsWith(instruction)) basePrompt = basePrompt.slice(0, -instruction.length).trimEnd();
  }
  let prompt = basePrompt;
  if (hadIncompleteInstruction || basePrompt.length >= 1000 || (!hadImageInstruction && rawPrompt.length >= 1000)) prompt += `\n\n${INCOMPLETE_PROMPT_INSTRUCTION}`;
  prompt += `\n\n${IMAGE_REFERENCE_INSTRUCTION}`;
  return { config: prompt === sourcePrompt ? config : { ...config, prompt }, sourcePromptLength: basePrompt.length, promptLength: prompt.length, changed: prompt !== sourcePrompt };
}

export function prepareMaterialConfig(value: unknown) {
  const config = parseJsonObject(value);
  if (!config) return { error: "配置必须是 JSON 对象" } as const;
  const prompt = typeof config.prompt === "string" ? config.prompt.trim() : "";
  if (!prompt) return { error: "配置中的 prompt 不能为空" } as const;
  const prepared = applyPromptPolicy({ ...config, prompt });
  if (prepared.sourcePromptLength > MAX_PROMPT_LENGTH) return { error: `prompt 最多支持 ${MAX_PROMPT_LENGTH} 个字符` } as const;
  return { config: prepared.config, raw: JSON.stringify(prepared.config), sourcePromptLength: prepared.sourcePromptLength, changed: prepared.changed } as const;
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

export type ImportedAssetReference = {
  role: string;
  section: "public_properties" | "independent_properties" | "material_config";
  key: string;
  data: JsonObject;
};

const importedAssetRoles: Record<string, string> = {
  original_file_id: "original",
  thumbnail_file_id: "thumbnail",
  video_preview_file_id: "preview",
  audio_file_id: "audio",
  hp_ol_original_1_file_id: "hp_ol_original_1",
  hp_ol_original_2_file_id: "hp_ol_original_2",
  hp_ol_original_3_file_id: "hp_ol_original_3",
  hp_ol_thumbnail_2_file_id: "hp_ol_thumbnail_2",
};

export function importedAssetReferences(item: JsonObject) {
  const references: ImportedAssetReference[] = [];
  const seen = new Set<string>();
  for (const section of ["public_properties", "independent_properties"] as const) {
    for (const [key, raw] of Object.entries(safeObject(item[section]))) {
      if (!key.endsWith("_file_id") && key !== "file_url") continue;
      const data = safeObject(safeObject(raw).data);
      const url = String(data.cdn_url ?? "").trim();
      if (!url) continue;
      const role = importedAssetRoles[key] ?? (key === "file_url" ? "file" : key.replace(/_file_id$/, ""));
      const signature = `${role}:${url}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      references.push({ role, section, key, data });
    }
  }
  const config = parseJsonObject(propertyValue(item, "public_properties", "material_config"));
  const fileURL = config && typeof config.file_url === "string" ? config.file_url.trim() : "";
  if (fileURL && !seen.has(`file:${fileURL}`)) references.push({ role: "file", section: "material_config", key: "file_url", data: { cdn_url: fileURL, name: "file_url" } });
  return references;
}

export function isMaterialImportId(value: unknown) {
  return /^[a-f0-9]{24}$/.test(String(value ?? "").trim().toLowerCase());
}

export function normalizeSingleMaterialPayload(payload: unknown, categoryId: string): ImportManifest {
  if (!categoryId) throw new Error("必须选择二级分类");
  const root = safeObject(payload);
  const data = safeObject(root.data);
  const nested = safeObject(data.item ?? data.material ?? data.product_material);
  const item = Object.keys(nested).length ? nested : data;
  if (!Object.keys(safeObject(item.public_properties)).length || !Object.keys(safeObject(item.independent_properties)).length) throw new Error("单素材接口返回结构无效");
  const externalId = String(item.material_id ?? item.id ?? "").trim();
  if (!externalId) throw new Error("单素材接口未返回素材 ID");
  const rawConfig = propertyValue(item, "public_properties", "material_config");
  const warnings = parseJsonObject(rawConfig) === null ? 1 : 0;
  return {
    kind: "material-groups",
    categories: [],
    groups: [{ categoryId, items: [item] }],
    summary: { categories: 0, materials: 1, assets: importedAssetReferences(item).length, warnings },
  };
}

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
    const assets = items.reduce((count, item) => count + importedAssetReferences(item).length, 0);
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
export function parsePrice(value: unknown, fallback: number | null) {
  if (value === undefined) return { value: fallback };
  if (value === null || String(value).trim() === "") return { value: null };
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? { value: parsed } : { error: "价格必须是非负整数" };
}

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
