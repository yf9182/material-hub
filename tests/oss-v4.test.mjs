import assert from "node:assert/strict";
import test from "node:test";
import { signOssV4Put } from "../lib/oss-v4.ts";

test("creates a deterministic OSS V4 PutObject authorization header", async () => {
  const headers = await signOssV4Put(
    "examplebucket",
    "materials/8801/a.jpg",
    "image/jpeg",
    { accessKeyId: "testid", accessKeySecret: "testsecret", region: "ap-southeast-1" },
    new Date("2026-07-21T12:00:00.000Z"),
  );
  assert.equal(headers["x-oss-date"], "20260721T120000Z");
  assert.equal(headers["x-oss-content-sha256"], "UNSIGNED-PAYLOAD");
  assert.equal(headers.authorization, "OSS4-HMAC-SHA256 Credential=testid/20260721/ap-southeast-1/oss/aliyun_v4_request,Signature=8819c3b4e0e3678b079585fbfadf796ad2162fd42361ac14c09c2743594a6e56");
  assert.equal(headers.authorization.includes("testsecret"), false);
});

test("signs an optional STS token without exposing the secret", async () => {
  const headers = await signOssV4Put("bucket", "路径/file name.png", "image/png", { accessKeyId: "id", accessKeySecret: "secret", region: "cn-hangzhou", securityToken: "token" }, new Date("2026-01-02T03:04:05.000Z"));
  assert.equal(headers["x-oss-security-token"], "token");
  assert.match(headers.authorization, /^OSS4-HMAC-SHA256 Credential=id\/20260102\/cn-hangzhou\/oss\/aliyun_v4_request,Signature=[a-f0-9]{64}$/);
  assert.equal(headers.authorization.includes("secret"), false);
});
