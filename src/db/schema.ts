/**
 * Application database schema (Drizzle ORM) — the entry point used by
 * `drizzle.config.ts`, the Drizzle client, and the Better Auth Drizzle
 * adapter.
 *
 * Better Auth tables are generated into `auth-schema.ts` by the Better Auth
 * CLI (`npm run auth:generate-schema`) and re-exported here. Application
 * tables are added from their own modules as approved specifications
 * introduce them. Never edit `auth-schema.ts` by hand.
 */
export * from "./auth-schema";
