import type { Me } from "@orrn/server/lib/permissions";

type Role = NonNullable<Me["company"]>["role"];

/** A signed-in member for palette tests. */
export function testMe(role: Role, extra: { modules?: string[]; plants?: number; impersonating?: boolean } = {}): Me {
  const plants = Array.from({ length: extra.plants ?? 1 }, (_, i) => ({ companyId: `plant-${i + 1}`, name: `Plant ${i + 1}`, role }));
  return {
    user: { id: "user-1", name: "Test Person", email: "t@example.test" },
    company: { id: "plant-1", name: "Plant 1", slug: "plant-1", status: "active", plan: null, role, modules: extra.modules ?? [] },
    memberships: plants,
    isPlatformAdmin: false,
    impersonation: extra.impersonating
      ? { actorUserId: "staff", companyId: "plant-1", grantId: "g", expiresAt: "2099-01-01T00:00:00Z" }
      : null,
  };
}
