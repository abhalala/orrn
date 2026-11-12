/**
 * The web's old import templates, copied as text (rule 6.4, M-R6-1). Source: `sampleCsv(kind, unit)` in
 * `apps/web/src/features/imports/templates.ts` (its `columnGuide` header row and `sampleValues` rows, joined by
 * `toCsv` in `apps/web/src/features/imports/parse.ts`: comma, CRLF). No column is added. Copied 2026-11-11; when the
 * web's templates change, copy them again. The ingest package does not import the web.
 */
export const WEB_TEMPLATE_CSV = {
  bundles: {
    mm: "Die series,Section code,Pieces,Weight (kg),Length (mm),PO number\r\n40,4012,25,58.4,3658,PO-2611\r\n40,4012,20,44.9,3505,\r\n",
    inch: "Die series,Section code,Pieces,Weight (kg),Length (ft),PO number\r\n40,4012,25,58.4,12,PO-2611\r\n40,4012,20,44.9,11 ft 6 in,\r\n",
  },
  dies: {
    mm: "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes\r\n40,4012,2.2,2.5,Window frame,44.5,1.2,,active,\r\n",
    inch: "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes\r\n40,4012,2.2,2.5,Window frame,44.5,1.2,,active,\r\n",
  },
  customers: {
    mm: "Name,Phone,Email,GSTIN,Notes\r\nShree Ganesh Aluminium,98250 12345,accounts@example.in,24AAACS1234A1Z5,\r\n",
    inch: "Name,Phone,Email,GSTIN,Notes\r\nShree Ganesh Aluminium,98250 12345,accounts@example.in,24AAACS1234A1Z5,\r\n",
  },
} as const;
