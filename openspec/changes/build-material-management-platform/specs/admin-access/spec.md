## ADDED Requirements

### Requirement: Authenticated and allowlisted administration
The system SHALL require dispatch-owned Sign in with ChatGPT for `/admin` and administrative actions and SHALL authorize only email addresses in the server-side administrator allowlist.

#### Scenario: Signed-in non-administrator visits admin
- **WHEN** an authenticated user's email is not in `ADMIN_EMAILS`
- **THEN** the system SHALL deny access without revealing catalog administration data

### Requirement: Product-scoped API-key lifecycle
An authorized administrator SHALL be able to create, name, view the prefix of, revoke, and audit product-scoped App API keys.

#### Scenario: Create an API key
- **WHEN** an administrator creates a key for a product
- **THEN** the system SHALL reveal the raw key once, store only its prefix and cryptographic hash, and record the actor and time

#### Scenario: Revoke an API key
- **WHEN** an administrator revokes a key
- **THEN** subsequent App requests using that key SHALL be rejected

### Requirement: Secret isolation
The system SHALL read reference API credentials and administrator configuration from hosted runtime secrets or variables and SHALL not persist or log secret values.

#### Scenario: Inspect an import job
- **WHEN** an administrator views import details or audit history
- **THEN** usernames, passwords, authorization headers, and raw API keys SHALL be absent from every response

