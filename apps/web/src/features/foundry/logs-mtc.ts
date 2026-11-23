import { trpcClient } from "@/shared/utils/trpc";

/**
 * Upload a mill test certificate (PDF or photo) to a log receipt in three steps, like a die file: the
 * server checks it and signs a PUT, the browser sends the bytes straight to storage, the server records it.
 */
export async function uploadMtc(input: { receiptId: string; file: File }) {
  const begin = await trpcClient.foundry.logs.beginMtc.mutate({ id: input.receiptId, name: input.file.name, size: input.file.size, mime: input.file.type });
  const put = await fetch(begin.uploadUrl, { method: begin.method, headers: begin.headers, body: input.file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return trpcClient.foundry.logs.commitMtc.mutate({ id: input.receiptId, uploadId: begin.uploadId });
}
