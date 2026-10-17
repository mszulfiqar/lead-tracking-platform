/**
 * Better Auth API route handler (Next.js App Router catch-all route).
 *
 * Public sign-up is disabled in the Better Auth configuration, so the
 * `sign-up/email` endpoint rejects every caller. Server-side account creation
 * happens only through `auth.api.createUser` in trusted server scripts and
 * (in later approved batches) operator-authorized server operations.
 */
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "../../../../lib/auth";

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth);
