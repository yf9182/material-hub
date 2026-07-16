## ADDED Requirements

### Requirement: Reference API import
The system SHALL allow an authorized administrator to synchronize category-tree and material-group data from the configured Basic Auth reference service without exposing its credentials to the browser.

#### Scenario: Preview a reference synchronization
- **WHEN** an administrator selects a product and reference categories and requests a preview
- **THEN** the system SHALL report category, material, asset, duplicate, and warning counts before creating records

### Requirement: JSON import
The system SHALL accept pasted or uploaded JSON matching either the reference category-tree envelope or material-group envelope and SHALL normalize both inputs into the same import manifest.

#### Scenario: Upload a multi-category group response
- **WHEN** an administrator uploads a response containing multiple `data.group` entries
- **THEN** the system SHALL identify each secondary category, pager metadata, relationship record, material, translation map, property wrapper, and asset reference

#### Scenario: Reject an unrelated document
- **WHEN** uploaded JSON matches neither supported envelope
- **THEN** the system SHALL reject the preview with structural validation errors and SHALL create no import job

### Requirement: Smart idempotent upsert
The system SHALL upsert categories by product and external category ID, materials by source and external `material_id`, and material-category relationships by external relationship `id`.

#### Scenario: Re-import a material with a manual title override
- **WHEN** source data changes for a previously imported material whose title has a manual override
- **THEN** the system SHALL update the source snapshot, retain the effective manual title, and report the record as updated

#### Scenario: Re-import unchanged data
- **WHEN** a completed source snapshot is imported again without changes
- **THEN** the system SHALL create no duplicate catalog records or asset objects and SHALL report unchanged items as skipped

### Requirement: Tolerant configuration ingestion
The system SHALL preserve the exact source `material_config` string and SHALL attempt to produce normalized JSON without requiring parse success.

#### Scenario: Import invalid configuration JSON
- **WHEN** `material_config` contains a trailing comma, truncation, or other unrepairable syntax
- **THEN** the system SHALL retain the raw value, record a warning, and continue importing the remaining material fields

### Requirement: Resumable batched import
The system SHALL persist import jobs and per-item state, process confirmed jobs in bounded batches, and permit pending or failed items to resume.

#### Scenario: Browser closes during import
- **WHEN** the administrator closes the import page after one or more batches complete
- **THEN** completed items SHALL remain committed and reopening the job SHALL resume pending items without duplicating prior results

### Requirement: Import reporting
The system SHALL expose job-level and item-level status for new, updated, skipped, warning, and failed outcomes.

#### Scenario: Asset copy fails
- **WHEN** a required remote file cannot be copied to owned storage
- **THEN** the item SHALL record the failure, remain resumable and unpublished, and SHALL not prevent unrelated items from completing

