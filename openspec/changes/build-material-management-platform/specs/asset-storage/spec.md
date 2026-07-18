## ADDED Requirements

### Requirement: Owned object storage
The system SHALL store uploaded and imported media bytes in R2 and SHALL store searchable metadata and ownership references in D1.

#### Scenario: Import a remote image
- **WHEN** an import item references a reachable remote image
- **THEN** the system SHALL stream it into R2, record content type, size, hash and source URL, and serve the owned object in App responses

### Requirement: Asset deduplication
The system SHALL reuse an existing product-owned object when the incoming content hash matches and SHALL avoid recopies when unchanged source metadata maps to an existing asset.

#### Scenario: Two relationships reference the same source file
- **WHEN** both records resolve to the same file hash
- **THEN** the system SHALL retain one R2 object and allow both records to reference its metadata

### Requirement: Media role validation
The system SHALL distinguish original, thumbnail, preview, and audio roles and SHALL enforce role requirements before publication.

#### Scenario: Publish an image with original only
- **WHEN** an image material has an original asset but no separate thumbnail
- **THEN** the system SHALL allow publication by using the original asset for both roles

### Requirement: Safe asset delivery
The system SHALL return owned asset URLs, validated content types, and immutable object identifiers without exposing R2 management credentials.

#### Scenario: Read a published asset
- **WHEN** an App follows an asset URL returned by a published material
- **THEN** the system SHALL deliver the corresponding R2 object with its recorded content type

