import { describe, expect, it } from "vitest";

import {
  assertLocalDevelopmentDatabaseTarget,
  assertSafeBootstrapTarget,
  DatabaseSafetyError,
} from "../../src/lib/database-safety";

const LOCAL_URL = "postgresql://dev_user:dev_pass@localhost:5432/lead_tracking_platform";

describe("assertLocalDevelopmentDatabaseTarget", () => {
  it("accepts a local development database and reports a credential-free summary", () => {
    const target = assertLocalDevelopmentDatabaseTarget({ DATABASE_URL: LOCAL_URL });
    expect(target.host).toBe("localhost");
    expect(target.database).toBe("lead_tracking_platform");
    expect(target.summary).toBe("localhost:5432/lead_tracking_platform");
    expect(target.summary).not.toContain("dev_pass");
  });

  it("fails closed when DATABASE_URL is missing or unparseable", () => {
    expect(() => assertLocalDevelopmentDatabaseTarget({})).toThrow(DatabaseSafetyError);
    expect(() =>
      assertLocalDevelopmentDatabaseTarget({ DATABASE_URL: "not a url" }),
    ).toThrow(DatabaseSafetyError);
    expect(() =>
      assertLocalDevelopmentDatabaseTarget({ DATABASE_URL: "mysql://localhost:3306/db" }),
    ).toThrow(DatabaseSafetyError);
  });

  it("refuses hosted production databases such as Neon", () => {
    expect(() =>
      assertLocalDevelopmentDatabaseTarget({
        DATABASE_URL:
          "postgresql://user:secret@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb",
      }),
    ).toThrowError(/non-local host/i);
  });

  it("refuses the dedicated test database", () => {
    expect(() =>
      assertLocalDevelopmentDatabaseTarget({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/lead_tracking_platform_test",
      }),
    ).toThrowError(/_test/i);
  });

  it("never reads TEST_DATABASE_URL", () => {
    expect(() =>
      assertLocalDevelopmentDatabaseTarget({
        TEST_DATABASE_URL: "postgresql://user:pass@localhost:5432/lead_tracking_platform_test",
      }),
    ).toThrow(DatabaseSafetyError);
  });
});

describe("assertSafeBootstrapTarget", () => {
  it("accepts a local development database outside production", () => {
    const target = assertSafeBootstrapTarget({
      DATABASE_URL: LOCAL_URL,
      NODE_ENV: "development",
    });
    expect(target.database).toBe("lead_tracking_platform");
  });

  it("refuses to run with NODE_ENV=production", () => {
    expect(() =>
      assertSafeBootstrapTarget({ DATABASE_URL: LOCAL_URL, NODE_ENV: "production" }),
    ).toThrowError(/production/i);
  });

  it("cannot be pointed at Neon production by accident", () => {
    expect(() =>
      assertSafeBootstrapTarget({
        DATABASE_URL:
          "postgresql://user:secret@ep-production-abc.aws.neon.tech/neondb",
        NODE_ENV: "development",
      }),
    ).toThrowError(/non-local host/i);
  });

  it("ignores TEST_DATABASE_URL entirely (no fallback)", () => {
    expect(() =>
      assertSafeBootstrapTarget({
        TEST_DATABASE_URL: LOCAL_URL,
        NODE_ENV: "development",
      }),
    ).toThrowError(/DATABASE_URL is not set/);
  });
});
