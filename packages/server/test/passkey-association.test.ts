/**
 * Passkey domain association (plan 2026-11-18, Task 6), the parts that need no database:
 * - the Android passkey origin's hash comes from the release certificate's SHA-256;
 * - the web Worker (orrn.in) serves `/.well-known/*` as JSON and never answers it with the SPA shell.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { apkKeyHashFromCertSha256 } from "@orrn/auth/passkey-config";

import { nativePasskeyBindings } from "../src/infra/nativePasskeys";
import { WEB_EDGE_SCRIPT } from "../src/infra/webEdge";

const CERT = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

describe("apkKeyHashFromCertSha256", () => {
  test("base64url of the 32 certificate bytes, no padding", () => {
    const hash = apkKeyHashFromCertSha256(CERT);
    expect(hash).toBe("FG3pg8VzBlDY7rmVLzT8ZBagg0LmHb6oigSWsj_PROU");
    expect(hash).toHaveLength(43);
    expect(apkKeyHashFromCertSha256(CERT.replaceAll(":", "").toLowerCase())).toBe(hash);
  });

  test("nothing for a blank or malformed value", () => {
    expect(apkKeyHashFromCertSha256(undefined)).toBeUndefined();
    expect(apkKeyHashFromCertSha256("  ")).toBeUndefined();
    expect(apkKeyHashFromCertSha256("12:34")).toBeUndefined();
    expect(apkKeyHashFromCertSha256(`${CERT}:00`)).toBeUndefined();
    expect(apkKeyHashFromCertSha256(CERT.replace("14", "ZZ"))).toBeUndefined();
  });
});

describe("nativePasskeyBindings (what the deploy binds on the Worker)", () => {
  const HASH = "FG3pg8VzBlDY7rmVLzT8ZBagg0LmHb6oigSWsj_PROU";

  test("nothing set: nothing bound, no warning", () => {
    expect(nativePasskeyBindings({})).toEqual({ appleTeamId: undefined, androidApkKeyHash: undefined, warnings: [] });
  });

  test("the Team ID is bound as given (the AASA file is written from the same value)", () => {
    expect(nativePasskeyBindings({ ORRN_APPLE_TEAM_ID: " ABCDE12345 " }).appleTeamId).toBe("ABCDE12345");
  });

  test("the Android hash comes from the certificate, or a given hash that agrees with it", () => {
    expect(nativePasskeyBindings({ ORRN_ANDROID_CERT_SHA256: CERT })).toEqual({ appleTeamId: undefined, androidApkKeyHash: HASH, warnings: [] });
    expect(nativePasskeyBindings({ ORRN_ANDROID_CERT_SHA256: CERT, ANDROID_APK_KEY_HASH: HASH }).androidApkKeyHash).toBe(HASH);
  });

  test("no Android hash without a valid certificate, or when they disagree, so no button the OS refuses", () => {
    for (const env of [
      { ANDROID_APK_KEY_HASH: HASH },
      { ORRN_ANDROID_CERT_SHA256: "12:34", ANDROID_APK_KEY_HASH: HASH },
      { ORRN_ANDROID_CERT_SHA256: CERT, ANDROID_APK_KEY_HASH: "another-hash" },
    ]) {
      const out = nativePasskeyBindings(env);
      expect(out.androidApkKeyHash).toBeUndefined();
      expect(out.warnings).toHaveLength(1);
      expect(out.warnings[0]).not.toContain(HASH);
    }
  });
});

type Assets = { fetch(request: Request): Promise<Response> };
let dir: string;
let worker: { fetch(request: Request, env: { ASSETS: Assets }): Promise<Response> };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "orrn-web-edge-"));
  const file = join(dir, "edge.mjs");
  writeFileSync(file, WEB_EDGE_SCRIPT);
  worker = (await import(pathToFileURL(file).href)).default;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Cloudflare's asset host as configured (SPA not-found handling: unknown paths get the shell, 200). */
function assets(files: Record<string, { body: string; type: string }>): Assets {
  return {
    async fetch(request) {
      const file = files[new URL(request.url).pathname];
      if (file) return new Response(file.body, { headers: { "content-type": file.type } });
      return new Response("<!doctype html><title>orrn</title>", { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  };
}

const AASA = '{"webcredentials":{"apps":["ABCDE12345.in.orrn.app"]}}';
const get = (path: string, accept = "*/*") => new Request(`https://orrn.in${path}`, { headers: { accept } });

describe("the web Worker and /.well-known", () => {
  const env = {
    ASSETS: assets({
      // Cloudflare types a file with no extension as "application/null".
      "/.well-known/apple-app-site-association": { body: AASA, type: "application/null" },
      "/.well-known/assetlinks.json": { body: "[]", type: "application/json" },
    }),
  };

  test("apple-app-site-association is served as application/json", async () => {
    const res = await worker.fetch(get("/.well-known/apple-app-site-association"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe(AASA);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  test("assetlinks.json is served as application/json", async () => {
    const res = await worker.fetch(get("/.well-known/assetlinks.json"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test("a well-known file that was not built is a 404, never the SPA shell", async () => {
    const empty = { ASSETS: assets({}) };
    for (const path of ["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]) {
      for (const accept of ["*/*", "text/html,application/xhtml+xml"]) {
        const res = await worker.fetch(get(path, accept), empty);
        expect(res.status).toBe(404);
        expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
      }
    }
  });

  test("a revalidation (304) of a file that exists passes through, never a 404", async () => {
    const revalidating = { ASSETS: { fetch: async () => new Response(null, { status: 304, headers: { etag: '"a"' } }) } };
    const res = await worker.fetch(get("/.well-known/apple-app-site-association"), revalidating);
    expect(res.status).toBe(304);
  });

  test("other routes still fall back to the SPA shell", async () => {
    const res = await worker.fetch(get("/settings", "text/html"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
