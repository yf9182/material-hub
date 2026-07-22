import { platformEnv } from "./platform-runtime";
import { signOssV4Put } from "./oss-v4";

function encodePath(key: string) {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export type OssAssetConfig = { endpoint: string; bucket: string };
export type OssWriteConfig = OssAssetConfig & { region: string; accessKeyId: string; accessKeySecret: string; securityToken?: string };

export function ossConfig(): OssAssetConfig | null {
  const env = platformEnv();
  const endpoint = String(env.OSS_ENDPOINT ?? "").trim().replace(/\/+$/, "");
  const bucket = String(env.OSS_BUCKET ?? "").trim();
  if (!endpoint || !bucket) return null;
  return { endpoint, bucket };
}

/** Build a stable public virtual-hosted OSS URL; bytes go directly from OSS to App. */
export function publicOssURL(key: string, config = ossConfig()) {
  if (!config || !key) return null;
  const endpoint = new URL(config.endpoint);
  endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `/${encodePath(key)}`;
  endpoint.search = "";
  return endpoint.toString();
}

export function ossWriteConfig(): OssWriteConfig {
  const env = platformEnv();
  const readable = ossConfig();
  const region = String(env.OSS_REGION ?? "").trim();
  const accessKeyId = String(env.OSS_ACCESS_KEY_ID ?? "").trim();
  const accessKeySecret = String(env.OSS_ACCESS_KEY_SECRET ?? "").trim();
  const securityToken = String(env.OSS_SESSION_TOKEN ?? "").trim() || undefined;
  if (!readable || !region || !accessKeyId || !accessKeySecret) throw new Error("尚未配置完整的 OSS 上传凭据");
  return { ...readable, region, accessKeyId, accessKeySecret, securityToken };
}

export async function putOssObject(key: string, body: ReadableStream, contentType: string, config = ossWriteConfig()) {
  const target = new URL(config.endpoint);
  target.hostname = `${config.bucket}.${target.hostname}`;
  target.pathname = `/${encodePath(key)}`;
  target.search = "";
  const headers = await signOssV4Put(config.bucket, key, contentType, config);
  const response = await fetch(target, { method: "PUT", headers, body });
  if (!response.ok) {
    const requestId = response.headers.get("x-oss-request-id");
    throw new Error(`OSS 上传失败：HTTP ${response.status}${requestId ? `（${requestId}）` : ""}`);
  }
}
