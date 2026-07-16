## Why

The App currently depends on a third-party material service whose categories, files, and response formats are outside our control. We need an owned material platform that preserves the useful reference API contract while making category management, publishing, file ownership, and repeatable JSON imports operationally safe.

## What Changes

- Add a Chinese web administration system for products, two-level categories, materials, publishing state, API keys, import history, and audit history.
- Add durable product and material metadata in Cloudflare D1 and copy imported/uploaded images, video, and audio into Cloudflare R2.
- Add one-click imports from the configured reference Basic Auth API and from uploaded or pasted reference JSON.
- Preserve reference category-tree and multi-category material-group response shapes, while adding a single-secondary-category material endpoint.
- Add product-scoped API-key authentication for App reads and ChatGPT sign-in plus email allowlisting for administration.
- Add smart re-import behavior that updates source-owned data, preserves manual overrides, resumes partial jobs, and reports per-record outcomes.
- Add draft, publish, disable, archive, and restore lifecycle behavior; App endpoints expose only published, non-archived content.

## Capabilities

### New Capabilities

- `catalog-administration`: Product, two-level category, material, localization, ordering, lifecycle, and audit management in the web admin.
- `material-import`: Reference API and JSON ingestion, validation, upsert rules, manual-override preservation, file copying, resumability, and import reporting.
- `app-material-api`: API-key protected compatibility endpoints for category trees, multiple secondary categories, and a new single-category material response.
- `asset-storage`: R2-backed upload/import storage, metadata, deduplication, delivery, and media-type publication requirements.
- `admin-access`: ChatGPT sign-in, administrator email allowlisting, product-scoped API-key issuance, revocation, and secret handling.

### Modified Capabilities

None.

## Impact

- Introduces a new Vinext/Cloudflare Sites application with D1 schema and migrations, R2 bindings, server-rendered admin pages, route handlers, and shared compatibility DTOs.
- Adds OpenSpec artifacts as the source of truth for scope, design, requirements, and implementation tasks.
- Adds hosted runtime secrets for the reference API credentials and administrator allowlist; credentials must never be committed or returned to the browser.
- Produces public App API routes protected by product API keys and protected `/admin` routes for authorized administrators.
