## ADDED Requirements

### Requirement: Product API-key authorization
Every App material endpoint SHALL require a valid, non-revoked `X-API-Key` scoped to the requested product.

#### Scenario: Use a key for another product
- **WHEN** a request supplies a valid key whose product does not match `pid`
- **THEN** the system SHALL return an authorization error without catalog data

### Requirement: Compatible category tree endpoint
The system SHALL provide `GET /api/v1/product-material-category/ids/tree-list` with `page`, `page_size`, `pid`, `channel`, and `source` parameters and a reference-compatible two-level `data.list` response.

#### Scenario: Read the initial product tree
- **WHEN** an authorized App requests `pid=8801`, `channel=English`, and `source=English`
- **THEN** the response SHALL contain active root categories with active secondary categories, translations, configuration, marks, timestamps, and no archived nodes

### Requirement: Compatible multi-category endpoint
The system SHALL provide `GET /api/v1/product-material/category-group/list` with a comma-separated `product_material_category_ids` parameter and SHALL return one `data.group` entry per valid requested secondary category in request order.

#### Scenario: Request two secondary categories
- **WHEN** an authorized App requests two secondary category IDs with one page and page size
- **THEN** each group SHALL contain its own pager, category ID, and reference-compatible relationship material list

### Requirement: Single-category endpoint
The system SHALL provide `GET /api/v1/product-material/category-group/{category_id}` with the common product and pagination parameters and a direct single-group response.

#### Scenario: Request one secondary category
- **WHEN** an authorized App requests an active secondary category
- **THEN** the response SHALL contain that category ID, its pager, and only its published material relationships

### Requirement: Compatibility serialization and filtering
Successful endpoints SHALL return `{code: 1, data, msg: "OK"}`, SHALL serialize known public and independent property wrappers, and SHALL exclude draft, disabled, unlisted, or archived entities.

#### Scenario: Same material belongs to two categories
- **WHEN** one material is returned through two category relationships
- **THEN** both records SHALL share `material_id` and SHALL expose their distinct relationship `id` values

#### Scenario: Paginate beyond the available records
- **WHEN** the requested page contains no published relationships
- **THEN** the group SHALL retain accurate pager totals and return an empty list

