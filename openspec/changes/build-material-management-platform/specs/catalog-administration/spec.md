## ADDED Requirements

### Requirement: Multi-product catalog administration
The system SHALL allow an authorized administrator to create, edit, activate, and archive products, and SHALL isolate categories, materials, relationships, and API keys by product.

#### Scenario: Switch active product
- **WHEN** an administrator selects a different active product
- **THEN** every catalog list and mutation SHALL operate only on that product

### Requirement: Two-level category hierarchy
The system SHALL support root categories and secondary categories only, including localized names, code, configuration, stable ordering, active state, and archive state.

#### Scenario: Reject a third category level
- **WHEN** an administrator attempts to create or move a category below a secondary category
- **THEN** the system SHALL reject the mutation without changing the hierarchy

#### Scenario: Archive an in-use category
- **WHEN** an administrator archives a category that contains active children or material relationships
- **THEN** the system SHALL hide it from App reads while retaining its descendants, relationships, and restoration history

### Requirement: Simplified material editing
The system SHALL require only product, at least one secondary category, internal name, English display name, and original media for a new material, and SHALL generate compatibility IDs, timestamps, wrappers, and defaults.

#### Scenario: Create an image material with minimum fields
- **WHEN** an administrator submits the required fields and an image
- **THEN** the system SHALL create a draft material, reuse the original as its thumbnail by default, and create one relationship per selected secondary category

#### Scenario: Publish a video without a thumbnail
- **WHEN** an administrator attempts to publish a video that has no thumbnail
- **THEN** the system SHALL reject publication and identify the missing thumbnail

### Requirement: Localization and advanced properties
The system SHALL preserve imported language maps and SHALL allow administrators to edit English, Simplified Chinese, other translations, version limits, descriptions, recommendation/pricing fields, preview media, and advanced configuration.

#### Scenario: Edit one translation
- **WHEN** an administrator changes only the Simplified Chinese material title
- **THEN** the system SHALL retain every other imported translation unchanged and mark only that field as manually overridden

### Requirement: Lifecycle and audit history
The system SHALL support draft, published, disabled, archived, and restored material states and SHALL audit administrative mutations with actor, timestamp, target, and changed fields.

#### Scenario: Disable a published material
- **WHEN** an administrator disables a published material
- **THEN** the material SHALL disappear from subsequent App API responses and the action SHALL be recorded in the audit history

