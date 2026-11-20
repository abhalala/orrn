import { errorCodeOf } from "./pump";
import { ticketUrl, UploadPutError } from "./upload";
import type { VisionApi } from "./vision-api";
import { VISION_PARAMS } from "@orrn/ingest";

import type { BandHow, PageSource } from "./vision-render";
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

/** Model calls one page may take in one pass: a whole read and each band, each with the server's own 4-call cap. */
export const PAGE_CALLS_PER_PASS = PAGE_READS_PER_PASS * (1 + VISION_PARAMS.maxBandsPerPage);

export type VisionProgress =
  | { phase: "opening" }
  | { phase: "rendering" | "sending" | "cutting"; page: number; total: number }
  | { phase: "reading"; page: number; total: number; band?: { index: number; total: number } }
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

  /**
   * Cuts a page into bands and sends them (section 11.3): `vision.bandTickets` with the band count fixes the cut on the
   * server, then each band image the server lacks goes to its ticket; stale tickets are asked for once more. False when
   * the bands did not all go.
   */
  const sendBands = async (page: number, blobs: readonly Blob[]): Promise<boolean> => {
    let tickets = await api.bandTickets({ artifactId, page, bands: blobs.length });
    for (let round = 0; round < 2; round += 1) {
      let stale = false;
      for (const t of [...tickets.uploads].sort((a, b) => a.band - b.band)) {
        aborted(signal);
        const body = blobs[t.band - 1];
        if (!body) return false;
        progress({ phase: "sending", page, total });
        const res = await send(ticketUrl(t), { method: "PUT", headers: { "content-type": body.type || VISION_PARAMS.pageContentType }, body });
        if (res.ok || res.status === 409) continue;
        if (STALE_TICKET.has(res.status)) {
          stale = true;
          continue;
        }
        throw new UploadPutError(res.status);
      }
      if (!stale) return true;
      tickets = await api.bandTickets({ artifactId, page, bands: blobs.length });
    }
    return false;
  };

  /** The band images of a page (null when it is read whole or cannot be cut on blank rows). */
  const cutPage = async (page: number, how: BandHow): Promise<Blob[] | null> => {
    if (!source.bands) return null;
    progress({ phase: "cutting", page, total });
    return source.bands(page, how).catch(() => null);
  };

  /**
   * Sends the bands of a page again when the server says a band image is missing (a closed tab): the same count the
   * server holds, cut by the text layer first and the ink projection second.
   */
  const resendBands = async (page: number, count: number): Promise<boolean> => {
    for (const how of ["text", "ink"] as const) {
      const blobs = await cutPage(page, how);
      if (blobs && blobs.length === count) return sendBands(page, blobs);
    }
    return false;
  };

  /**
   * A text PDF page past the row threshold goes as bands (counted from the text layer before any call). Its whole image
   * still goes too, for the person who checks the rows against the page. A band step that fails leaves the page whole.
   */
  const bandTextPage = async (page: number): Promise<void> => {
    const blobs = await cutPage(page, "text");
    if (!blobs) return;
    try {
      await sendBands(page, blobs);
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") throw error;
    }
  };

  const putPage = async (ticket: VisionPageTicket): Promise<"stored" | "stale"> => {
    await bandTextPage(ticket.page);
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

  /**
   * Sends the page text of a text PDF (section 11.5) before its page is read, since the digit check runs when the page's
   * blocks are made. Text that is missing, empty or over the cap is not sent, and a text that fails to send only means
   * no marks: it never stops the read.
   */
  const sendTexts = async (tickets: readonly VisionPageTicket[]): Promise<void> => {
    if (!source.text) return;
    let fresh = false;
    for (const ticket of [...tickets].sort((a, b) => a.page - b.page)) {
      aborted(signal);
      const json = await source.text(ticket.page).catch(() => null);
      if (json === null) continue;
      const put = (t: VisionPageTicket) => send(ticketUrl(t), { method: "PUT", headers: { "content-type": "application/json" }, body: json }).catch(() => null);
      let res = await put(ticket);
      if (res && STALE_TICKET.has(res.status) && !fresh && startsLeft > 0) {
        fresh = true;
        start = await startAgain();
        const again = (start.texts ?? []).find((t) => t.page === ticket.page);
        if (again) res = await put(again);
      }
    }
  };

  await sendPages(start.uploads);
  await sendTexts(start.texts ?? []);

  for (let page = 1; page <= total; page += 1) {
    let view: VisionPageView | null = null;
    let band: number | undefined;
    let cut = false;
    let resent = false;
    // Reads per run key in this pass: the whole page and each band have their own cap on the server.
    const keyReads = new Map<string, number>();
    for (let call = 0; call < PAGE_CALLS_PER_PASS; call += 1) {
      aborted(signal);
      const bands = view?.bands ?? null;
      const index = band ?? bands?.next ?? null;
      const key = bands && index ? `b${index}` : "page";
      const done = keyReads.get(key) ?? 0;
      if (done >= PAGE_READS_PER_PASS) break;
      keyReads.set(key, done + 1);
      progress(bands && index ? { phase: "reading", page, total, band: { index, total: bands.total } } : { phase: "reading", page, total });
      try {
        view = await api.readPage(band ? { artifactId, page, band } : { artifactId, page });
        band = undefined;
      } catch (error) {
        band = undefined;
        // The server has no image of this page or of one of its bands (a ticket lost in a closed tab): send it again.
        if (errorCodeOf(error) === "BAD_REQUEST" && UPLOAD_FIRST.test(messageOf(error))) {
          if (!view?.bands) {
            start = await startAgain();
            const again = start.uploads.filter((t) => t.page === page);
            if (again.length > 0) {
              stored.delete(page);
              await sendPages(again);
              continue;
            }
          }
          // No whole-page ticket for it: the page is cut into bands (`vision.start` leaves those out).
          const now = view?.bands ? view : (await api.pages({ artifactId })).pages.find((p) => p.page === page);
          if (!now?.bands || resent || !(await resendBands(page, now.bands.total))) break;
          resent = true;
          continue;
        }
        // Another tab moved the file: read the page again, which answers its stored view.
        if (errorCodeOf(error) === "CONFLICT") continue;
        throw error;
      }
      if (view.next === "band") {
        // A scan or photo too dense to read whole: cut it on blank rows, send the bands, read band 1 first. A page the
        // browser cannot cut stays as it is, and the file page offers Type and Skip for it.
        if (cut) break;
        cut = true;
        const blobs = await cutPage(page, "ink");
        if (!blobs || !(await sendBands(page, blobs).catch(() => false))) break;
        band = 1;
        continue;
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
