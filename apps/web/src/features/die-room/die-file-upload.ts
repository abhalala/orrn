import { trpcClient } from "@/shared/utils/trpc";

import { mimeForUpload } from "./bulk-attach";
import type { DieFileKind } from "./die-room-model";

/**
 * Upload one file (to a copy, or the section's press drawing) in three steps: the server
 * checks it and signs a PUT, the browser sends the bytes straight to storage, the server records it.
 */
export async function uploadDieFile(input: {
  /** The section, for its press drawing (which belongs to the section, never to one copy). */
  sectionId: string;
  copyId: string;
  kind: DieFileKind;
  file: File;
  pressDrawing: boolean;
}) {
  const begin = await trpcClient.dieInstance.files.beginUpload.mutate({
    ...(input.pressDrawing ? { sectionId: input.sectionId } : { copyId: input.copyId }),
    kind: input.kind,
    name: input.file.name,
    size: input.file.size,
    mime: input.file.type,
    pressDrawing: input.pressDrawing,
  });
  const put = await fetch(begin.uploadUrl, { method: begin.method, headers: begin.headers, body: input.file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return trpcClient.dieInstance.files.commit.mutate({ uploadId: begin.uploadId });
}

/**
 * Bulk attach (FP-DR-19): one file to the section or copy `files.matchNames` found for it. A PDF of a
 * section asks to be the press drawing only if the section has none when it is saved
 * (`pressDrawingIfNone`), so a bulk run never replaces a drawing.
 */
export async function uploadMatchedFile(input: {
  file: File;
  kind: DieFileKind;
  sectionId: string | null;
  dieInstanceId: string | null;
  pressDrawing: boolean;
}): Promise<{ pressDrawing: boolean }> {
  const begin = await trpcClient.dieInstance.files.beginUpload.mutate({
    ...(input.dieInstanceId ? { copyId: input.dieInstanceId } : { sectionId: input.sectionId ?? undefined }),
    kind: input.kind,
    name: input.file.name,
    size: input.file.size,
    mime: mimeForUpload(input.kind, input.file),
    ...(input.pressDrawing && !input.dieInstanceId ? { pressDrawingIfNone: true } : {}),
  });
  const put = await fetch(begin.uploadUrl, { method: begin.method, headers: begin.headers, body: input.file });
  if (!put.ok) throw new UploadPutError(put.status);
  const saved = await trpcClient.dieInstance.files.commit.mutate({ uploadId: begin.uploadId });
  return { pressDrawing: saved.pressDrawing };
}

/** The signed PUT did not take the bytes (network or storage); the server's own refusals are tRPC errors. */
export class UploadPutError extends Error {
  constructor(readonly status: number) {
    super(`upload failed (${status})`);
  }
}
