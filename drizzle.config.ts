import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not load Next.js env files by default; load them here so
// `npm run db:generate` and `npm run db:migrate` work with the same local
// configuration as the application. Real environment variables always win.
for (const fileName of [".env.local", ".env"]) {
  const filePath = path.join(process.cwd(), fileName);
  if (fs.existsSync(filePath)) {
    try {
      process.loadEnvFile(filePath);
    } catch {
      // Ignore files that exist but cannot be parsed; drizzle-kit reports
      // missing credentials itself when a command needs them.
    }
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
