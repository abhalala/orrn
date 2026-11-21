import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";

/**
 * Words of the import portal release 2 fix round (web review N12, N13, decision 14). One word for "row" in each
 * language on the import screens (लाइन, લાઇન); button names inside a sentence are quoted with the label the screen shows;
 * the Godseye Limits tab, the release 2 audit entries and the upload hints read in Gujarati.
 */

type Tree = { readonly [key: string]: string | Tree };
const flat = (tree: Tree, prefix = ""): [string, string][] =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[prefix + k, v] as [string, string]] : flat(v, `${prefix}${k}.`)));
const at = (tree: unknown, path: string): string | undefined =>
  path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree) as string | undefined;

describe("import words", () => {
  test("the import screens use लाइन and લાઇન for a row, never रो or રો", () => {
    const ingestHi = flat((hi as unknown as { ingest: Tree }).ingest);
    const ingestGu = flat((gu as unknown as { ingest: Tree }).ingest);
    expect(ingestHi.filter(([, v]) => /(^|[\s(])रो([\s,।]|$)/.test(v)).map(([k]) => k)).toEqual([]);
    expect(ingestGu.filter(([, v]) => /(^|[\s(])રો([\s,.]|$)/.test(v)).map(([k]) => k)).toEqual([]);
  });

  test("the day cap lines quote the button by its label in each language (N12)", () => {
    for (const key of ["ingest.vision.dayCostLine", "ingest.vision.dayCallsLine"]) {
      expect(at(en, key)).toContain(`"${at(en, "ingest.vision.readNext")}"`);
      expect(at(hi, key)).toContain(`"${at(hi, "ingest.vision.readNext")}"`);
      expect(at(gu, key)).toContain(`"${at(gu, "ingest.vision.readNext")}"`);
    }
  });

  test("the plan line does not say planned (N12); the check line has a subject (N13)", () => {
    expect(at(en, "ingest.vision.cap")).not.toMatch(/planned/i);
    expect(at(hi, "ingest.vision.cap")).not.toContain("तय");
    expect(at(hi, "ingest.vision.check")).toMatch(/^लाइनें/);
    expect(at(gu, "ingest.vision.check")).toMatch(/^લાઇનો/);
    expect(at(gu, "ingest.vision.tick")).toContain("લાઇનો");
    expect(at(gu, "ingest.vision.cutting")).not.toContain("છીએ");
  });

  test("Gujarati for the Limits tab, the release 2 audit entries and the upload hints (decision 14)", () => {
    const limits = flat((en as unknown as { admin: { limits: Tree } }).admin.limits, "admin.limits.");
    const audit = Object.keys((en as unknown as { audit: { actions: Record<string, string> } }).audit.actions)
      .filter((k) => k.startsWith("ingest__vision__") || k === "platform__company__limits__update")
      .map((k) => `audit.actions.${k}`);
    const drop = ["ingest.drop.hint", "ingest.drop.left", "ingest.drop.tooManyRows", "ingest.drop.openLimit"];
    const missing = [...limits.map(([k]) => k), ...audit, ...drop].filter((k) => typeof at(gu, k) !== "string");
    expect(missing).toEqual([]);
    expect(audit.length).toBe(10);
  });
});
