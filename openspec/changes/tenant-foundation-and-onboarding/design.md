# Design: Tenant Foundation and Onboarding

## Context

The application is a new Next.js project for a multi-tenant Speed-to-Lead SaaS serving HVAC businesses.

The initial milestone establishes authentication, operator access, organization onboarding, and tenant isolation. Lead management, messaging, AI conversations, and workflow automation are outside this change's scope.

## Goals

- Authenticate platform operators and client users through one shared sign-in page.
- Keep platform operator authorization independent of organization membership.
- Allow only authorized operators to create client organizations and client accounts.
- Allow operators to set initial client passwords and hand credentials directly to clients.
- Ensure client access depends on verified organization membership.
- Enforce tenant isolation on the server.
- Verify the critical onboarding journey with automated tests.

## Confirmed Decisions

### Authentication

- Use Better Auth.
- Use PostgreSQL for persistent application and authentication data.
- Use Drizzle ORM for application database access, schema definitions, and migrations.
- Use Better Auth's supported Drizzle adapter for PostgreSQL after verifying compatibility with the exact installed version.
- Provide one shared sign-in page.
- Do not expose public registration or self-service organization creation.
- Authentication establishes identity; it does not automatically grant operator or organization permissions.

### Platform Operator Access

- Configure authorized operator user IDs through a server-side environment variable named `PLATFORM_OPERATOR_USER_IDS`.
- Check the authenticated user's verified ID against the configured allowlist on the server.
- Do not grant operator privileges based only on email addresses, organization roles, URL paths, or client-side state.
- Operator authorization must work without organization membership.
- Never store passwords or other authentication secrets in source code.

### Organization and Client Account Onboarding

- An authorized operator creates a client organization.
- An authorized operator creates the designated client owner's account and associates it with the correct organization.
- The operator can set an initial password and hand the client's login credentials directly to the client.
- Public self-registration and self-service organization creation remain disabled.
- Only an authorized platform operator may perform client account provisioning through protected operator operations.
- The account must receive the intended organization membership and client role.
- Creating a client account must never grant platform-operator privileges.
- Passwords must be hashed using the authentication library's supported password-storage mechanism.
- Passwords must never be stored or logged in plaintext.
- The system must not expose passwords through URLs, application logs, analytics, or error messages.
- The shared sign-in page must authenticate the client and grant access only to organizations for which the client has verified membership.
- Verify the exact Better Auth user-creation APIs and their behavior with disabled public registration before implementing account provisioning.
- Do not introduce an unsupported authentication bypass or custom password-storage mechanism.

### Tenant Isolation

- Every organization-scoped server operation must verify that the authenticated user has the required access to the target organization.
- Organization-scoped database reads and writes must be restricted to the authorized tenant.
- Unauthorized and cross-tenant requests must fail securely.
- Operator privileges and client organization permissions must be checked independently.
- Never trust a client-supplied organization ID as proof of access.

### Database Architecture

- PostgreSQL is the primary relational database.
- Drizzle ORM manages application schema definitions, application database queries, and version-controlled migrations.
- Better Auth uses its documented Drizzle adapter for PostgreSQL.
- Authentication and plugin tables must be included in the approved database schema and migration workflow according to Better Auth's current documentation.
- Avoid introducing a second ORM or unnecessary database abstraction.
- Keep database migrations deliberate, reviewable, and consistent with the approved specifications.
- Enforce tenant isolation in server-side data-access operations; hiding data in the user interface is insufficient.

### Verification

- Test successful and unsuccessful authentication paths.
- Test operator access without organization membership.
- Test authorized and unauthorized client account creation.
- Test that public self-registration remains disabled.
- Test that initial client credentials work without granting operator privileges.
- Test correct organization membership and post-login routing.
- Test attempts to access another organization's data.
- Use browser acceptance tests for critical user journeys where supported by the approved tasks.
- Report commands executed, actual results, and any unverified behavior.

## Decisions Requiring Verification

Before implementing dependent tasks, verify the current Better Auth documentation and the installed version for:

- Organization capabilities and organization creation APIs.
- User-creation APIs and behavior when public registration is disabled.
- Password-setting and password-hashing behavior.
- Required plugins and database schema.
- PostgreSQL and Drizzle adapter compatibility.
- Migration generation and application procedures.
- Session handling and server-side authorization APIs.
- Safe creation of organization membership and client roles.
- Testing the real account-provisioning and sign-in journey.

The email delivery provider and any additional dependencies must not be assumed without an approved requirement. Email delivery is not a prerequisite for the operator to hand credentials directly to a client, unless another approved requirement establishes it.

## Out of Scope

- Lead capture and lead management.
- SMS, calling, and email automation.
- AI agents and conversation management.
- Appointments, analytics, and workflow dashboards beyond the access needed for onboarding.
- Agency and white-label functionality.
- Client impersonation.
- Public self-registration.
- Mandatory one-time password-setup links as a replacement for the approved operator-set initial-password workflow.

## Security Constraints

- Do not bypass authorization to make a test pass.
- Do not hardcode passwords or credentials in source code.
- Do not store or log passwords in plaintext.
- Do not grant operator privileges through organization membership or client-supplied values.
- Do not mark a task complete without evidence.
- Report ambiguous requirements, undocumented API behavior, and architectural conflicts before implementing the affected task.