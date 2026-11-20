import type { Words } from "./model";
import type { VisionProgress } from "./vision-pump";
import type { VisionPageView } from "./vision-types";

/** Words of the vision pump's steps and of a page's answer. Pure, so the list models can use them. */

/** The words of one step, for the live region and the strip ("Reading page 2 of 5"). */
export function visionProgressWords(p: VisionProgress): Words {
  switch (p.phase) {
    case "opening":
      return { key: "ingest.vision.opening" };
    case "rendering":
      return { key: "ingest.vision.rendering", vars: { page: p.page, total: p.total } };
    case "sending":
      return { key: "ingest.vision.sending", vars: { page: p.page, total: p.total } };
    case "cutting":
      return { key: "ingest.vision.cutting", vars: { page: p.page, total: p.total } };
    case "reading":
      return p.band
        ? { key: "ingest.vision.readingBand", vars: { page: p.page, total: p.total, band: p.band.index, bands: p.band.total } }
        : { key: "ingest.vision.reading", vars: { page: p.page, total: p.total } };
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
    case "cutting":
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
