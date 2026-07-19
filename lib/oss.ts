import { platformEnv } from "./platform-runtime";

function encodePath(key: string) {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export type OssAssetConfig = { endpoint: string; bucket: string };

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
