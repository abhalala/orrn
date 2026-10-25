/**
 * Writes apps/server/.dev.local-account.local (gitignored) with the seeded dev logins so
 * Playwright and humans can read them. Run with: bun run --cwd apps/server scripts/write-local-accounts.ts
 *
 * The password comes from `vars.ORRN_LOCAL_PASSWORD` in wrangler.local.jsonc; the emails are the
 * fixed accounts created by POST /dev/seed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEV_ACCOUNTS } from "../src/dev-accounts";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Strip // and /* *\/ comments without touching "//" inside strings (URLs). */
function stripJsonComments(source: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 1;
    } else {
      out += char;
    }
  }
  return out;
}

const config = JSON.parse(
  stripJsonComments(readFileSync(join(serverDir, "wrangler.local.jsonc"), "utf8")),
) as { vars?: Record<string, string> };

const password = config.vars?.ORRN_LOCAL_PASSWORD;
if (!password) {
  console.error("wrangler.local.jsonc has no vars.ORRN_LOCAL_PASSWORD; add it and re-run.");
  process.exit(1);
}

const lines = [
  "# Local test accounts (local wrangler D1 only, never deployed). Created by POST /dev/seed.",
  "# One shared password; every plant role has a login, plus platform staff and the KD party (portal) login.",
  // ORRN_LOCAL_EMAIL_OWNER, _OPERATOR, _VIEWER, _OFFICE, _ADMIN, _MANAGER, _PACKER, ... _STAFF, _PARTY.
  ...Object.entries(DEV_ACCOUNTS).map(([key, account]) => `ORRN_LOCAL_EMAIL_${key.toUpperCase()}=${account.email}`),
  `ORRN_LOCAL_PASSWORD=${password}`,
  // Backwards-compatible alias for older helpers.
  `ORRN_LOCAL_EMAIL=${DEV_ACCOUNTS.owner.email}`,
  "",
];

const target = join(serverDir, ".dev.local-account.local");
writeFileSync(target, lines.join("\n"));
console.log(`Wrote ${target}`);
