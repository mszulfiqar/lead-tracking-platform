"use client";

/**
 * Browser-side Better Auth client used by the shared sign-in page.
 *
 * It talks only to this application's own `/api/auth/*` routes. Session
 * cookies are managed by Better Auth; no privilege information is stored
 * client-side.
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
