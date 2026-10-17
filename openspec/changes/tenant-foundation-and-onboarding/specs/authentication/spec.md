# Authentication

## ADDED Requirements

### Requirement: Shared sign-in entry point

The system SHALL provide one shared sign-in page for platform operators and client users.

#### Scenario: Unauthenticated user opens a protected route

- **WHEN** a user without a valid session opens a protected application route
- **THEN** the system SHALL direct the user to the shared sign-in page

#### Scenario: Public registration is unavailable

- **WHEN** a visitor attempts to access public registration
- **THEN** the system SHALL prevent public self-registration

### Requirement: Secure authentication

The system SHALL use Better Auth for authentication and PostgreSQL for persistent authentication data.

#### Scenario: Successful sign-in

- **WHEN** a user submits valid credentials
- **THEN** the system SHALL establish an authenticated session through Better Auth

#### Scenario: Invalid sign-in

- **WHEN** a user submits invalid credentials
- **THEN** the system SHALL reject authentication

### Requirement: Authentication does not grant authorization

The system SHALL verify authorization separately from authentication.

#### Scenario: Authenticated user has no authorized access

- **WHEN** a user has a valid session but no authorized operator privileges or verified membership in an accessible organization
- **THEN** the system SHALL deny protected application access

### Requirement: Protected operations verify the session

The system SHALL verify the current authenticated session on the server before performing protected operations.

#### Scenario: Session is missing or invalid

- **WHEN** a user requests a protected operation without a valid session
- **THEN** the system SHALL reject the operation and SHALL NOT disclose protected data