import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { refreshIngest } from "./actions";
import type { HeaderAskView, HeaderReply } from "./header-step";
import { hashFile, ReadError, readFile } from "./reader-client";
import { rememberedFile, type ReputAction } from "./reput";
import { useArtifact } from "./queries";
import { ingestApi } from "./trpc-api";
import { ReputError, uploadOneFile } from "./upload";

/**
 * Putting a table of an import again from its review screen ("Start a new table here"). It needs the file, which the page
 * has only if this tab added it; otherwise the person is asked for it, and it must be the same file (same SHA-256).
 */
export type ReputState =
  | { phase: "idle" }
  | { phase: "needFile"; action: ReputAction; wrongFile: boolean }
  | { phase: "running" }
  | { phase: "asking"; view: HeaderAskView }
  | { phase: "done" }
  | { phase: "error"; error: unknown };

export function useReput(artifactId: string): {
  state: ReputState;
  request: (action: ReputAction) => void;
  chooseFile: (file: File) => void;
  reply: (reply: HeaderReply) => void;
  dismiss: () => void;
  busy: boolean;
} {
  const qc = useQueryClient();
  const artifact = useArtifact(artifactId);
  const [state, setState] = useState<ReputState>({ phase: "idle" });
  const waiting = useRef<((reply: HeaderReply) => void) | null>(null);
  const action = useRef<ReputAction | null>(null);

  const run = useCallback(
    async (file: File, what: ReputAction) => {
      const art = artifact.data;
      if (!art) return;
      setState({ phase: "running" });
      try {
        await uploadOneFile(
          file,
          { api: ingestApi(), reader: { hash: hashFile, read: readFile } },
          {
            onItem: (p) => {
              if (p.ask) setState({ phase: "asking", view: p.ask });
              else if (p.ask === null) setState({ phase: "running" });
            },
            ask: (view) => new Promise<HeaderReply>((resolve) => void (waiting.current = resolve)),
            reput: {
              sha256: art.sha256,
              stored: art.blocks.map((b) => ({ ordinal: b.ordinal, sheetName: b.sheetName, headerRow: b.headerRow, headerRows: b.headerRows })),
              action: what,
            },
          },
        );
        await refreshIngest(qc);
        setState({ phase: "done" });
      } catch (error) {
        if (error instanceof ReputError && error.code === "other_file") setState({ phase: "needFile", action: what, wrongFile: true });
        else setState({ phase: "error", error: error instanceof ReadError ? new ReputError("unavailable") : error });
      }
    },
    [artifact.data, qc],
  );

  const request = useCallback(
    (what: ReputAction) => {
      action.current = what;
      const file = rememberedFile(artifactId);
      if (file) void run(file, what);
      else setState({ phase: "needFile", action: what, wrongFile: false });
    },
    [artifactId, run],
  );
  const chooseFile = useCallback((file: File) => action.current && void run(file, action.current), [run]);
  const reply = useCallback((r: HeaderReply) => {
    const resolve = waiting.current;
    waiting.current = null;
    resolve?.(r);
  }, []);
  return { state, request, chooseFile, reply, dismiss: () => setState({ phase: "idle" }), busy: state.phase === "running" || state.phase === "asking" };
}
