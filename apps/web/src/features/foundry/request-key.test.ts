import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * XE FOUNDRY fix round 1: the foundry floor writes the server replays by `clientRequestId` are sent with
 * a key from `useRequestKey` (same content keeps its key; a landed write ends it). A form that sends one
 * without the key, or never ends the attempt, fails here.
 */
const read = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");

const WRITES: { file: string; proc: string; sends: RegExp }[] = [
  { file: "logs-view.tsx", proc: "logs.receive", sends: /receive\.mutate\(\{ \.\.\.parsed\.input, clientRequestId: key\.keyFor\(parsed\.input\) \}\)/ },
  { file: "billets-view.tsx", proc: "billets.cut", sends: /post\.mutate\(\{ \.\.\.check\.input, clientRequestId: key\.keyFor\(check\.input\) \}\)/ },
  { file: "billets-view.tsx", proc: "billets.issue", sends: /post\.mutate\(\{ \.\.\.check\.input, clientRequestId: key\.keyFor\(check\.input\) \}\)/ },
  { file: "rejects-view.tsx", proc: "rejects.create", sends: /post\.mutate\(\{ kind, \.\.\.check\.input, clientRequestId: key\.keyFor\(\{ kind, \.\.\.check\.input \}\) \}\)/ },
  { file: "cast-plan-view.tsx", proc: "castPlan.accept", sends: /accept\.mutate\(\{ \.\.\.body, clientRequestId: acceptKey\.keyFor\(body\) \}\)/ },
];

describe("foundry floor writes carry a replay key", () => {
  for (const w of WRITES) {
    test(`${w.proc} (${w.file})`, () => {
      const src = read(w.file);
      // The mutation's options end the attempt when the server saved it.
      const opts = src.slice(src.indexOf(`trpc.foundry.${w.proc}.mutationOptions(`));
      expect(opts.length).toBeGreaterThan(0);
      expect(opts.slice(0, 200)).toMatch(/onSuccess: \([^)]*\) => \{\s+(?:key|acceptKey)\.landed\(\);/);
      expect(src).toMatch(w.sends);
    });
  }

  test("both billet forms send their own key", () => {
    const src = read("billets-view.tsx");
    expect(src.match(/clientRequestId: key\.keyFor\(check\.input\)/g)?.length).toBe(2);
    expect(src.match(/const key = useRequestKey\(\);/g)?.length).toBe(2);
  });
});
