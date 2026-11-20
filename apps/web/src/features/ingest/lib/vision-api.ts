import { trpcClient } from "@/shared/utils/trpc";

import type { CandidateDetail } from "./types";
import type { VisionBandTicketsOut, VisionPageView, VisionPagesOut, VisionReadUrlIn, VisionStartOut } from "./vision-types";

/**
 * The `ingest.vision` router as the web calls it (contract section 7). The pump and the screens take a `VisionApi`
 * so tests can pass a fake; `visionApi()` is the real one, on the app's tRPC client.
 */
export type VisionApi = {
  start: (input: { artifactId: string; pageCount: number }) => Promise<VisionStartOut>;
  /** `band`: read that band of a page cut into bands (section 11.3); left out, the next band or the whole page. */
  readPage: (input: { artifactId: string; page: number; band?: number }) => Promise<VisionPageView>;
  /** Cuts a page into `bands` bands (2..4) once and hands a ticket per band image the server does not have. */
  bandTickets: (input: { artifactId: string; page: number; bands: number }) => Promise<VisionBandTicketsOut>;
  pages: (input: { artifactId: string }) => Promise<VisionPagesOut>;
  skipPage: (input: { artifactId: string; page: number }) => Promise<VisionPageView>;
  typePage: (input: { artifactId: string; page: number; title: string | null; headers: string[]; rows: string[][] }) => Promise<VisionPageView>;
  readUrl: (input: VisionReadUrlIn) => Promise<{ url: string; expiresAt: number }>;
  check: (input: { candidateId: string; expectSeq: number; checked: boolean }) => Promise<CandidateDetail>;
  fixCell: (input: { candidateId: string; expectSeq: number; rowIndex: number; col: number; text: string }) => Promise<CandidateDetail>;
  /** `artifact.complete` once every page is settled. */
  complete: (input: { artifactId: string }) => Promise<unknown>;
};

let override: VisionApi | null = null;
let real: VisionApi | null = null;

function build(): VisionApi {
  const c = trpcClient.ingest;
  return {
    start: (i) => c.vision.start.mutate(i),
    readPage: (i) => c.vision.readPage.mutate(i),
    bandTickets: (i) => c.vision.bandTickets.mutate(i),
    pages: (i) => c.vision.pages.query(i),
    skipPage: (i) => c.vision.skipPage.mutate(i),
    typePage: (i) => c.vision.typePage.mutate(i),
    readUrl: (i) => c.vision.readUrl.query(i),
    check: (i) => c.vision.check.mutate(i),
    fixCell: (i) => c.vision.fixCell.mutate(i),
    complete: (i) => c.artifact.complete.mutate(i),
  };
}

export function visionApi(): VisionApi {
  if (override) return override;
  real ??= build();
  return real;
}

/** For tests: replace the api, or pass null to reset. */
export function setVisionApiForTests(api: VisionApi | null): void {
  override = api;
}
