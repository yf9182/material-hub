## Context

The repository is a new Vinext application targeting Cloudflare Sites. The reference service exposes a two-level category tree and material relationship records grouped by secondary-category ID. A relationship record has its own `id`, points to a reusable `material_id`, and wraps values in `public_properties` and `independent_properties`. Imported `material_config` is not reliable JSON: six of the twenty-one inspected records contain invalid syntax, so the platform cannot use strict parsing as an ingestion gate.

The site has two audiences: administrators who manage and import content, and native App clients that need stable, read-only material responses. Administrative routes require user identity and authorization. App routes must remain publicly reachable but authenticate against product-scoped API keys.

## Goals / Non-Goals

**Goals:**

- Own category/material metadata and all served media files.
- Preserve the reference response contract for the two requested endpoints and add a direct single-category endpoint.
- Make manual material creation require only key business fields while generating compatibility wrappers automatically.
- Support repeatable, resumable imports without discarding administrator overrides.
- Support multiple products from the initial schema while bootstrapping product `8801`.
- Keep secrets server-side and produce auditable administrative changes.

**Non-Goals:**

- Reimplement every field or workflow of the reference provider's internal administration system.
- Provide end-user App accounts or per-user material personalization.
- Run media transcoding, AI generation, or automatic translation in v1.
- Maintain independent catalogs for multiple channels within one product in v1; each product has one default channel/source pair.

## Decisions

### Cloudflare-native application

Use the existing Vinext starter, server-rendered admin routes, Cloudflare-compatible route handlers, D1 for relational metadata, and R2 for file bytes. Logical bindings are `DB` and `MATERIAL_ASSETS` (`ASSETS` remains reserved for the site's static-file fetcher). This keeps deployment within Sites and avoids operating a separate API service. PostgreSQL/S3 and a separate backend were rejected because they add infrastructure without improving the requested v1 workflows.

### Relational identity model

Store products, categories, materials, material-category relationships, assets, API keys, import jobs/items, and audit events as separate D1 tables. Categories have nullable `parent_id` and a database constraint/application validation that permits only root or second-level nodes. Materials are product-scoped and connect only to second-level categories through relationship rows. API-facing IDs are 24-character lowercase hexadecimal text; imported external IDs are preserved when valid and otherwise mapped through dedicated external-ID columns.

The relationship row owns the compatibility `id`, ordering, and listing state, while the material owns `material_id`, translations, config, files, and publish state. This reproduces the observed reference semantics when one material appears in more than one category.

### Effective values and manual overrides

Persist the latest imported source snapshot separately from administrator override data. Reads compute an effective material by applying explicit overrides over the source snapshot. Re-import replaces source-owned values but never clears an override. Administrators can reset an individual override to resume source tracking. This was chosen over skip-on-conflict and full overwrite because both lose either upstream updates or local editorial work.

### Compatibility DTO boundary

Internal tables remain normalized. A dedicated serializer builds reference-compatible category nodes and material records at the API boundary, including `code/value/data` wrappers, translation IDs, empty known fields, Unix-second timestamps, and `{code: 1, msg: "OK"}` envelopes. The server stores `material_config_raw` verbatim and also stores best-effort normalized JSON. Outbound compatibility responses use the effective raw string so malformed imported source data is not silently changed.

### Import pipeline

Both source-API synchronization and pasted/uploaded JSON normalize into the same import manifest. Import consists of preview, confirmed job creation, and bounded batches initiated by the admin client. Each batch claims pending items, upserts metadata transactionally, streams changed remote files into R2, and records per-item outcomes. Closing the page pauses rather than corrupts the job; reopening resumes pending batches.

Configuration parsing first tries strict JSON, then a conservative repair pass for trailing commas and similar syntax. Parse failure produces a warning and retains raw content. Assets deduplicate on content hash when available and otherwise on stable source URL plus source metadata. Newly imported records with required-file failures remain draft.

### Publication and deletion

New manual and imported materials default to draft unless the imported record is explicitly published and all required assets copied successfully. Public API queries require published, listed, non-archived products/categories/relationships/materials. Delete actions archive records; categories with active descendants or material relationships cannot be hard deleted. Restore is supported from the audit-preserving archive.

### Authentication and secrets

Protect `/admin` pages and administrative actions with dispatch-owned Sign in with ChatGPT and a server-side `ADMIN_EMAILS` allowlist. Protect App reads with `X-API-Key`; raw keys are shown once, only a prefix and SHA-256 hash are stored, and keys are product-scoped and revocable. Store reference Basic Auth values as hosted runtime secrets named `REFERENCE_API_USERNAME` and `REFERENCE_API_PASSWORD`. Never log request authorization headers or secret values.

### Admin interface

Use a compact Chinese enterprise console with a persistent product switcher and navigation for dashboard, categories, materials, imports, API keys, and audit events. The material editor requires product, one or more secondary categories, internal name, English display name, and original file. Images can reuse the original as thumbnail; video publication requires a thumbnail. Optional sections expose description, translations, versions, preview media, pricing/recommendation fields, and advanced configuration.

The selected visual direction is **A — Indigo lightweight enterprise console**: `#F5F7FB` canvas, white panels, `#15192B` sidebar, `#5B5CE2` primary accent, 224px desktop navigation, a 68px top bar, four metric cards, and a category-tree plus material-grid workspace. The responsive version collapses navigation and stacks the category tree above the grid.

## Risks / Trade-offs

- [A mobile App API key can be extracted from a distributed binary] → Support rapid rotation, product scoping, revocation, and future signed-request migration; treat the key as access control rather than user identity.
- [Large remote videos can exceed request-duration or body limits] → Stream directly to R2, process bounded batches, persist progress, and leave failed records resumable and unpublished.
- [Malformed or truncated source configuration cannot be normalized safely] → Preserve raw strings, expose warnings, and only populate normalized fields when parsing succeeds.
- [Source records can change during a multi-batch import] → Record job start metadata and process each fetched manifest as an immutable job snapshot.
- [Public deployment exposes route existence] → Require API keys for every App endpoint and SIWC plus allowlisting for every administrative read or write.

## Migration Plan

1. Add D1/R2 declarations, schema, generated migration, and required runtime-variable documentation.
2. Deploy schema and bootstrap product `8801` with default `English` channel/source.
3. Configure the administrator allowlist and reference credentials as hosted secrets.
4. Create an initial product API key, run a reference import, verify counts and copied files, then publish selected content.
5. Point the App at compatibility endpoints and monitor audit/import failures.

Rollback deploys the previous application version. Database migrations are additive for v1; imported records and R2 objects remain available for retry or cleanup rather than being destructively rolled back.

## Open Questions

None. Administrator email values and production secret values are deployment inputs, not design decisions.
