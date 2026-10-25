import { atomicBatch, type createDb } from "@orrn/db";
import { spectroInbox } from "@orrn/db/schema/collector";
import { spectroResult } from "@orrn/db/schema/foundry";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

/**
 * Local-only spectro inbox fixtures for the collectors e2e (BACKLOG 97). The demo plant's inbox holds the
 * simulator's file only; a spec that needs a real file adds its own here and removes it when it is done, so
 * test files never sit in the plant the owner opens. Same gate as POST /dev/seed.
 */

type Db = ReturnType<typeof createDb>;

const DEV_COMPANY = "dev-company-orrn";

export const devSpectroInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    /** A short id the spec owns, for example `e2e-attach-375`. */
    id: z.string().trim().regex(/^e2e-[a-z0-9-]{1,48}$/),
    fileName: z.string().trim().min(1).max(120),
  }),
  z.object({ action: z.literal("remove"), id: z.string().trim().regex(/^e2e-[a-z0-9-]{1,48}$/) }),
]);

export async function runDevSpectro(db: Db, input: z.infer<typeof devSpectroInput>) {
  if (input.action === "add") {
    const now = Date.now();
    await db
      .insert(spectroInbox)
      .values({
        id: input.id,
        companyId: DEV_COMPANY,
        sha256: input.id.replace(/[^a-z0-9]/g, "").padEnd(64, "0").slice(0, 64),
        fileName: input.fileName,
        mime: "text/csv",
        sizeBytes: 2_048,
        fileKey: `${DEV_COMPANY}/spectro/${input.id}`,
        status: "pending_review",
        simulated: false,
        capturedAt: new Date(now - 90 * 60_000),
        sampleRef: input.fileName.replace(/\.csv$/, ""),
        instrument: "Spectro 1",
        valuesPpm: { si: 4_500, fe: 2_000, mg: 5_200 },
        uploadedAt: new Date(now - 85 * 60_000),
      })
      .onConflictDoNothing();
    return { ok: true as const };
  }
  const row = await db
    .select({ resultId: spectroInbox.spectroResultId })
    .from(spectroInbox)
    .where(and(eq(spectroInbox.id, input.id), eq(spectroInbox.companyId, DEV_COMPANY)))
    .get();
  if (!row) return { ok: true as const };
  // The inbox row points at its result, so the row goes first.
  await atomicBatch(db, [
    db.delete(spectroInbox).where(and(eq(spectroInbox.id, input.id), eq(spectroInbox.companyId, DEV_COMPANY))),
    ...(row.resultId ? [db.delete(spectroResult).where(inArray(spectroResult.id, [row.resultId]))] : []),
  ]);
  return { ok: true as const };
}
