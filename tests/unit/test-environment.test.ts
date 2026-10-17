import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeTestDatabaseUrl,
  getTestDatabaseUrl,
  testDatabaseIdentity,
} from "../helpers/test-environment";

const VALID_TEST_URL =
  "postgresql://tester:not-a-real-password@localhost:5432/lead_tracking_platform_test";

describe("assertSafeTestDatabaseUrl", () => {
  it("accepts a local PostgreSQL URL whose database name ends with _test", () => {
    const url = assertSafeTestDatabaseUrl(VALID_TEST_URL, { databaseUrl: null });
    expect(url.hostname).toBe("localhost");
    expect(testDatabaseIdentity(VALID_TEST_URL)).toEqual({
      host: "localhost",
      port: 5432,
      database: "lead_tracking_platform_test",
    });
  });

  it("rejects a missing value instead of falling back to DATABASE_URL", () => {
    expect(() => assertSafeTestDatabaseUrl(undefined)).toThrow(/TEST_DATABASE_URL is not set/);
    expect(() => assertSafeTestDatabaseUrl("")).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it("rejects non-PostgreSQL URLs", () => {
    expect(() => assertSafeTestDatabaseUrl("mysql://localhost/app_test")).toThrow(/PostgreSQL/);
  });

  it("rejects URLs without a database name", () => {
    expect(() => assertSafeTestDatabaseUrl("postgresql://localhost:5432/")).toThrow(
      /database name/,
    );
  });

  it("rejects a database name that does not end with _test", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://localhost:5432/lead_tracking_platform"),
    ).toThrow(/_test/);
  });

  it("rejects non-local hosts unless explicitly allowed", () => {
    const remote = "postgresql://user:pw@db.example.neon.tech:5432/app_test";
    expect(() =>
      assertSafeTestDatabaseUrl(remote, { allowRemote: false, databaseUrl: null }),
    ).toThrow(/non-local/);
    expect(() =>
      assertSafeTestDatabaseUrl(remote, { allowRemote: true, databaseUrl: null }),
    ).not.toThrow();
  });

  it("rejects a URL that points at the same database as DATABASE_URL", () => {
    // Different credentials, same host/port/database triple.
    const databaseUrl = "postgresql://dev:another-password@localhost:5432/lead_tracking_platform_test";
    expect(() => assertSafeTestDatabaseUrl(VALID_TEST_URL, { databaseUrl })).toThrow(
      /same database/,
    );
  });

  it("allows a different database on the same host as DATABASE_URL", () => {
    const databaseUrl = "postgresql://dev:another-password@localhost:5432/lead_tracking_platform";
    expect(() => assertSafeTestDatabaseUrl(VALID_TEST_URL, { databaseUrl })).not.toThrow();
  });
});

describe("getTestDatabaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails safely when TEST_DATABASE_URL is not configured", () => {
    vi.stubEnv("TEST_DATABASE_URL", "");
    expect(() => getTestDatabaseUrl({ databaseUrl: null })).toThrow(
      /TEST_DATABASE_URL is not set/,
    );
  });
});

describe("ALLOW_REMOTE_TEST_DATABASE safety (Batch 4G / H-2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const REMOTE_TEST_URL = "postgresql://user:pw@db.example.neon.tech:5432/app_test";

  it("still requires the _test suffix when remote hosts are explicitly allowed", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://user:pw@db.example.neon.tech:5432/app",
        { allowRemote: true, databaseUrl: null },
      ),
    ).toThrow(/_test/);
  });

  it("still rejects the DATABASE_URL database when remote hosts are allowed", () => {
    // Same remote host/port/database as DATABASE_URL: the separation check is
    // independent of the remote hatch.
    expect(() =>
      assertSafeTestDatabaseUrl(REMOTE_TEST_URL, {
        allowRemote: true,
        databaseUrl: "postgresql://dev:other-pw@db.example.neon.tech:5432/app_test",
      }),
    ).toThrow(/same database/);
  });

  it("enables remote test databases only for the exact value \"true\"", () => {
    vi.stubEnv("ALLOW_REMOTE_TEST_DATABASE", "1");
    expect(() => assertSafeTestDatabaseUrl(REMOTE_TEST_URL, { databaseUrl: null })).toThrow(
      /non-local/,
    );

    vi.stubEnv("ALLOW_REMOTE_TEST_DATABASE", "true");
    expect(() =>
      assertSafeTestDatabaseUrl(REMOTE_TEST_URL, { databaseUrl: null }),
    ).not.toThrow();
  });
});
