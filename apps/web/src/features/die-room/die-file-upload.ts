import { trpcClient } from "@/shared/utils/trpc";

import type { DieFileKind } from "./die-room-model";

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Upload one file to a section (or one of its copies). */
export async function uploadDieFile(input: {
  sectionId: string;
  dieInstanceId?: string;
  kind: DieFileKind;
  file: File;
  pressDrawing: boolean;
}) {
  return trpcClient.dieInstance.files.add.mutate({
    sectionId: input.sectionId,
    ...(input.dieInstanceId ? { dieInstanceId: input.dieInstanceId } : {}),
    kind: input.kind,
    filename: input.file.name,
    contentType: input.file.type || null,
    body: await toBase64(input.file),
    pressDrawing: input.pressDrawing,
  });
}
