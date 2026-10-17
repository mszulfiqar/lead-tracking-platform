/**
 * Helpers for authentication integration tests.
 *
 * Accounts are created through Better Auth's supported server-side API in the
 * dedicated test database (validated by `TEST_DATABASE_URL` and migrated by
 * the Vitest global setup). Emails are unique per run and removed afterwards;
 * no real credentials are ever used.
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { user } from "../../src/db/auth-schema";
import { auth } from "../../src/lib/auth";

export function uniqueTestEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

/** Origin Better Auth trusts in the test environment (matches BETTER_AUTH_URL). */
export function testAuthOrigin(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
}

export interface CreatedTestAccount {
  id: string;
  email: string;
  name: string;
  password: string;
  role: string | null | undefined;
}

export async function createTestAccount(options: {
  email?: string;
  password: string;
  name?: string;
}): Promise<CreatedTestAccount> {
  const email = options.email ?? uniqueTestEmail("it");
  const name = options.name ?? "Integration Test User";

  const created = await auth.api.createUser({
    body: { email, name, password: options.password },
  });

  return {
    id: created.user.id,
    email,
    name,
    password: options.password,
    role: (created.user as { role?: string | null }).role,
  };
}

export async function deleteTestAccounts(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db.delete(user).where(inArray(user.email, emails));
}

export interface AuthApiResponse {
  status: number;
  body: unknown;
  /** `Cookie` header value for the session, when the response set one. */
  cookieHeader: string | null;
}

export interface AuthApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Session cookie(s) to send, as returned by `postToAuthApi`. */
  cookie?: string | null;
  /** Extra request headers, used to test header-based attack attempts. */
  headers?: Record<string, string>;
}

/** Calls the Better Auth HTTP handler directly, as a browser would. */
export async function requestToAuthApi(
  path: string,
  options: AuthApiRequestOptions = {},
): Promise<AuthApiResponse> {
  const { method = "POST", body, cookie, headers } = options;
  const requestHeaders = new Headers({
    origin: testAuthOrigin(),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(headers ?? {}),
  });
  if (cookie) requestHeaders.set("cookie", cookie);

  const response = await auth.handler(
    new Request(`${testAuthOrigin()}/api/auth${path}`, {
      method,
      headers: requestHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );

  const setCookies = response.headers.getSetCookie();
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    cookieHeader:
      setCookies.length > 0
        ? setCookies.map((value) => value.split(";")[0]).join("; ")
        : null,
  };
}

export function postToAuthApi(
  path: string,
  body: unknown,
  cookie?: string | null,
): Promise<AuthApiResponse> {
  return requestToAuthApi(path, { method: "POST", body, cookie });
}

export function getFromAuthApi(
  path: string,
  cookie?: string | null,
  headers?: Record<string, string>,
): Promise<AuthApiResponse> {
  return requestToAuthApi(path, { method: "GET", cookie, headers });
}

export async function getSessionForCookie(cookieHeader: string) {
  return auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
}

export async function findUserByEmail(email: string) {
  const rows = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(inArray(user.email, [email.toLowerCase()]))
    .limit(1);
  return rows[0] ?? null;
}

/** Extracts a human-readable error description for assertions. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message} ${JSON.stringify((error as { body?: unknown }).body ?? null)}`;
  }
  return String(error);
}
