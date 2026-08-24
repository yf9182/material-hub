import assert from "node:assert/strict";
import test from "node:test";
import { validateStandardMaterialConfig } from "../lib/standard-material.ts";

test("standard config defaults and prompt policy are stable", () => {
  const result = validateStandardMaterialConfig({ preset: "image_to_image", prompt: "Turn the uploaded portrait into a paper collage." });
  assert.deepEqual(result.errors, []);
  assert.equal(result.config.schema_version, 1);
  assert.equal(result.config.type, 2);
  assert.equal(result.config.image_count, 1);
  assert.equal(result.config.price, 10);
  assert.match(String(result.config.prompt), /Use the uploaded image as the primary reference/);
});

test("video preset includes duration and resolution and preserves namespaced extensions", () => {
  const result = validateStandardMaterialConfig({ preset: "image_to_video", prompt: "Animate the uploaded scene with a slow camera move.", video_duration: 15, video_resolution: "1080p", extensions: { app_demo: { motion: "slow" } } });
  assert.deepEqual(result.errors, []);
  assert.equal(result.config.price, 20);
  assert.equal(result.config.video_duration, 15);
  assert.equal(result.config.video_resolution, "1080p");
  assert.deepEqual(result.config.extensions, { app_demo: { motion: "slow" } });
});

test("video duration and resolution reject unsupported values", () => {
  const result = validateStandardMaterialConfig({ preset: "image_to_video", prompt: "Animate the uploaded scene.", video_duration: 8, video_resolution: "4k" });
  assert.ok(result.errors.some((error) => error.includes("video_duration")));
  assert.ok(result.errors.some((error) => error.includes("video_resolution")));
});

test("core fields cannot be replaced by extension-like top-level fields", () => {
  const result = validateStandardMaterialConfig({ preset: "bad", prompt: "x", extensions: { app_demo: { price: 999 } } });
  assert.ok(result.errors.some((error) => error.includes("preset")));
  assert.equal(result.config.price, 10);
  assert.equal(result.config.extensions.app_demo.price, 999);
});

test("invalid file URLs and oversized prompts are rejected", () => {
  const result = validateStandardMaterialConfig({ prompt: "x", file_url: "http://example.com/result.mp4" });
  assert.ok(result.errors.some((error) => error.includes("file_url")));
  const longPrompt = validateStandardMaterialConfig({ prompt: "x".repeat(8001) });
  assert.ok(longPrompt.errors.some((error) => error.includes("8000")));
});
