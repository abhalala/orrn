import { trpcClient } from "@/shared/utils/trpc";

import { docMimeFor, type DocFileKind } from "./adm-model";

/**
 * Attach one file to a register entry in three steps: the server checks it and signs a PUT, the
 * browser sends the bytes straight to storage, the server records it (a new file replaces the old).
 * A stage without file storage refuses the first step (PRECONDITION_FAILED).
 */
export async function uploadDocFile(input: { documentId: string; kind: DocFileKind; file: File }) {
  const begin = await trpcClient.docs.files.beginUpload.mutate({
    documentId: input.documentId,
    kind: input.kind,
    name: input.file.name,
    size: input.file.size,
    mime: docMimeFor(input.kind, input.file),
  });
  const put = await fetch(begin.uploadUrl, { method: begin.method, headers: begin.headers, body: input.file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return trpcClient.docs.files.commit.mutate({ uploadId: begin.uploadId });
}

export async function openDocFile(documentId: string): Promise<void> {
  const { url } = await trpcClient.docs.files.url.query({ documentId });
  window.open(url, "_blank", "noopener,noreferrer");
}
