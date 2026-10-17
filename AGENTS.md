# Project Engineering Rules

## 1. Project Purpose

Build a production-quality, multi-tenant Speed-to-Lead SaaS for US HVAC companies.

The application must securely isolate customer organizations and support operator-managed onboarding.

## 1.1 Global Product and Architecture References

Before implementing any task, read:

- `openspec/project/product.md` for product goals, target customers, MVP scope, and roadmap boundaries.
- `openspec/project/architecture.md` for approved technology decisions, system boundaries, security requirements, tenant isolation, and testing principles.
- `openspec/config.yaml` for OpenSpec project context and artifact rules.
- The active OpenSpec change's `proposal.md`, `design.md`, capability specifications, and `tasks.md`.

The active change's approved requirements and tasks determine implementation scope. Global documents provide project-wide guidance and must not be used to introduce features outside the approved change.

If these documents conflict, or an important decision is missing, stop the affected work and report the conflict before implementation. Do not silently choose an architecture or rewrite specifications.

## 2. Authority and Scope

- OpenSpec specifications and approved tasks define implementation scope.
- Implement only the approved requirements and tasks.
- Do not independently redesign the architecture, introduce features, or expand scope.
- If requirements are ambiguous, contradictory, or incomplete, stop and report the issue before proceeding.
- Do not modify specifications to make an implementation appear compliant.
- Do not mark tasks complete without verification evidence.

## 3. Technology Decisions

- Framework: Next.js.
- Authentication: Better Auth.
- Database: PostgreSQL.
- Use TypeScript and follow the existing project conventions.
- Select additional libraries only when justified by approved requirements.

## 4. Security Requirements

- Authentication does not automatically grant authorization.
- Enforce authorization on the server for every protected operation.
- Platform-operator privileges must be checked independently of organization membership.
- Never trust client-supplied roles, organization IDs, or authorization claims without server-side verification.
- Every organization-scoped operation must enforce tenant isolation.
- Never allow one organization to access another organization's data.
- Do not expose passwords, tokens, API keys, or other secrets.
- Do not hardcode passwords, credentials, or private keys in source code.
- Do not bypass authorization checks to make tests pass.


## 7. Documentation Lookup

- Use the Context7 MCP server to consult current library documentation when implementing or changing integrations.
- Prefer official documentation for Better Auth, Next.js, PostgreSQL-related libraries, and other dependencies approved for this project.
- Verify SDK methods, APIs, configuration, and recommended usage against documentation instead of guessing.
- Retrieve documentation relevant to the current task; avoid repeated lookups for unchanged questions.
- Follow the approved OpenSpec proposal, specifications, design, and tasks. Documentation lookup must not silently expand the feature scope.
- If documentation conflicts with the approved design or reveals a significant architectural issue, explain the conflict before making a major change.

## 5. Implementation Rules

- Make small, focused, reviewable changes.
- Follow existing project conventions unless an approved specification requires a change.
- Avoid unnecessary dependencies, abstractions, and unrelated refactoring.
- Preserve existing behavior outside the approved scope.
- Handle failures explicitly; never report an operation as successful without evidence.
- Keep database migrations deliberate, reviewable, and consistent with the approved schema.

## 6. Testing and Verification

- Run the relevant tests and checks required by the approved tasks.
- Include negative tests for authorization failures and cross-tenant access.
- Test important user journeys, including organization onboarding and invitation acceptance.
- Use browser acceptance tests when required by the specification.
- Report commands executed, results, failures, and tests not performed.
- Never claim that a test passed unless it actually ran and passed.

## 7. Completion Reports

At the end of each implementation batch, report:

1. Tasks completed.
2. Files created or modified.
3. Tests and verification commands executed.
4. Actual results and any failures.
5. Known limitations or unresolved issues.
6. The exact task status changes supported by the evidence.

Stop after completing the approved batch. Wait for review and authorization before starting the next batch.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
