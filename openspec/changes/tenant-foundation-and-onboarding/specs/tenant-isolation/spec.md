# Tenant Isolation

## ADDED Requirements

### Requirement: Organization access is verified on the server

The system SHALL verify a user's authorization for the relevant organization on the server before allowing organization-scoped operations.

#### Scenario: Member accesses an authorized organization

- **WHEN** an authenticated user requests an organization-scoped resource for an organization they are authorized to access
- **THEN** the system SHALL allow the operation according to the user's permissions

#### Scenario: User accesses an unauthorized organization

- **WHEN** an authenticated user requests an organization-scoped resource for an organization they are not authorized to access
- **THEN** the system SHALL deny the operation
- **AND** SHALL NOT disclose the organization's protected data

### Requirement: Client-supplied organization identifiers are not proof of authorization

The system SHALL NOT trust a client-supplied organization ID as evidence that a user may access that organization.

#### Scenario: User substitutes another organization's ID

- **WHEN** a user changes an organization ID in a URL, request body, query parameter, or other client-controlled input
- **THEN** the system SHALL independently verify authorization for the requested organization
- **AND** SHALL reject access when authorization is absent

### Requirement: Organization-scoped reads and writes are tenant-isolated

The system SHALL scope organization-owned data access to the authorized organization.

#### Scenario: Authorized member reads organization data

- **WHEN** a member reads organization-owned data
- **THEN** the system SHALL return only data belonging to an organization the member is authorized to access

#### Scenario: User attempts a cross-tenant mutation

- **WHEN** a user attempts to create, modify, or delete organization-owned data outside an organization they are authorized to access
- **THEN** the system SHALL reject the operation
- **AND** SHALL leave the unauthorized organization's data unchanged

### Requirement: Authorization failures are handled safely

The system SHALL reject unauthorized organization-scoped operations without exposing protected information.

#### Scenario: Unauthenticated user requests organization data

- **WHEN** a user without a valid authenticated session requests organization-scoped data
- **THEN** the system SHALL reject the request
- **AND** SHALL NOT disclose organization data

#### Scenario: Cross-tenant access is attempted during testing

- **WHEN** an automated security test attempts to access another organization's protected data
- **THEN** the test SHALL verify that access is denied and protected data remains inaccessible