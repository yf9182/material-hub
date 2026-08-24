import { applyPromptPolicy, IMAGE_REFERENCE_INSTRUCTION, MAX_PROMPT_LENGTH, prepareMaterialConfig, type JsonObject } from "./material-platform.ts";

export const STANDARD_SCHEMA_VERSION = 1;
export const STANDARD_PRESETS = ["image_to_image", "image_to_video"] as const;
export type StandardPreset = typeof STANDARD_PRESETS[number];

export type StandardMaterialInput = {
  preset?: unknown;
  type?: unknown;
  image_count?: unknown;
  imageCount?: unknown;
  video_duration?: unknown;
  videoDuration?: unknown;
  video_resolution?: unknown;
  videoResolution?: unknown;
  price?: unknown;
  prompt?: unknown;
  file_url?: unknown;
  fileUrl?: unknown;
  extensions?: unknown;
  [key: string]: unknown;
};

export type StandardConfigResult = {
  config: JsonObject;
  warnings: string[];
  errors: string[];
  changed: boolean;
};

const CORE_KEYS = new Set(["schema_version", "preset", "type", "image_count", "video_duration", "video_resolution", "price", "prompt", "file_url", "extensions"]);

function integer(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function extensionMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: JsonObject = {};
  for (const [namespace, payload] of Object.entries(value as JsonObject)) {
    if (!/^[A-Za-z0-9_-]+$/.test(namespace)) return null;
    result[namespace] = payload;
  }
  return result;
}

export function standardizeMaterialConfig(input: StandardMaterialInput | JsonObject): StandardConfigResult {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const preset = String(source.preset ?? "image_to_image").trim();
  const type = integer(source.type, 2);
  const imageCount = integer(source.image_count ?? source.imageCount, 1);
  const videoDuration = integer(source.video_duration ?? source.videoDuration, 5);
  const videoResolution = String(source.video_resolution ?? source.videoResolution ?? "720p").trim();
  const defaultPrice = preset === "image_to_video" ? 20 : 10;
  const price = integer(source.price, defaultPrice);
  const prompt = String(source.prompt ?? "").trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!STANDARD_PRESETS.includes(preset as StandardPreset)) errors.push("preset 必须是 image_to_image 或 image_to_video");
  if (type !== 1 && type !== 2) errors.push("type 必须是 1 或 2");
  if (imageCount !== 1 && imageCount !== 2) errors.push("image_count 必须是 1 或 2");
  if (preset === "image_to_video" && ![5, 10, 15].includes(videoDuration)) errors.push("video_duration 必须是 5、10 或 15 秒");
  if (preset === "image_to_video" && !["720p", "1080p"].includes(videoResolution)) errors.push("video_resolution 必须是 720p 或 1080p");
  if (!Number.isInteger(price) || price < 0) errors.push("price 必须是非负整数");
  if (!prompt) errors.push("配置中的 prompt 不能为空");
  if (prompt.length > MAX_PROMPT_LENGTH) errors.push(`prompt 最多支持 ${MAX_PROMPT_LENGTH} 个字符`);
  const extensions = extensionMap(source.extensions ?? {});
  if (!extensions) errors.push("extensions 必须是以 App 名称为 key 的 JSON 对象");
  const fileURL = String(source.file_url ?? source.fileUrl ?? "").trim();
  if (fileURL) {
    try { if (new URL(fileURL).protocol !== "https:") errors.push("file_url 必须使用 HTTPS"); } catch { errors.push("file_url 必须是合法 URL"); }
  }
  const promptPolicy = prompt ? applyPromptPolicy({ prompt }) : { config: { prompt }, changed: false };
  const config: JsonObject = {
    schema_version: STANDARD_SCHEMA_VERSION,
    preset,
    type,
    image_count: imageCount,
    ...(preset === "image_to_video" ? { video_duration: videoDuration, video_resolution: videoResolution } : {}),
    price,
    ...promptPolicy.config,
    ...(fileURL ? { file_url: fileURL } : {}),
    extensions: extensions ?? {},
  };
  for (const key of Object.keys(source)) {
    if (!CORE_KEYS.has(key) && key !== "imageCount" && key !== "fileUrl") warnings.push(`已忽略未放入 extensions 的字段：${key}`);
  }
  if (prompt && !prompt.includes(IMAGE_REFERENCE_INSTRUCTION)) warnings.push("prompt 已自动补充图像参考策略");
  return { config, warnings, errors, changed: JSON.stringify(config) !== JSON.stringify(source) };
}

export function validateStandardMaterialConfig(input: StandardMaterialInput | JsonObject) {
  const result = standardizeMaterialConfig(input);
  const prepared = prepareMaterialConfig(JSON.stringify(result.config));
  if ("error" in prepared) result.errors.push(prepared.error);
  else result.config = prepared.config;
  return result;
}

export function standardMediaRoles(preset: string) {
  return preset === "image_to_video" ? ["original", "thumbnail", "preview"] : ["original", "thumbnail"];
}
