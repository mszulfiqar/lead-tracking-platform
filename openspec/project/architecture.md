# Architecture Specification

## 1. Architectural Purpose

Define the technical principles and system boundaries for the Speed-to-Lead platform.

The architecture must support a secure multi-tenant SaaS, operator-managed onboarding, reliable business workflows, and incremental development through approved OpenSpec changes.

This document defines global constraints. Change-specific specifications and approved tasks determine which capabilities may be implemented.

## 2. Approved Technology Decisions

- Application framework: Next.js.
- Programming language: TypeScript.
- Authentication: Better Auth.
- Primary database: PostgreSQL.
- Project specification and change management: OpenSpec.
- Implementation agent: OpenCode, following approved specifications and tasks.

Use the existing project conventions wherever possible.

Do not introduce an ORM, database toolkit, queue, workflow engine, or other major dependency without establishing that it is compatible with the existing project and justified by an approved requirement.

## 3. System Boundaries

The application is responsible for:

- Authentication and session verification.
- Authorization and tenant isolation.
- Platform operator functions.
- Client workspace access.
- Core business records and application logic.
- Validating requests and reporting operation outcomes.

External services may later provide messaging, AI inference, workflow execution, and other integrations. Their introduction must be defined by an approved change.

PostgreSQL is the authoritative source for core business records. External workflow tools must not silently become the authoritative store for those records.

## 4. Authentication and Authorization

### Authentication

- Use Better Auth for authentication and session management.
- Provide one shared sign-in entry point for platform operators and client users.
- Do not provide public self-registration unless an approved future change explicitly introduces it.
- Verify sessions on the server before executing protected operations.
- Handle invalid, expired, or missing sessions securely.

### Platform Operator Authorization

- Determine operator privileges through a server-side allowlist of operator user IDs configured using `PLATFORM_OPERATOR_USER_IDS`.
- Never grant operator privileges based only on an email address, client-side state, URL, request body, or organization role.
- Operator access must not depend on membership in a client organization.
- Fail securely if required operator authorization configuration is missing or invalid.
- Protect every operator page, route handler, server action, and other privileged operation with server-side authorization.

### Client Authorization

- Require verified organization membership and appropriate permissions for client workspace operations.
- Do not trust client-supplied organization IDs or role claims without server-side verification.
- Do not allow client users to grant themselves privileges.
- Keep operator authorization independent from client organization roles.

Authentication establishes identity; authorization determines what that identity may do.

## 5. Multi-Tenant Data Isolation

- Treat each customer organization as a separate security boundary.
- Derive authorized organization access from verified server-side identity and membership.
- Validate organization access on every organization-scoped read and mutation.
- Reject unauthorized organization IDs supplied through URLs, request bodies, or query parameters.
- Prevent cross-tenant reads, updates, deletions, and indirect data disclosure.
- Do not rely solely on hiding navigation items or protecting client-side pages.
- Include negative tests for unauthorized access and cross-tenant operations.

Every new organization-scoped capability must define and enforce its tenant authorization requirements.

## 6. Organization Onboarding

- Organization creation is restricted to authorized platform operators.
- Client owners are onboarded when a platform operator creates the client owner's account, associates it with the intended organization, and hands the initial credentials to the client directly.
- Initial passwords must be set through supported server-side authentication APIs, hashed using Better Auth's supported password-storage mechanism, and never stored or logged in plaintext.
- Provisioning a client account must never grant platform-operator privileges.
- Report failures accurately and never claim that an organization or client account was created successfully without confirmation.
- Client users must not gain access to an organization merely by knowing its identifier.

## 7. Application Structure and Interfaces

- Follow the existing Next.js application structure and conventions.
- Keep authentication, authorization, business logic, data access, and presentation responsibilities clearly separated.
- Prefer reusable server-side authorization utilities where they reduce duplication without weakening security.
- Validate untrusted input at application boundaries.
- Keep secrets and privileged operations on the server.
- Return appropriate errors without exposing secrets or protected information.
- Avoid unnecessary abstractions, dependencies, and unrelated refactoring.

The exact route structure and data-access implementation must follow approved change specifications and the existing codebase.

## Database and ORM

- PostgreSQL is the application's primary relational database.
- Drizzle ORM is the approved ORM for application database access, schema definitions, and application database migrations.
- Better Auth must use its supported Drizzle adapter for PostgreSQL, provided compatibility is verified against the exact installed version.
- Authentication tables and plugin tables must be represented in the approved database schema and migrated using the documented Drizzle workflow.
- Database schema changes must be deliberate, reviewable, and version-controlled.
- Organization-scoped queries and mutations must enforce tenant isolation on the server.
- Do not introduce a second ORM or database access abstraction without explicit approval.

## 8. Database and Migrations

- Use PostgreSQL for persistent application data.
- Make schema changes through deliberate, reviewable migrations.
- Keep authentication and organization data consistent with the selected Better Auth configuration and its supported database requirements.
- Preserve referential integrity where applicable.
- Do not use in-memory state as the authoritative store for persistent business data.
- Never run destructive database operations against real data without explicit authorization and a verified recovery plan.

## 9. External Integrations and Background Work

Future approved changes may introduce messaging providers, AI services, event processing, retries, and workflow automation.

When introduced:

- Keep provider credentials on the server.
- Handle timeouts, failures, retries, and duplicate events deliberately.
- Make operation states observable.
- Distinguish requested, pending, successful, and failed operations accurately.
- Do not treat an accepted request as proof that its downstream action succeeded.
- Preserve human control over automated conversations when the product supports human takeover.
- Keep integration failures from silently corrupting authoritative application records.

Do not implement these future integrations as part of the tenant foundation unless explicitly included in its approved scope.

## 10. Security and Privacy

- Apply least privilege.
- Fail closed when authorization cannot be established.
- Never bypass authorization to make a test pass.
- Never hardcode passwords, private keys, or service credentials.
- Do not log passwords, session tokens, or sensitive authentication data.
- Avoid leaking protected records through error messages.
- Test both permitted and denied access paths.
- Keep test data and test accounts separate from real customer data.
- Do not expose permanent credentials or impersonate a client by bypassing authentication.

## 11. Testing and Verification

For relevant changes, use the existing project test infrastructure and add appropriate tests.

Verification should cover:

- Successful behavior.
- Invalid input and failure paths.
- Authentication and authorization boundaries.
- Cross-tenant access attempts.
- Database and migration correctness.
- Important end-to-end user journeys.
- Linting, type checking, and production builds where applicable.

Browser acceptance tests must use an isolated test environment and appropriate test accounts.

Report only checks that were actually executed. Clearly identify failures, skipped tests, and limitations.

## 12. OpenSpec and OpenCode Workflow

- Product and architecture documents define global guidance.
- Approved OpenSpec specifications define required behavior.
- Approved task lists define implementation scope.
- OpenCode implements approved tasks; it does not independently redesign the product or author replacement specifications.
- Do not change approved requirements to make an implementation appear compliant.
- If a requirement is ambiguous, contradictory, or incomplete, stop the affected work and report the issue.
- Make small, reviewable implementation batches.
- Verify changes before marking tasks complete.
- Stop at the end of each approved batch and wait for review before proceeding.

## 13. Architecture Evolution

Architecture may evolve through explicit, reviewed decisions.

A proposed change to an established technology, security boundary, data ownership rule, or system responsibility must be evaluated and approved before implementation.

Do not introduce future roadmap features, speculative infrastructure, or major dependencies merely because they may be useful later.