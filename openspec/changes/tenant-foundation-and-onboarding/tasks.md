# Tasks

## 1. Inspect and Prepare

- [x] 1.1 Inspect the existing Next.js project structure, dependencies, scripts, and environment configuration without changing unrelated files.
- [x] 1.2 Verify the current stable Better Auth version and consult its official documentation for authentication, sessions, organization management, server-side user creation, password management, and the Drizzle adapter.
- [x] 1.3 Confirm PostgreSQL availability, select the approved Drizzle database configuration, and identify missing dependencies or environment variables before implementation.
- [x] 1.4 Report conflicts, ambiguities, unsupported APIs, and missing decisions against the approved specifications. Stop affected work until those issues are resolved; do not modify specifications independently.
- [x] 1.5 Configure Vitest for unit and integration tests, including suitable test scripts, environment configuration, and test setup.
- [x] 1.6 Configure Playwright for real-browser acceptance tests, including a dedicated configuration, isolated browser context, and suitable test scripts.
- [x] 1.7 Verify that the testing setup can run without using real client accounts, production credentials, or production data.

## 2. Authentication Foundation

- [x] 2.1 Configure Better Auth with PostgreSQL using its documented Drizzle adapter and the approved project conventions.
- [x] 2.2 Implement one shared sign-in page for platform operators and client users.
- [x] 2.3 Disable public self-registration and self-service organization creation.
- [x] 2.4 Implement server-side session verification for protected operations.
- [x] 2.5 Implement safe post-authentication routing without permitting external redirects or trusting client-supplied privilege claims.
- [x] 2.6 Add Vitest unit and integration tests for successful authentication, invalid credentials, missing sessions, and rejected public registration.

## 3. Platform Operator Authorization

- [x] 3.1 Implement server-side operator authorization using the configured `PLATFORM_OPERATOR_USER_IDS` allowlist.
- [x] 3.2 Validate the operator allowlist configuration and fail securely when it is missing or invalid.
- [x] 3.3 Protect every operator route and operation with server-side authorization.
- [x] 3.4 Ensure operator access does not depend on organization membership.
- [x] 3.5 Add Vitest tests for allowlisted operators, non-operators, missing configuration, and client-side privilege manipulation.
- [x] 3.6 Add Playwright acceptance tests verifying that an authorized operator can access the operator experience and an unauthorized user is denied access.

## 4. Operator-Managed Organization and Client Account Provisioning

- [x] 4.1 Implement operator-authorized organization creation.
- [x] 4.2 Verify the supported Better Auth server-side APIs for creating client user accounts and setting initial passwords while public registration remains disabled.
- [x] 4.3 Implement operator-authorized client account creation, associate each account with the intended organization, and assign the approved client role.
- [x] 4.4 Implement secure initial-password handling using Better Auth's supported password-storage mechanism. Never store or log passwords in plaintext, and never hardcode credentials in source code. (4G: the 8-128 policy is also enforced on the Better Auth `admin/create-user` route by `src/lib/initial-password-guard.ts`, closing the plugin's minimum-length gap; verified by `tests/integration/account-creation-policy.test.ts` and `tests/unit/initial-password-guard.test.ts`)
- [x] 4.5 Ensure client account creation cannot grant platform-operator privileges and unauthorized users cannot provision accounts or organizations.
- [x] 4.6 Handle organization and account-creation failures accurately. Avoid partial or inconsistent onboarding states and never report success without verification.
- [x] 4.7 Add Vitest tests for successful organization and client account creation, initial-password sign-in, unauthorized provisioning, duplicate accounts, invalid input, and failure handling. (4G: `tests/integration/account-creation-policy.test.ts` covers 401/403 ordering, short/empty/over-length rejection, the 8-character boundary, default `user` role, and initial-password sign-in)
- [x] 4.8 Add Playwright acceptance tests for the operator creating an organization and client account, setting the initial password, and verifying that the client can sign in and access the correct workspace.

## 5. Tenant Isolation

