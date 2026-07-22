const encoder = new TextEncoder();

export type OssV4Credentials = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  securityToken?: string;
};

function hex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(key: ArrayBuffer | Uint8Array | string, value: string) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

export function ossTimestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export async function signOssV4Put(
  bucket: string,
  objectKey: string,
  contentType: string,
  credentials: OssV4Credentials,
  date = new Date(),
) {
  const timestamp = ossTimestamp(date);
  const signDate = timestamp.slice(0, 8);
  const scope = `${signDate}/${credentials.region}/oss/aliyun_v4_request`;
  const canonicalUri = `/${bucket}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  const signedHeaders: Record<string, string> = {
    "content-type": contentType,
    "x-oss-content-sha256": "UNSIGNED-PAYLOAD",
    "x-oss-date": timestamp,
  };
  if (credentials.securityToken) signedHeaders["x-oss-security-token"] = credentials.securityToken;
  const canonicalHeaders = Object.entries(signedHeaders)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value.trim()}\n`)
    .join("");
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n\nUNSIGNED-PAYLOAD`;
  const stringToSign = `OSS4-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonicalRequest)}`;
  const dateKey = await hmac(`aliyun_v4${credentials.accessKeySecret}`, signDate);
  const regionKey = await hmac(dateKey, credentials.region);
  const serviceKey = await hmac(regionKey, "oss");
  const signingKey = await hmac(serviceKey, "aliyun_v4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  return {
    ...signedHeaders,
    authorization: `OSS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope},Signature=${signature}`,
  };
}
