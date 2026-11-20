import { errorCodeOf } from "./pump";
import { ticketUrl, UploadPutError } from "./upload";
import type { Words } from "./model";
import type { VisionApi } from "./vision-api";
import type { PageSource } from "./vision-render";
import { isSettled, type VisionPageTicket, type VisionPageView, type VisionPagesOut, type VisionStartOut } from "./vision-types";

/**
 * The vision pump (contract section 9): `vision.start`, render each page the server has no image of, PUT it to its
 * ticket URL, then `vision.readPage` page by page (again while the answer says `next: "retry"`), and `artifact.complete`
 * once `vision.pages` says every page is settled. A closed tab loses nothing: `vision.start` is also the resume call, and
 * a page already read answers its view with no model call. No React here; `use-vision-pump.ts` binds it to a screen.
 */

/** Reads of one page in one pass: the server's own cap is 4 calls per page, so a fifth would only be refused. */
export const PAGE_READS_PER_PASS = 4;
/** Times one pass asks `vision.start` again for fresh tickets (expired, or a page the server says is missing). */
export const START_AGAINS = 3;

export type VisionProgress =
  | { phase: "opening" }
  | { phase: "rendering" | "sending"; page: number; total: number }
  | { phase: "reading"; page: number; total: number }
  | { phase: "page"; page: number; total: number; view: VisionPageView }
  | { phase: "finishing" };

export type VisionPumpDeps = {
  api: VisionApi;
  /** Defaults to `fetch`. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (progress: VisionProgress) => void;
};

export type VisionPumpResult = {
  /** Every planned page is read, typed or skipped. */
  settled: boolean;
  /** `artifact.complete` went through (or another tab had already finished the file). */
  completed: boolean;
  pages: VisionPagesOut;
};

const UPLOAD_FIRST = /^Upload this page first/i;
const ALREADY_READ_FILE = /^This file is already read/i;

const messageOf = (error: unknown): string => {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message.trim() : "";
};

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

/** The ticket statuses that mean "this ticket is no good any more": ask for a new one. */
const STALE_TICKET = new Set([401, 403, 410]);

/**
 * Runs one pass over a file. `source` is the opened file (`openVisualSource`); its page count goes to `vision.start`
 * whole, so the server and the cap line know the file's real size even past the pages read.
 */
export async function runVisionPump(artifactId: string, source: PageSource, deps: VisionPumpDeps): Promise<VisionPumpResult> {
  const { api, signal } = deps;
  const send = deps.fetch ?? fetch;
  const progress = deps.onProgress ?? (() => undefined);
  const pageCount = Math.max(1, Math.min(10_000, source.pageCount));

  let startsLeft = START_AGAINS;
  const startAgain = async (): Promise<VisionStartOut> => {
    if (startsLeft <= 0) throw new Error("vision.start asked too many times");
    startsLeft -= 1;
    return api.start({ artifactId, pageCount });
  };

  aborted(signal);
  let start = await api.start({ artifactId, pageCount });
  const total = start.planned;
  const stored = new Set<number>();

  const putPage = async (ticket: VisionPageTicket): Promise<"stored" | "stale"> => {
    progress({ phase: "rendering", page: ticket.page, total });
    const body = await source.render(ticket.page);
    aborted(signal);
    progress({ phase: "sending", page: ticket.page, total });
    const res = await send(ticketUrl(ticket), { method: "PUT", headers: { "content-type": body.type || "image/jpeg" }, body });
    // 409: an earlier pass already stored this page.
    if (res.ok || res.status === 409) return "stored";
    if (STALE_TICKET.has(res.status)) return "stale";
    throw new UploadPutError(res.status);
  };

  /** Sends every page the server has no image of, asking for fresh tickets when they run out. */
  const sendPages = async (tickets: readonly VisionPageTicket[]): Promise<void> => {
    let queue = [...tickets].sort((a, b) => a.page - b.page);
    while (queue.length > 0) {
      aborted(signal);
      const ticket = queue[0]!;
      // A ticket past its time answers 403: ask for fresh ones (the clocks of the browser and the server may differ, so
      // the answer decides, not `expiresAt`).
      const outcome = await putPage(ticket);
      if (outcome === "stored") {
        stored.add(ticket.page);
        queue = queue.slice(1);
        continue;
      }
      start = await startAgain();
      queue = start.uploads.filter((t) => !stored.has(t.page)).sort((a, b) => a.page - b.page);
    }
  };

  await sendPages(start.uploads);

  for (let page = 1; page <= total; page += 1) {
    let view: VisionPageView | null = null;
    for (let read = 0; read < PAGE_READS_PER_PASS; read += 1) {
      aborted(signal);
      progress({ phase: "reading", page, total });
      try {
        view = await api.readPage({ artifactId, page });
      } catch (error) {
        // The server has no image of this page (a ticket lost in a closed tab): send it again, then read.
        if (errorCodeOf(error) === "BAD_REQUEST" && UPLOAD_FIRST.test(messageOf(error))) {
          start = await startAgain();
          stored.delete(page);
          await sendPages(start.uploads.filter((t) => t.page === page));
          continue;
        }
        // Another tab moved the file: read the page again, which answers its stored view.
        if (errorCodeOf(error) === "CONFLICT") continue;
        throw error;
      }
      if (view.next !== "retry") break;
    }
    if (view) progress({ phase: "page", page, total, view });
  }

  aborted(signal);
  progress({ phase: "finishing" });
  const pages = await api.pages({ artifactId });
  if (!pages.settled) return { settled: false, completed: false, pages };
  const completed = await finishFile(api, artifactId);
  return { settled: true, completed, pages };
}