- [x] 5.1 Implement reusable server-side organization authorization checks.
- [x] 5.2 Enforce authorization for every organization-scoped read and mutation introduced by this change.
- [x] 5.3 Reject unauthorized organization IDs supplied through URLs, request bodies, and query parameters. (4G: explicit organization targets on the five lookup/activation endpoints now return one uniform 403 to non-members whether the organization exists or not; see `src/lib/organization-lookup-guard.ts` and section 7 of `tests/integration/organization-api-security.test.ts`)
- [x] 5.4 Add Vitest negative tests for cross-tenant reads, updates, and deletions. (tests/integration/organization-api-security.test.ts: cross-tenant and non-member reads/updates/deletions denied against real organization endpoints, verified 2026-10-17)
- [x] 5.5 Verify unauthorized operations do not disclose protected data or modify another organization's records. (4G: existing vs nonexistent slug and ID produce identical status, body, and absence of `Set-Cookie` on all five guarded endpoints; probes leave the target organization and memberships unchanged; timing side channels are not claimed as mitigated)
- [x] 5.6 Add Playwright tests verifying that a client cannot access another organization's workspace or protected operator routes.

## 6. Browser Acceptance and Final Verification

- [x] 6.1 Test the shared sign-in flow in a real browser using Playwright.
- [x] 6.2 Test an allowlisted operator signing in without organization membership and reaching the operator experience.
- [x] 6.3 Test an operator creating an organization and client account, setting the initial password, and verifying successful client sign-in and correct workspace access.
- [x] 6.4 Test that public registration remains disabled, clients cannot access operator routes, and clients cannot access another organization's data.
- [x] 6.5 Run the Vitest unit and integration test suites. (4G: `npm test` -> 20 files, 227 tests passed)
- [x] 6.6 Run the Playwright browser acceptance suite and retain evidence of actual test results. (4G: `npm run test:e2e` -> 18 tests passed)
- [x] 6.7 Run lint, TypeScript checks, and the production build. (4G: `npm run typecheck`, `npm run lint`, and `npm run build` all completed successfully)
- [x] 6.8 Review the implementation against every approved requirement and report actual results, failures, unperformed tests, and task-status changes supported by evidence.

## Testing and Verification Rules

- Use Vitest for appropriate unit and integration tests and Playwright for real-browser acceptance tests.
- Use dedicated test accounts, isolated test data, and a test database. Never use real client credentials or production data for automated tests.
- Do not bypass authentication, authorization, tenant isolation, or password validation to make tests pass.
- Do not mark a task complete unless the required implementation and verification evidence exist.
- Report commands executed, actual outcomes, failures, skipped tests, and unresolved limitations.
- If a documented API does not support an approved requirement, stop the affected task and report the issue before choosing an alternative.
- Stop after completing the approved implementation batch and wait for review before beginning the next batch.

## Batch 4G Remediation Evidence

- V-1 (organization existence disclosure): `better-auth@1.7.10` answered an
  explicit organization target with 403 (membership error) when the
  organization existed and 400 `ORGANIZATION_NOT_FOUND` when it did not, on
  `/organization/{get-organization,get-full-organization,set-active,list-members,get-active-member-role}`.
  `src/lib/organization-lookup-guard.ts` (wired through `hooks.before` in
  `src/lib/auth.ts`) answers both cases with one identical endpoint-specific
  403 for non-members; members and server-side `auth.api.*` provisioning calls
  are unaffected. Verified by section 7 of
  `tests/integration/organization-api-security.test.ts` (status, body, and
  absence of `Set-Cookie` compared for existing vs nonexistent slug and ID)
  and by `tests/unit/organization-lookup-guard.test.ts`. Timing side channels
  are not mitigated.
- H-1 (password policy): all application account-creation call sites validate
  the shared 8-128 policy before calling Better Auth. `src/lib/initial-password-guard.ts`
  additionally enforces it on `/admin/create-user`, where Better Auth itself
  only checks the maximum. Verified by
  `tests/integration/account-creation-policy.test.ts`,
  `tests/unit/initial-password-guard.test.ts`, and the existing provisioning
  and bootstrap suites.
- H-2 (test database safety): no behavior change required. The
  `ALLOW_REMOTE_TEST_DATABASE=true` hatch still requires a `_test` database
  name and a database distinct from `DATABASE_URL`, and only the exact value
  `"true"` enables it. Regression coverage added to
  `tests/unit/test-environment.test.ts`.
- Verification: `npm test` (20 files / 227 tests), `npm run test:e2e`
  (18 tests), `npm run typecheck`, `npm run lint`, `npm run build`,
  `npx openspec validate tenant-foundation-and-onboarding --strict`, and
  `npx openspec validate --all --strict` all passed.