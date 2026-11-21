/**
 * Composite import drafts, tool leg (fix round decision 8). Two MCP tools make one draft each:
 *
 * - `orrn_import_answers({ candidateId, answers })`: path `import.answerQuestions`, kind "answers". Confirm runs
 *   `ingest.answer.set` for each answer, in order, with the candidate's current `expectSeq` each time.
 * - `orrn_import_dry_run({ candidateId })`: path `import.runDryRun`, kind "dryRun". Confirm checks the candidate and
 *   settles the draft with a `drive`; the browser then pumps `ingest.dryRun.step` to the end and reports.
 *
 * Each composite is decided, guarded and validated as the one ingest procedure it runs. Nothing here writes or runs
 * anything; `draftCreate.ts` stores the draft.
 */
import { z } from "zod";

import { refusedInput } from "./decisions";
import { IMPORT_ANSWERS_PATH, IMPORT_DRY_RUN_PATH, KIND_TARGET } from "./draftView";
import { statusEnvelope, type Envelope } from "./envelope";
import type { BuddyContext } from "./grantContext";
import { allowedProcedure, roleHoldsGuard, validateInput } from "./registry";

export type PreparedDraft = { path: string; kind: "answers" | "dryRun"; input: unknown; summary: string };
type Prepared = { ok: true; draft: PreparedDraft } | { ok: false; envelope: Envelope };

const id = z.string().min(1).max(64);
const answersArgs = z.strictObject({
  candidateId: id,
  answers: z
    .array(z.strictObject({ questionCode: z.string().min(1).max(64), subject: z.string().max(200), answer: z.unknown() }))
    .min(1)
    .max(200),
});
const dryRunArgs = z.strictObject({ candidateId: id });

async function target(kind: "answers" | "dryRun", ctx: BuddyContext): Promise<{ ok: true; entry: NonNullable<Awaited<ReturnType<typeof allowedProcedure>>> } | { ok: false; envelope: Envelope }> {
  const entry = await allowedProcedure(KIND_TARGET[kind]);
  if (!entry) return { ok: false, envelope: statusEnvelope("not_found", "Not found.") };
  if (roleHoldsGuard(entry.guard, ctx.role) === false) {
    const action = entry.guard ? entry.guard.actions.join(entry.guard.mode === "all" ? " and " : " or ") : "";
    return { ok: false, envelope: statusEnvelope("forbidden", `The person's role cannot do this. It needs the action "${action}".`) };
  }
  return { ok: true, entry };
}

export async function prepareImportAnswers(args: Record<string, unknown>, ctx: BuddyContext): Promise<Prepared> {
  const t = await target("answers", ctx);
  if (!t.ok) return t;
  const parsed = answersArgs.safeParse(args);
  if (!parsed.success) return { ok: false, envelope: statusEnvelope("invalid", "The input does not fit.", { issues: parsed.error.issues.slice(0, 20) }) };
  const { candidateId, answers } = parsed.data;
  // Each answer must be one `ingest.answer.set` call as Confirm will make it (expectSeq is filled in at Confirm).
  for (const [i, a] of answers.entries()) {
    const one = { candidateId, questionCode: a.questionCode, subject: a.subject, answer: a.answer, expectSeq: 0 };
    const refused = refusedInput(t.entry.decision, one);
    if (refused) return { ok: false, envelope: statusEnvelope("forbidden", refused) };
    const valid = validateInput(t.entry, one);
    if (!valid.ok) {
      return { ok: false, envelope: statusEnvelope("invalid", `Answer ${i + 1} does not fit.`, { issues: valid.issues }) };
    }
  }
  return {
    ok: true,
    draft: {
      path: IMPORT_ANSWERS_PATH,
      kind: "answers",
      input: { candidateId, answers: answers.map((a) => ({ questionCode: a.questionCode, subject: a.subject, answer: a.answer })) },
      summary: `Answer ${answers.length} question${answers.length === 1 ? "" : "s"} of an import table.`,
    },
  };
}

export async function prepareImportDryRun(args: Record<string, unknown>, ctx: BuddyContext): Promise<Prepared> {
  const t = await target("dryRun", ctx);
  if (!t.ok) return t;
  const parsed = dryRunArgs.safeParse(args);
  if (!parsed.success) return { ok: false, envelope: statusEnvelope("invalid", "The input does not fit.", { issues: parsed.error.issues.slice(0, 20) }) };
  return {
    ok: true,
    draft: {
      path: IMPORT_DRY_RUN_PATH,
      kind: "dryRun",
      input: { candidateId: parsed.data.candidateId },
      summary: "Run the dry run of an import table to the end.",
    },
  };
}
