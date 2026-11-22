/**
 * The deploy workflows run `bun run deploy:dev|prod`, which goes through Turborepo in strict env mode: a name
 * missing from turbo.json `globalPassThroughEnv` reaches alchemy as unset, and the Worker deploys without it.
 * That shipped the import helper off on dev (2026-11-17). Every env name a deploy job sets must pass through.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

function passThrough(): Set<string> {
  const turbo = JSON.parse(readFileSync(resolve(root, "turbo.json"), "utf8")) as { globalPassThroughEnv?: string[] };
  return new Set(turbo.globalPassThroughEnv ?? []);
}

/** The env names under the deploy job's `env:` block: lines indented deeper than `env:` until the indent drops back. */
function jobEnvNames(workflow: string): string[] {
  const lines = readFileSync(resolve(root, ".github/workflows", workflow), "utf8").split("\n");
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)env:\s*$/.exec(lines[i]!);
    if (!head) continue;
    const indent = head[1]!.length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
      if (!m || m[1]!.length <= indent) break;
      names.push(m[2]!);
    }
  }
  return names;
}

type EnvBlock = { owner: "job" | string; names: string[] };

/**
 * Every `env:` block of a workflow with what owns it: `job` for the job-level block, else the step's `name:`.
 * A step block belongs to the nearest `- name:` line above it at a smaller indent.
 */
function envBlocks(workflow: string): EnvBlock[] {
  const lines = readFileSync(resolve(root, ".github/workflows", workflow), "utf8").split("\n");
  const blocks: EnvBlock[] = [];
  let step: { name: string; indent: number } | null = null;
  let inSteps = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*steps:\s*$/.test(line)) inSteps = true;
    const stepHead = /^(\s*)- name:\s*(.+)$/.exec(line);
    if (inSteps && stepHead) step = { name: stepHead[2]!.trim(), indent: stepHead[1]!.length };
    const head = /^(\s*)env:\s*$/.exec(line);
    if (!head) continue;
    const indent = head[1]!.length;
    const names: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (l.trim() === "" || l.trim().startsWith("#")) continue;
      const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*):/.exec(l);
      if (!m || m[1]!.length <= indent) break;
      names.push(m[2]!);
    }
    blocks.push({ owner: inSteps && step && indent > step.indent ? step.name : "job", names });
  }
  return blocks;
}

const HERMES_SECRETS = ["HERMES_BASE_URL", "HERMES_ACCESS_CLIENT_ID", "HERMES_ACCESS_CLIENT_SECRET", "HERMES_API_KEY"];

describe("deploy env reaches alchemy through turbo", () => {
  for (const workflow of ["deploy-dev.yml", "deploy-prod.yml"]) {
    test(`${workflow}: every env name is in turbo.json globalPassThroughEnv`, () => {
      const names = jobEnvNames(workflow);
      expect(names.length).toBeGreaterThan(0);
      const allowed = passThrough();
      expect(names.filter((n) => !allowed.has(n))).toEqual([]);
    });
  }

  test("the import helper's four names pass through", () => {
    const allowed = passThrough();
    for (const n of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "MODEL_ACCESS_CLIENT_ID", "MODEL_ACCESS_CLIENT_SECRET"]) expect(allowed.has(n)).toBe(true);
  });

  test("the buddy's five names pass through and both workflows set them (design 2026-11-18, §6)", () => {
    const names = ["HERMES_BASE_URL", "HERMES_ACCESS_CLIENT_ID", "HERMES_ACCESS_CLIENT_SECRET", "HERMES_API_KEY", "BUDDY_COMPANIES"];
    const allowed = passThrough();
    for (const n of names) expect(allowed.has(n)).toBe(true);
    for (const workflow of ["deploy-dev.yml", "deploy-prod.yml"]) {
      expect(jobEnvNames(workflow)).toEqual(expect.arrayContaining(names));
    }
  });

  test("the HERMES secrets reach only the deploy step, never the job env or the install step (security L6)", () => {
    for (const workflow of ["deploy-dev.yml", "deploy-prod.yml"]) {
      const blocks = envBlocks(workflow);
      const withHermes = blocks.filter((b) => b.names.some((n) => HERMES_SECRETS.includes(n)));
      expect({ workflow, owners: withHermes.map((b) => b.owner) }).toEqual({ workflow, owners: [expect.stringMatching(/^Deploy (dev|prod)/)] });
      expect(withHermes[0]!.names).toEqual(expect.arrayContaining(HERMES_SECRETS));
      const yml = readFileSync(resolve(root, ".github/workflows", workflow), "utf8");
      // The deploy step is the one that runs the deploy script.
      const deployStep = yml.slice(yml.indexOf(`- name: ${withHermes[0]!.owner}`));
      expect(deployStep).toMatch(/run: bun run deploy:(dev|prod)/);
    }
  });

  test("the buddy's Hermes profile name passes through and both workflows set it", () => {
    expect(passThrough().has("BUDDY_HERMES_PROFILE")).toBe(true);
    for (const workflow of ["deploy-dev.yml", "deploy-prod.yml"]) expect(jobEnvNames(workflow)).toContain("BUDDY_HERMES_PROFILE");
  });

  test("the Google sign-in pair passes through and both workflows set it", () => {
    const allowed = passThrough();
    for (const n of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) expect(allowed.has(n)).toBe(true);
    for (const workflow of ["deploy-dev.yml", "deploy-prod.yml"]) {
      expect(jobEnvNames(workflow)).toEqual(expect.arrayContaining(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]));
    }
  });

  test("the native passkey values pass through and both workflows set them (web build and Worker read them)", () => {
    const names = ["ORRN_APPLE_TEAM_ID", "ORRN_ANDROID_CERT_SHA256", "ANDROID_APK_KEY_HASH"];
    const allowed = passThrough();
    for (const n of names) expect(allowed.has(n)).toBe(true);
    for (const workflow of ["deploy-dev.yml", "deploy-prod.yml"]) expect(jobEnvNames(workflow)).toEqual(expect.arrayContaining(names));
  });
});
