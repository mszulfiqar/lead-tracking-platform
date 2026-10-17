# Speed to Lead

Multi-tenant Speed-to-Lead platform for US HVAC companies. Organizations and
their client accounts are provisioned by the platform team; there is no
public self-registration.

## Local setup

Requirements: Node.js 24+, npm, and a local PostgreSQL server.

1. Copy `.env.example` to `.env.local` and fill in the values
   (`.env.local` is git-ignored and must never be committed).
2. Create the databases and apply migrations:

   ```bash
   npm run db:create-test   # creates the local test database (once)
   npm run db:migrate       # applies migrations to the local dev database
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Database

- `npm run db:generate` — generate a migration from changes to the Drizzle
  schema (`src/db/schema.ts`, re-exporting `src/db/auth-schema.ts`).
- `npm run db:migrate` — apply committed migrations to the **local** dev
  database. The script refuses remote hosts, non-local databases, and any
  database whose name is not the configured development database; there is no
  fallback to test or production targets.
- `npm run auth:generate-schema` — regenerate `src/db/auth-schema.ts` from the
  Better Auth configuration after auth plugin changes.

Automated tests never touch the development database: they use the dedicated
`TEST_DATABASE_URL` and reject any database whose name does not end in `_test`.

## Authentication

- `/sign-in` is the single shared sign-in page for platform operators and
  client users.
- Public self-registration is disabled server-side
  (`emailAndPassword.disableSignUp`); the public sign-up endpoint rejects
  requests. Accounts are created only through server-side provisioning by
  authorized operators or the bootstrap script below.
- Passwords must be 8–128 characters. They are hashed by Better Auth and are
  never stored, logged, or written to files in plaintext.
- `/post-auth` resolves the destination for an authenticated user on the
  server from the verified session and the operator allowlist. Client-supplied
  values cannot cause external redirects.

## Platform operators

Platform-operator privileges are granted **only** when a request carries a
valid, server-verified session whose user ID appears in the server-side
`PLATFORM_OPERATOR_USER_IDS` allowlist. Roles (including Better Auth's built-in
`admin` role), organization membership, URLs, headers, and request bodies never
grant operator access. When the allowlist is missing or invalid, operator
access is denied for everyone (fail closed).

Operator routes (`/operator`) verify both the session and the allowlist on the
server for every request. Authenticated users who are not allowlisted are sent
to `/no-access`.

### One-time operator bootstrap (local development)

The first platform-operator account is created with:

```bash
npm run operator:bootstrap
```

This script:

- refuses to run against remote hosts (for example Neon production),
  `NODE_ENV=production`, test databases, or any database other than the
  validated local development database;
- verifies the live database identity (`current_database()`) before writing;
- prompts interactively for the operator email, name, and password (the
  password is not echoed, is validated against the 8–128 character policy, and
  is never logged or stored in files);
- creates the account through Better Auth's supported server-side API with the
  default `user` role — it never assigns the `admin` role and exposes no HTTP
  endpoint;
- is safe to re-run: if the email already exists, nothing is changed and the
  existing user ID is printed.

After it completes:

1. Add the printed user ID to `PLATFORM_OPERATOR_USER_IDS` in `.env.local`
   (comma-separated for multiple operators).
2. Restart the application so the allowlist is reloaded.
3. Sign in at `/sign-in`; the operator lands on the operator console at
   `/operator`.

## Testing

- `npm test` — Vitest unit and integration suites. Integration tests create
  and delete their own accounts in the dedicated test database.
- `npm run test:e2e` — Playwright browser acceptance tests. The command first
  migrates and seeds the test database with run-scoped accounts (credentials
  are written only to the git-ignored `.e2e-state/` directory), then starts a
  Next.js server on port 3100 with the test database configuration.
- `npm run lint`, `npm run typecheck`, `npm run build` — static checks and the
  production build.
