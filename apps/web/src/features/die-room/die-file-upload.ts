import { trpcClient } from "@/shared/utils/trpc";

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
