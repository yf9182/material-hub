---
name: trending-template-publisher
description: Research public global image-to-image trends and use the Material Hub Trending MCP to create safe, bilingual drafts with generated 1000x1200 covers, previews, and explicitly confirmed batch publishing. Use when the user asks for hot image-to-image templates, Trending drafts, cover generation, or publishing; never use it to publish without an explicit confirmation.
---

# Trending Template Publisher

Use this skill to run the complete “research → generate → stage → preview → confirm → publish” workflow for product `8801`. The MCP owns catalog writes, media validation, deduplication, revisions, and audit history. Codex owns public trend research, safety judgment, prompt design, and ImageGen cover creation.

## Required order

1. Call `inspect_trending_context` before making candidates. Call `ensure_trending_category` when the category is missing or not first.
2. Research the last 30 days of public, reachable web pages. Prefer signals from the last 7 days. Every candidate needs at least two independent platforms, HTTPS URLs, observed dates, and a short factual signal. Do not bypass login, paywalls, anti-bot controls, or copy source images.
3. Rank candidates by recency, cross-platform confirmation, public engagement, and suitability for image-to-image transformation. Select at most three. Avoid real-person identity, protected characters/logos, and naming living artists for imitation. Record the safety decision and selection rationale.
4. Prefer a before/after cover whenever the concept can support a genuine, visually useful comparison:
   - `displayType: 1` means a genuine before/after comparison. Generate an original reference “before” image first, then generate the effect from that same reference and composition. Submit both matching 1000×1200 covers. Never invent a comparison from unrelated images.
   - `displayType: 2` means one complete effect cover. Submit one 1000×1200 cover; the MCP stores it as both thumbnail and original. Use this only when a meaningful, composition-matched before/after pair cannot be made safely or would misrepresent the template.
   - In the preview, explain why type 1 was selected; if type 2 is used, explicitly record why a real comparison was unavailable. `imageCount` is separate: it describes whether the user must upload one or two reference images. Do not infer it from `displayType`.
5. Choose price `10` for a simple single-reference effect and `20` for two-image input or clearly complex compositing. The MCP keeps `material.price` and `material_config.price` aligned and appends the shared image-reference prompt policy.
6. Build a candidate worksheet before generating assets. Every candidate must have a different lifestyle subject/pose/scene and its own `beforePrompt`; the before prompt must be materially different from the final template prompt. Generate the before image from that exact before prompt, then generate the after image from the same before image and the candidate's final prompt. Put generated files inside `MATERIAL_HUB_MCP_MEDIA_ROOT`. Call `stage_trending_template` once per candidate with stable lowercase `trendKey`, bilingual titles, final prompt, `beforePrompt`, evidence, safety review, `displayType`, `imageCount`, price, and the correct cover paths. A repeated trend key updates its draft; matching title or prompt returns a conflict instead of duplicating.
7. Call `preview_trending_templates` once for the whole batch and show the user each before/after cover, title, evidence, safety notes, display type, image count, price, prompt summary, recorded `beforePrompt`, and revision. Check that every type-1 pair has different hashes, matching dimensions, and the same subject/pose/scene by visual inspection. Explain why type 1 or type 2 was selected. Note that Codex ImageGen covers can differ from the production app’s Gemini 2.5 Flash Image result.
8. Stop and ask for concrete approval, for example: “发布 Trending 草稿 `id-a` 和 `id-b`，revision 保持不变。” Do not call `publish_trending_templates` for a vague request such as “looks good”. Only after explicit approval call it with exactly the approved IDs and revisions plus `confirmation: "CONFIRM_PUBLISH"`.
9. After publishing, call `inspect_trending_context` or the production App API to verify Trending ordering, published status, cover URLs, type, image count, price, and prompt. Report any mismatch rather than silently repairing it.

## Safety and recovery

- Treat `publish_trending_templates` as high-risk. It validates every item and publishes all items in one D1 batch; if any revision, evidence, asset, or safety check fails, nothing is published.
- Never place tokens in prompts, images, source snapshots, the repository, or `.codex/config.toml`. The local MCP receives the token through `env_vars`; the worker stores only its SHA-256 hash in `MATERIAL_HUB_MCP_TOKEN_HASH`.
- If a preview revision changes, discard the old approval and preview again. If a stage fails after media upload, the draft remains unchanged; report the error and clean up orphaned R2 objects through the normal operator recovery process.
- If no safe candidate has two independent public signals, do not manufacture a trend. Return the candidates and the missing evidence instead.
