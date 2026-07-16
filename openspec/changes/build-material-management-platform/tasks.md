## 1. Foundation and persistence

- [x] 1.1 Configure D1/R2 bindings, environment examples, dependencies, and deployment metadata
- [x] 1.2 Define Drizzle tables and indexes for products, categories, materials, relationships, assets, API keys, imports, and audit events
- [x] 1.3 Generate and inspect the initial D1 migration and add id, hashing, localization, pagination, and database helpers
- [x] 1.4 Add idempotent runtime/bootstrap data for product 8801 and local development fixtures

## 2. Security and shared domain behavior

- [x] 2.1 Implement ChatGPT identity lookup, administrator allowlist enforcement, and protected admin actions
- [x] 2.2 Implement one-time product API-key issuance, SHA-256 lookup, revocation, and request authorization
- [x] 2.3 Implement effective source-plus-override material/category models and lifecycle filtering
- [x] 2.4 Implement R2 asset metadata, upload/import streaming, deduplication, role validation, and delivery

## 3. App API

- [x] 3.1 Implement reference-compatible category-tree serialization and endpoint
- [x] 3.2 Implement reference-compatible multi-category material serialization and endpoint
- [x] 3.3 Implement the single-secondary-category material endpoint
- [x] 3.4 Add stable error envelopes, pagination limits, product/channel/source validation, and API tests

## 4. Import system

- [x] 4.1 Implement reference category-tree and material-group JSON validation and manifest normalization
- [x] 4.2 Implement server-side Basic Auth reference fetch using hosted secrets
- [x] 4.3 Implement preview summaries, persisted jobs/items, batched processing, resume, and retry
- [x] 4.4 Implement smart upserts, manual-override preservation, tolerant config parsing, asset copy, and outcome reporting

## 5. Administration interface

- [x] 5.1 Replace the starter with the selected Chinese material-console shell, navigation, dashboard, and responsive styling
- [x] 5.2 Implement product switching and two-level category create/edit/order/archive/restore workflows
- [x] 5.3 Implement material list, filters, simplified create/edit form, category assignment, upload, publication, archive, and restore workflows
- [x] 5.4 Implement the reference sync/JSON import wizard, progress/results views, API-key management, and audit views

## 6. Verification and release

- [x] 6.1 Add unit tests for DTOs, malformed config, import idempotency, override precedence, lifecycle filters, and key hashing
- [x] 6.2 Add integration tests for D1/R2 flows and sanitized 6-plus-15 material reference fixtures
- [x] 6.3 Run OpenSpec validation, migration generation, production build, and smoke tests; fix all failures
- [ ] 6.4 Configure deployment variables/secrets, publish the validated site, verify admin and App API behavior, and archive the OpenSpec change
