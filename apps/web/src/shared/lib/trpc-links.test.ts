import { describe, expect, test } from "bun:test";
import { createTRPCUntypedClient } from "@trpc/client";

import { buildTrpcLink } from "./trpc-links";

type Seen = { paths: string[]; company: string | null; impersonate: string | null };

/** A fake network: answers every procedure of a batch with `null` and records each request. */
function setup(opts: { plant: string | null; impersonate?: string | null }) {
  const seen: Seen[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const paths = decodeURIComponent(url.pathname.replace(/^\/trpc\//, "")).split(",");
    const headers = new Headers(init?.headers);
    seen.push({ paths, company: headers.get("x-orrn-company"), impersonate: headers.get("x-orrn-impersonate-company") });
    return new Response(JSON.stringify(paths.map(() => ({ result: { data: null } }))), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = createTRPCUntypedClient({
    links: [buildTrpcLink({ url: "http://api.test/trpc", fetch: fake, getPlant: () => opts.plant, getImpersonation: () => opts.impersonate ?? null })],
  });
  return { client, seen };
}

describe("the tRPC link splits party calls from staff calls", () => {
  test("party-only calls travel together with the plant header", async () => {
    const { client, seen } = setup({ plant: "plant-b" });
    await Promise.all([client.query("portal.me"), client.query("portal.today"), client.query("portal.orders.list", { status: "open" })]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.paths.sort()).toEqual(["portal.me", "portal.orders.list", "portal.today"]);
    expect(seen[0]!.company).toBe("plant-b");
  });

  test("staff calls (auth.me, portal.access, portal.users.*) never carry the party header", async () => {
    const { client, seen } = setup({ plant: "plant-b" });
    await Promise.all([client.query("auth.me"), client.query("portal.access"), client.query("portal.users.list")]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.company).toBeNull();
  });

  test("a mixed tick makes two batches: party with the header, staff without, never together", async () => {
    const { client, seen } = setup({ plant: "plant-b" });
    await Promise.all([client.query("portal.me"), client.query("auth.me"), client.query("portal.today"), client.query("portal.access"), client.query("orders.list")]);
    expect(seen).toHaveLength(2);
    const party = seen.find((s) => s.company === "plant-b")!;
    const staff = seen.find((s) => s.company === null)!;
    expect(party.paths.sort()).toEqual(["portal.me", "portal.today"]);
    expect(staff.paths.sort()).toEqual(["auth.me", "orders.list", "portal.access"]);
  });

  test("no stored plant: party calls go without the header (the server uses the newest login)", async () => {
    const { client, seen } = setup({ plant: null });
    await client.query("portal.me");
    expect(seen[0]!.company).toBeNull();
  });

  test("the impersonation header still rides on both batches", async () => {
    const { client, seen } = setup({ plant: "plant-b", impersonate: "plant-x" });
    await Promise.all([client.query("portal.me"), client.query("auth.me")]);
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => s.impersonate === "plant-x")).toBe(true);
  });
});
