/**
 * Next.js Proxy (formerly middleware; Next.js 16 uses the `proxy` convention).
 *
 * This is an optimistic convenience redirect only: it checks for the presence
 * of the Better Auth session cookie and sends visitors without one to the
 * shared sign-in page. It does NOT validate the session and does NOT perform
 * authorization — a forged cookie is only caught later, server-side.
 *
 * Every protected page (and later, route handler and server action) verifies
 * the session and authorization on the server before returning data or
 * performing mutations. Nothing here grants or denies privileges.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PATHS = [
  "/operator",
  "/workspace",
  "/post-auth",
  "/no-access",
] as const;

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  if (getSessionCookie(request)) {
    return NextResponse.next();
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/operator/:path*",
    "/workspace/:path*",
    "/post-auth",
    "/no-access",
  ],
};
