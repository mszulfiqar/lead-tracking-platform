/**
 * Unit tests for the organization-lookup guard (Batch 4G / V-1 remediation).
 *
 * The guard removes the organization-existence oracle from Better Auth's
 * organization read/activation endpoints: for an explicit organization
 * target, non-members and unknown targets must receive one identical,
 * endpoint-specific 403 response. These tests pin the pure target-resolution
 * rules (which must mirror the plugin's precedence) and the guard's
 * decision table with injected dependencies.
 */
import { describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";

import {
  createOrganizationLookupGuard,
  organizationLookupRejection,
  resolveOrganizationLookupTarget,
  type OrganizationLookupGuardDeps,
} from "../../src/lib/organization-lookup-guard";

function testHeaders(): Headers {
  return new Headers({ cookie: "better-auth.session_token=unit-test" });
}

function createDeps(
  overrides: Partial<OrganizationLookupGuardDeps> = {},
): OrganizationLookupGuardDeps {
  return {
    getSessionUserId: vi.fn(async () => "user-1"),
    findOrganizationIdBySlug: vi.fn(async () => null),
    isOrganizationMember: vi.fn(async () => false),
    ...overrides,
  };
}

async function runGuard(
  deps: OrganizationLookupGuardDeps,
  context: {
    path: string;
    query?: unknown;
    body?: unknown;
    headers?: Headers;
  },
) {
  const guard = createOrganizationLookupGuard(deps);
  try {
    await guard(context);
    return { rejected: false as const };
  } catch (error) {
    if (error instanceof APIError) {
      return {
        rejected: true as const,
        status: error.statusCode,
        body: error.body as { code?: string; message?: string },
      };
    }
    throw error;
  }
}

describe("resolveOrganizationLookupTarget", () => {
  const GET_PATHS = [
    "/organization/get-organization",
    "/organization/get-full-organization",
    "/organization/list-members",
    "/organization/get-active-member-role",
  ];

  it("prefers a non-empty slug over an ID on the GET endpoints", () => {
    for (const path of GET_PATHS) {
      expect(
        resolveOrganizationLookupTarget(path, {
          organizationId: "org-1",
          organizationSlug: "slug-1",
        }, undefined),
      ).toEqual({ kind: "slug", value: "slug-1" });
    }
  });

  it("falls back to a non-empty ID when no slug is present", () => {
    for (const path of GET_PATHS) {
      expect(
        resolveOrganizationLookupTarget(path, { organizationId: "org-1" }, undefined),
      ).toEqual({ kind: "id", value: "org-1" });
    }
  });

  it("treats blank and non-string values as absent (plugin schema owns those)", () => {
    for (const path of GET_PATHS) {
      expect(
        resolveOrganizationLookupTarget(
          path,
          { organizationId: "", organizationSlug: "" },
          undefined,
        ),
      ).toBeNull();
      expect(
        resolveOrganizationLookupTarget(path, { organizationId: 42 }, undefined),
      ).toBeNull();
      expect(
        resolveOrganizationLookupTarget(path, { organizationSlug: ["a", "b"] }, undefined),
      ).toBeNull();
      expect(resolveOrganizationLookupTarget(path, undefined, undefined)).toBeNull();
    }
  });

  it("ignores unguarded paths even with explicit-looking input", () => {
    expect(
      resolveOrganizationLookupTarget(
        "/organization/list",
        { organizationId: "org-1" },
        undefined,
      ),
    ).toBeNull();
    expect(
      resolveOrganizationLookupTarget(
        "/organization/has-permission",
        undefined,
        { organizationId: "org-1" },
      ),
    ).toBeNull();
  });

  it("mirrors the set-active precedence: an explicit null unsets and wins over a slug", () => {
    expect(
      resolveOrganizationLookupTarget(
        "/organization/set-active",
        undefined,
        { organizationId: null, organizationSlug: "slug-1" },
      ),
    ).toBeNull();
  });

  it("mirrors the set-active precedence: a non-empty ID wins over a slug", () => {
    expect(
      resolveOrganizationLookupTarget(
        "/organization/set-active",
        undefined,
        { organizationId: "org-1", organizationSlug: "slug-1" },
      ),
    ).toEqual({ kind: "id", value: "org-1" });
  });

  it("uses a slug for set-active when the ID is absent or blank", () => {
    expect(
      resolveOrganizationLookupTarget("/organization/set-active", undefined, {
        organizationSlug: "slug-1",
      }),
    ).toEqual({ kind: "slug", value: "slug-1" });
    expect(
      resolveOrganizationLookupTarget("/organization/set-active", undefined, {
        organizationId: "",
        organizationSlug: "slug-1",
      }),
    ).toEqual({ kind: "slug", value: "slug-1" });
  });

  it("treats set-active without any explicit target as the active-org fallback", () => {
    expect(
      resolveOrganizationLookupTarget("/organization/set-active", undefined, {}),
    ).toBeNull();
    expect(
      resolveOrganizationLookupTarget("/organization/set-active", undefined, undefined),
    ).toBeNull();
  });
});

describe("organizationLookupRejection", () => {
  it("maps the five guarded paths to the plugin's own error codes", () => {
    expect(organizationLookupRejection("/organization/get-organization")).toEqual({
      code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      message: "User is not a member of the organization",
    });
    expect(organizationLookupRejection("/organization/get-full-organization")).toEqual({
      code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      message: "User is not a member of the organization",
    });
    expect(organizationLookupRejection("/organization/set-active")).toEqual({
      code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      message: "User is not a member of the organization",
    });
    expect(organizationLookupRejection("/organization/list-members")).toEqual({
      code: "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION",
      message: "You are not a member of this organization",
    });
    expect(organizationLookupRejection("/organization/get-active-member-role")).toEqual({
      code: "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION",
      message: "You are not a member of this organization",
    });
  });

  it("returns null for every other path", () => {
    expect(organizationLookupRejection("/organization/list")).toBeNull();
    expect(organizationLookupRejection("/organization/update")).toBeNull();
    expect(organizationLookupRejection("/get-session")).toBeNull();
  });
});

describe("createOrganizationLookupGuard", () => {
  it("rejects a non-member of an existing organization with the uniform 403", async () => {
    const deps = createDeps({
      findOrganizationIdBySlug: vi.fn(async () => "org-1"),
      isOrganizationMember: vi.fn(async () => false),
    });

    const result = await runGuard(deps, {
      path: "/organization/get-organization",
      query: { organizationSlug: "slug-1" },
      headers: testHeaders(),
    });

    expect(result).toEqual({
      rejected: true,
      status: 403,
      body: {
        message: "User is not a member of the organization",
        code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      },
    });
    expect(deps.isOrganizationMember).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("answers an unknown slug with the same 403 as an existing non-member organization", async () => {
    const existing = await runGuard(
      createDeps({
        findOrganizationIdBySlug: vi.fn(async () => "org-1"),
        isOrganizationMember: vi.fn(async () => false),
      }),
      {
        path: "/organization/get-organization",
        query: { organizationSlug: "slug-1" },
        headers: testHeaders(),
      },
    );
    const unknownDeps = createDeps({
      findOrganizationIdBySlug: vi.fn(async () => null),
    });
    const unknown = await runGuard(unknownDeps, {
      path: "/organization/get-organization",
      query: { organizationSlug: "no-such-slug" },
      headers: testHeaders(),
    });

    expect(unknown).toEqual(existing);
    expect(unknownDeps.isOrganizationMember).not.toHaveBeenCalled();
  });

  it("answers an unknown ID with the same 403 as an existing non-member organization", async () => {
    const existing = await runGuard(
      createDeps({ isOrganizationMember: vi.fn(async () => false) }),
      {
        path: "/organization/list-members",
        query: { organizationId: "org-1" },
        headers: testHeaders(),
      },
    );
    const unknownDeps = createDeps({
      isOrganizationMember: vi.fn(async () => false),
    });
    const unknown = await runGuard(unknownDeps, {
      path: "/organization/list-members",
      query: { organizationId: "no-such-org-id" },
      headers: testHeaders(),
    });

    expect(unknown).toEqual(existing);
    // The ID is checked directly; no slug lookup happens for ID targets.
    expect(unknownDeps.findOrganizationIdBySlug).not.toHaveBeenCalled();
    expect(unknownDeps.isOrganizationMember).toHaveBeenCalledWith({
      organizationId: "no-such-org-id",
      userId: "user-1",
    });
  });

  it("uses the endpoint-specific rejection code per path", async () => {
    const listMembers = await runGuard(
      createDeps({ isOrganizationMember: vi.fn(async () => false) }),
      {
        path: "/organization/list-members",
        query: { organizationId: "org-1" },
        headers: testHeaders(),
      },
    );
    expect(listMembers).toMatchObject({
      rejected: true,
      body: { code: "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION" },
    });

    const setActive = await runGuard(
      createDeps({ isOrganizationMember: vi.fn(async () => false) }),
      {
        path: "/organization/set-active",
        body: { organizationId: "org-1" },
        headers: testHeaders(),
      },
    );
    expect(setActive).toMatchObject({
      rejected: true,
      body: { code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION" },
    });
  });

  it("lets members through without altering endpoint behavior", async () => {
    const deps = createDeps({
      findOrganizationIdBySlug: vi.fn(async () => "org-1"),
      isOrganizationMember: vi.fn(async () => true),
    });

    const result = await runGuard(deps, {
      path: "/organization/get-full-organization",
      query: { organizationSlug: "slug-1" },
      headers: testHeaders(),
    });

    expect(result).toEqual({ rejected: false });
    expect(deps.isOrganizationMember).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("leaves unauthenticated requests to Better Auth (401 for every target)", async () => {
    const deps = createDeps({
      getSessionUserId: vi.fn(async () => null),
    });

    const result = await runGuard(deps, {
      path: "/organization/get-organization",
      query: { organizationSlug: "slug-1" },
      headers: testHeaders(),
    });

    expect(result).toEqual({ rejected: false });
    expect(deps.findOrganizationIdBySlug).not.toHaveBeenCalled();
    expect(deps.isOrganizationMember).not.toHaveBeenCalled();
  });

  it("skips requests without headers, without an explicit target, and unguarded paths", async () => {
    const deps = createDeps();

    await expect(
      runGuard(deps, {
        path: "/organization/get-organization",
        query: { organizationSlug: "slug-1" },
      }),
    ).resolves.toEqual({ rejected: false });

    await expect(
      runGuard(deps, {
        path: "/organization/get-organization",
        headers: testHeaders(),
      }),
    ).resolves.toEqual({ rejected: false });

    await expect(
      runGuard(deps, {
        path: "/organization/list",
        query: { organizationSlug: "slug-1" },
        headers: testHeaders(),
      }),
    ).resolves.toEqual({ rejected: false });

    expect(deps.getSessionUserId).not.toHaveBeenCalled();
    expect(deps.findOrganizationIdBySlug).not.toHaveBeenCalled();
    expect(deps.isOrganizationMember).not.toHaveBeenCalled();
  });

  it("lets a legitimate set-active unset (organizationId: null) through untouched", async () => {
    const deps = createDeps();

    const result = await runGuard(deps, {
      path: "/organization/set-active",
      body: { organizationId: null },
      headers: testHeaders(),
    });

    expect(result).toEqual({ rejected: false });
    expect(deps.getSessionUserId).not.toHaveBeenCalled();
  });
});
