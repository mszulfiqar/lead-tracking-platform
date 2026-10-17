# Operator Access

## ADDED Requirements

### Requirement: Operator authorization uses a server-side allowlist

The system SHALL grant platform operator privileges only to authenticated users whose verified user IDs appear in the server-side operator allowlist.

#### Scenario: Allowlisted operator signs in

- **WHEN** an authenticated user's verified ID appears in the configured operator allowlist
- **THEN** the system SHALL authorize the user for permitted operator operations

#### Scenario: User is not allowlisted

- **WHEN** an authenticated user's verified ID does not appear in the operator allowlist
- **THEN** the system SHALL NOT grant platform operator privileges

### Requirement: Operator access is independent of organization membership

The system SHALL authorize platform operators independently of client organization membership.

#### Scenario: Operator has no organization membership

- **WHEN** an allowlisted operator has a valid session but belongs to no organization
- **THEN** the system SHALL allow access to authorized operator routes
- **AND** SHALL NOT redirect the operator to a client onboarding or membership-required page

### Requirement: Operator privileges cannot be self-assigned

The system SHALL NOT derive platform operator privileges from client-controlled data.

#### Scenario: User changes client-side role information

- **WHEN** a user modifies client-side state, request data, URL parameters, or organization role information to claim operator privileges
- **THEN** the system SHALL reject the unauthorized privilege claim

### Requirement: Operator routes enforce server-side authorization

The system SHALL verify operator authorization on the server for every protected operator operation.

#### Scenario: Non-operator requests an operator operation

- **WHEN** an authenticated user without operator privileges requests a protected operator operation
- **THEN** the system SHALL deny the operation
- **AND** SHALL NOT disclose protected operator data or perform the requested mutation