/** `artifact.complete` on a file whose pages are settled. A file another tab already finished counts as finished. */
export async function finishFile(api: Pick<VisionApi, "complete">, artifactId: string): Promise<boolean> {
  try {
    await api.complete({ artifactId });
    return true;
  } catch (error) {
    if (ALREADY_READ_FILE.test(messageOf(error))) return true;
    throw error;
  }
}

/** Pages still to settle, in page order. */
export function openPages(pages: readonly VisionPageView[]): VisionPageView[] {
  return pages.filter((p) => !isSettled(p.state)).sort((a, b) => a.page - b.page);
}

/** The words of one step, for the live region and the strip ("Reading page 2 of 5"). */
export function visionProgressWords(p: VisionProgress): Words {
  switch (p.phase) {
    case "opening":
      return { key: "ingest.vision.opening" };
    case "rendering":
      return { key: "ingest.vision.rendering", vars: { page: p.page, total: p.total } };
    case "sending":
      return { key: "ingest.vision.sending", vars: { page: p.page, total: p.total } };
    case "reading":
      return { key: "ingest.vision.reading", vars: { page: p.page, total: p.total } };
    case "page":
      return pageResultWords(p.view, p.total);
    case "finishing":
      return { key: "ingest.vision.finishing" };
  }
}

/** "Page 2 of 5 read, 1 table." or "Page 3 of 5 not read." for one page's answer. */
export function pageResultWords(view: Pick<VisionPageView, "page" | "state" | "tables">, total: number): Words {
  switch (view.state) {
    case "read":
      return { key: "ingest.vision.pageRead", vars: { page: view.page, total, count: view.tables } };
    case "typed":
      return { key: "ingest.vision.pageTyped", vars: { page: view.page, total } };
    case "skipped":
      return { key: "ingest.vision.pageSkipped", vars: { page: view.page, total } };
    default:
      return { key: "ingest.vision.pageNotRead", vars: { page: view.page, total } };
  }
}

/** 0 to 1 across the pass: pages sent count half, pages read the other half. */
export function visionShare(p: VisionProgress): number | null {
  switch (p.phase) {
    case "opening":
      return null;
    case "rendering":
    case "sending":
      return p.total > 0 ? ((p.page - 1) / p.total) * 0.5 : null;
    case "reading":
      return p.total > 0 ? 0.5 + ((p.page - 1) / p.total) * 0.5 : null;
    case "page":
      return p.total > 0 ? 0.5 + (p.page / p.total) * 0.5 : null;
    case "finishing":
      return 1;
  }
}
