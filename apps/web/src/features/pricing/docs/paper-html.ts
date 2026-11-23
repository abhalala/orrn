/**
 * The A4 page of a `PaperDoc` as one HTML string, printed from a hidden frame (the browser's print dialog also saves
 * a PDF). Loaded with `await import()` on click, never with a route chunk. Plain greys, no external files.
 */
import type { PaperDoc } from "./docs-model";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
@page { size: A4 portrait; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 10px/1.4 Helvetica, Arial, sans-serif; color: #111; }
h1 { margin: 0; font-size: 18px; }
.sub { color: #555; margin-top: 2px; }
.banner { margin: 8px 0; padding: 4px 8px; border: 1px solid #111; font-weight: 700; font-size: 11px; }
.top { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.meta td { padding: 1px 0 1px 10px; }
.meta td:first-child { color: #555; text-align: right; padding-left: 0; }
.meta td:last-child { font-weight: 700; }
.party { margin: 6px 0 10px; }
.party b { font-size: 12px; }
table.lines { width: 100%; border-collapse: collapse; }
table.lines th { text-align: left; font-size: 9px; border-bottom: 1.5px solid #111; padding: 3px 4px 3px 0; }
table.lines td { padding: 3px 4px 3px 0; border-bottom: 0.5px solid #d4d4d4; vertical-align: top; }
table.lines tr.detail td { color: #555; font-size: 9px; border-bottom: 0.5px solid #d4d4d4; padding-top: 0; }
.r { text-align: right; }
.totals { margin: 10px 0 0 auto; width: 55%; border-collapse: collapse; }
.totals td { padding: 2px 0; }
.totals tr:last-child td { border-top: 1.5px solid #111; font-weight: 700; font-size: 12px; padding-top: 4px; }
.notes { margin-top: 12px; color: #333; }
.notes p { margin: 2px 0; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
`;

export function buildPaperHtml(doc: PaperDoc): string {
  const head = `<div><h1>${esc(doc.company || doc.title)}</h1>${doc.company ? `<div class="sub">${esc(doc.title)}</div>` : ""}${doc.companyLines.map((l) => `<div class="sub">${esc(l)}</div>`).join("")}</div>`;
  const meta = `<table class="meta">${doc.meta.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
  const party = doc.party ? `<div class="party"><span class="sub">${esc(doc.party.label)}</span><br><b>${esc(doc.party.name)}</b>${doc.party.lines.map((l) => `<br>${esc(l)}`).join("")}</div>` : "";
  const cls = (i: number) => (doc.align[i] === "r" ? ' class="r"' : "");
  const body = doc.rows
    .map((r, i) => {
      const detail = (doc.details[i] ?? []).map((d) => `<tr class="detail"><td></td><td colspan="${doc.columns.length - 1}">${esc(d)}</td></tr>`).join("");
      return `<tr>${r.map((c, ci) => `<td${cls(ci)}>${esc(c)}</td>`).join("")}</tr>${detail}`;
    })
    .join("");
  const totals = doc.totals.length > 0 ? `<table class="totals">${doc.totals.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join("")}</table>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.fileName)}</title><style>${CSS}</style></head><body>
<div class="top">${head}${meta}</div>
${doc.banner ? `<div class="banner">${esc(doc.banner)}</div>` : ""}
${party}
<table class="lines"><thead><tr>${doc.columns.map((c, i) => `<th${cls(i)}>${esc(c)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
${totals}
<div class="notes">${doc.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>
</body></html>`;
}

/** The page in a hidden frame, then the browser's print dialog. */
export function printPaperHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    throw new Error("print frame unavailable");
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = frame.contentWindow;
  win.addEventListener("afterprint", () => frame.remove(), { once: true });
  // Some browsers never fire afterprint on a hidden frame.
  setTimeout(() => frame.remove(), 60_000);
  win.focus();
  win.print();
}
