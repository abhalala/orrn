import type { IngestApi } from "./api";

/**
 * The browser half of the chunked raw upload (limits brief part B, plan 2026-11-20-chunked-upload.md): start (or resume)
 * the upload with every part's SHA-256, ask for short tickets for the missing parts as it goes, PUT each part as a slice
 * of the file (never the whole file in memory), then complete, which checks the whole file on the server.
 */

export class PartPutError extends Error {
  constructor(readonly status: number) {
    super(`part upload failed (${status})`);
  }
}

/** Parts in flight at once. */
export const PARTS_AT_ONCE = 3;
/** Tickets asked for in one call (the server takes at most 8). */
const TICKETS_PER_CALL = 6;

type Api = Pick<IngestApi, "artifactUploadStart" | "artifactUploadTickets" | "artifactUploadComplete">;

export async function sendParts(input: {
  api: Api;
  file: Pick<Blob, "slice" | "size">;
  artifactId: string;
  partSize: number;
  /** Hex SHA-256 of each part, part 1 first. */
  parts: string[];
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (saved: { parts: number; total: number }) => void;
}): Promise<void> {
  const send = input.fetch ?? fetch;
  const total = input.parts.length;
  let restarts = 0;
  for (;;) {
    const start = await input.api.artifactUploadStart({ artifactId: input.artifactId, parts: input.parts });
    const done = new Set(start.done);
    input.onProgress?.({ parts: done.size, total });
    const missing = input.parts.map((_, i) => i + 1).filter((n) => !done.has(n));
    try {
      await putMissing(missing);
      break;
    } catch (error) {
      // 409: the upload was started again elsewhere; 410: R2 let it run out (7 days). Start once more from what is there.
      if (error instanceof PartPutError && (error.status === 409 || error.status === 410) && restarts < 1) {
        restarts += 1;
        continue;
      }
      throw error;
    }

    async function putMissing(list: number[]): Promise<void> {
      const tickets = new Map<number, string>();
      const ticketFor = async (n: number, fresh = false): Promise<string> => {
        if (!fresh && tickets.has(n)) return tickets.get(n)!;
        // Just in time: this part and the next few that have none yet, so a ticket never waits ten minutes unused.
        const ask = [n, ...list.filter((m) => m > n && !tickets.has(m))].slice(0, TICKETS_PER_CALL);
        const out = await input.api.artifactUploadTickets({ artifactId: input.artifactId, parts: ask });
        for (const t of out.tickets) tickets.set(t.part, t.url);
        return tickets.get(n)!;
      };
      const putOne = async (n: number) => {
        const from = (n - 1) * input.partSize;
        const body = input.file.slice(from, Math.min(input.file.size, from + input.partSize));
        for (let attempt = 0; ; attempt += 1) {
          if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          const url = await ticketFor(n, attempt > 0);
          const res = await send(url, { method: "PUT", body, signal: input.signal });
          if (res.ok) return;
          // 403: the ticket ran out while earlier parts went; one fresh ticket. A wrong digest (400) is tried once more.
          if ((res.status === 403 || res.status === 400) && attempt === 0) continue;
          throw new PartPutError(res.status);
        }
      };
      let next = 0;
      const worker = async () => {
        while (next < list.length) {
          const n = list[next++]!;
          await putOne(n);
          done.add(n);
          input.onProgress?.({ parts: done.size, total });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARTS_AT_ONCE, list.length) }, worker));
    }
  }
  await input.api.artifactUploadComplete({ artifactId: input.artifactId });
}
