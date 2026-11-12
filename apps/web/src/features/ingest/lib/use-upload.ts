import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { refreshIngest } from "./actions";
import { DEFAULT_LIMITS, detectFileKind, takeFiles } from "./limits";
import { useIngestStatus } from "./queries";
import { ingestErrorWords } from "./errors";
import type { FileProblemKey } from "./limits";
import type { HeaderReply } from "./header-step";
import { hashFile, ReadError, readFile } from "./reader-client";
import { ingestApi } from "./trpc-api";
import { uploadOneFile, type UploadItem } from "./upload";

/** The upload screen's state: add files, watch each one. At most 20 files per batch, one file at a time. */
export function useIngestUpload(): {
  items: UploadItem[];
  /** Files beyond 20 are left out; the count of those is returned. */
  add: (files: readonly File[], note?: string) => { left: number };
  retry: (id: string) => void;
  remove: (id: string) => void;
  /** The person's answer to the header step of a file ("Which row has the column names?"). */
  answerHeader: (id: string, reply: HeaderReply) => void;
  busy: boolean;
} {
  const qc = useQueryClient();
  const status = useIngestStatus();
  const limits = status.data?.limits ?? DEFAULT_LIMITS;
  const [items, setItems] = useState<UploadItem[]>([]);
  const files = useRef(new Map<string, { file: File; note?: string }>());
  const running = useRef<{ id: string; ctl: AbortController } | null>(null);
  const counter = useRef(0);
  const waiting = useRef(new Map<string, { resolve: (reply: HeaderReply) => void; reject: (error: unknown) => void }>());
  const [tick, setTick] = useState(0);

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  const add = useCallback(
    (picked: readonly File[], note?: string) => {
      const { taken, left } = takeFiles(picked, limits.filesPerUpload);
      const fresh: UploadItem[] = taken.map((file) => {
        counter.current += 1;
        const id = `up-${counter.current}`;
        files.current.set(id, { file, note });
        return {
          id, name: file.name, size: file.size, kind: detectFileKind(file.name, file.type, limits)?.kind ?? null,
          step: "queued", progress: null, sent: null, artifactId: null, seenOn: null, notStored: false, problem: null,
        };
      });
      setItems((all) => [...all, ...fresh]);
      return { left: left.length };
    },
    [limits],
  );

  const retry = useCallback(
    (id: string) => patch(id, { step: "queued", progress: null, sent: null, problem: null }),
    [patch],
  );

  const answerHeader = useCallback((id: string, reply: HeaderReply) => {
    const pending = waiting.current.get(id);
    if (!pending) return;
    waiting.current.delete(id);
    pending.resolve(reply);
  }, []);

  const remove = useCallback((id: string) => {
    if (running.current?.id === id) running.current.ctl.abort();
    waiting.current.get(id)?.reject(new DOMException("Cancelled", "AbortError"));
    waiting.current.delete(id);
    files.current.delete(id);
    setItems((all) => all.filter((i) => i.id !== id));
  }, []);

  const next = items.find((i) => i.step === "queued");
  const busy = items.some((i) => i.step === "hashing" || i.step === "reading" || i.step === "saving" || i.step === "sending");
  const nextId = next?.id;

  useEffect(() => {
    if (!nextId || running.current) return;
    const entry = files.current.get(nextId);
    if (!entry) return;
    const ctl = new AbortController();
    running.current = { id: nextId, ctl };
    void uploadOneFile(entry.file, { api: ingestApi(), limits, reader: { hash: hashFile, read: readFile } }, {
      onItem: (p) => patch(nextId, p),
      signal: ctl.signal,
      note: entry.note,
      ask: (view) =>
        new Promise<HeaderReply>((resolve, reject) => {
          waiting.current.set(nextId, { resolve, reject });
        }),
    })
      .catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        // A file orrn could not read says so; a network or server failure says that instead.
        const key = error instanceof ReadError ? "ingest.read.failed" : (ingestErrorWords(error, "action").key as FileProblemKey);
        patch(nextId, { step: "failed", problem: { key } });
      })
      .finally(() => {
        running.current = null;
        void refreshIngest(qc);
        // Wake the effect for the next queued file.
        setTick((t) => t + 1);
      });
  }, [nextId, limits, patch, qc, tick]);

  return { items, add, retry, remove, answerHeader, busy };
}
