# Change: Tenant Foundation and Onboarding

## Why

The Speed-to-Lead platform needs a secure foundation before lead tracking and automation features can be built. It must distinguish platform operators from client users, support operator-managed organization onboarding, and prevent customers from accessing another organization's data.

## What Changes

- Establish Better Auth as the authentication system with PostgreSQL persistence.
- Provide one shared sign-in page for operators and client users.
- Do not provide public sign-up or self-service organization creation.
- Define secure, server-side platform operator authorization using a configured allowlist of operator user IDs.
- Allow authorized operators to create client organizations and provision the client owner's account.
- Allow the provisioned client owner to sign in with operator-provided credentials and access their authorized client workspace.
- Enforce server-side authorization and tenant isolation for organization-scoped operations.
- Define secure post-sign-in routing for operators, organization members, and users without authorized organization access.
- Define automated security tests and browser acceptance tests for the critical onboarding journey.

## Capabilities

### Added Capabilities

- `authentication`: Shared sign-in and secure authentication behavior.
- `operator-access`: Server-verified platform operator authorization.
- `organization-onboarding`: Operator-managed organization creation and client owner account provisioning with operator-set initial passwords.
- `tenant-isolation`: Server-side organization authorization and cross-tenant data protection.

### Modified Capabilities

- None.

## Impact

- Next.js application routes and authentication UI.
- Better Auth configuration and authentication-related database tables.
- PostgreSQL schema and migrations.
- Server-side authorization and organization access logic.
- Automated tests and browser acceptance tests.
- Environment configuration for operator authorization and authentication secrets.

Implementation details must follow the approved specifications. Any unresolved security or architecture decisions must be clarified before the affected implementation tasks begin.