import type { StatusTone } from "@orrn/domain";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardDescription, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

import { Fact, FactGrid } from "./bits";
import {
  BUNDLE_26J12,
  CUSTOMER_FILTERS,
  LINES,
  RECIPE_6063_T5,
  REPORT_FEATURES,
  SECTIONS,
  formatCut,
  formatDay,
  formatKgFromG,
  hardnessPassed,
  orderStrip,
  remainingPcs,
  type AgeingLine,
  type CustomerFilter,
  type SectionId,
} from "./fixtures";
import { ageingBatchTo } from "./paths";

const mod = previewModule("ageing")!;

type SectionFilter = "all" | SectionId;

const COLUMNS: DataTableColumn<AgeingLine>[] = [
  { id: "batch", header: "Batch", cell: (row) => row.batchNumber },
  { id: "trolley", header: "Trolley", cell: (row) => row.trolleyCode },
  { id: "press", header: "Press run", cell: (row) => row.pressRun },
  { id: "order", header: "Sales order", cell: (row) => row.salesOrder },
  { id: "customer", header: "Customer", cell: (row) => row.customer },
  { id: "cast", header: "Cast", cell: (row) => row.cast },
  { id: "die", header: "Die copy", cell: (row) => row.dieCopy },
  { id: "length", header: "Length", cell: (row) => formatCut(row.cutLengthMm) },
  { id: "pcs", header: "Pcs in trolley", cell: (row) => String(row.pcs), align: "right" },
  { id: "packed", header: "Packed", cell: (row) => String(row.packedPcs), align: "right" },
  { id: "remaining", header: "Remaining", cell: (row) => String(remainingPcs(row)), align: "right" },
  {
    id: "hardness",
    header: "Hardness",
    cell: (row) => (row.hardnessX10.length === 0 ? "—" : row.hardnessX10.map((n) => (n / 10).toFixed(1)).join(", ")),
  },
  {
    id: "pass",
    header: "Pass",
    cell: (row) => {
      if (row.hardnessX10.length === 0) return "—";
      return hardnessPassed(row.hardnessX10, RECIPE_6063_T5) ? "Pass" : "Fail";
    },
  },
];

function rowTone(row: AgeingLine): { tone: StatusTone; label: string } {
  if (row.batchStatus === "in_oven") return { tone: "amber", label: "In oven" };
  if (row.status === "held") return { tone: "red", label: "Held" };
  if (row.status === "released") return { tone: "green", label: "Released" };
  return { tone: "blue", label: "Out" };
}

function isCustomer(value: string): value is CustomerFilter {
  return (CUSTOMER_FILTERS as readonly string[]).includes(value);
}

function isSection(value: string): value is SectionFilter {
  return value === "all" || value === "domal-12170" || value === "tee-13090";
}

export function AgeingReport() {
  const [section, setSection] = useState<SectionFilter>("all");
  const [customer, setCustomer] = useState<CustomerFilter>("All");
  const [csv, setCsv] = useState<string | null>(null);
  const strip = orderStrip("SO-104");

  const rows = LINES.filter((row) => {
    if (section !== "all" && row.sectionId !== section) return false;
    if (customer !== "All" && row.customer !== customer) return false;
    return true;
  });
  const loaded = rows.reduce((sum, row) => sum + row.pcs, 0);
  const packed = rows.reduce((sum, row) => sum + row.packedPcs, 0);
  const left = rows.reduce((sum, row) => sum + remainingPcs(row), 0);

  return (
    <PreviewFrame
      title="Ageing report"
      summary="24 Oct 2026 · Day shift."
      featureIds={[...REPORT_FEATURES]}
      specPath={mod.specPath}
      actions={
        <Button variant="secondary" asChild>
          <Link to={ageingBatchTo}>AG-38</Link>
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-5">
        <Toolbar
          actions={
            <Button
              onPress={() => setCsv(`CSV ready · ${rows.length} lines. Not downloaded.`)}
            >
              Export
            </Button>
          }
        >
          <Badge tone="neutral">{formatDay("2026-10-24T09:10:00+05:30")}</Badge>
          <Chip tone="blue">Day</Chip>
          <label className="flex min-w-0 flex-col gap-1 sm:w-52">
            <span className="text-[13px] font-medium text-muted-foreground">Section</span>
            <NativeSelect
              aria-label="Section"
              value={section}
              onChange={(e) => {
                if (isSection(e.target.value)) setSection(e.target.value);
              }}
            >
              <option value="all">All</option>
              <option value="domal-12170">Domal 12170</option>
              <option value="tee-13090">Tee 13090</option>
            </NativeSelect>
          </label>
          <label className="flex min-w-0 flex-col gap-1 sm:w-56">
            <span className="text-[13px] font-medium text-muted-foreground">Customer</span>
            <NativeSelect
              aria-label="Customer"
              value={customer}
              onChange={(e) => {
                if (isCustomer(e.target.value)) setCustomer(e.target.value);
              }}
            >
              {CUSTOMER_FILTERS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </label>
        </Toolbar>

        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              title={customer === "Apex Fabricators" ? "No batches for this customer." : "No batches in this range."}
              body={
                customer === "Apex Fabricators"
                  ? "Apex Fabricators has nothing in ageing on this shift."
                  : "Change the section or customer filter."
              }
            />
          }
          renderCard={(row) => <ReportCard row={row} />}
          footer={
            rows.length > 0 ? (
              <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
                {rows.length} lines · {loaded} pcs in the trolley = {packed} packed + {left} remaining.
              </p>
            ) : null
          }
        />
        {csv ? (
          <p role="status" className="m-0 text-[14px] font-medium text-foreground">
            {csv}
          </p>
        ) : null}

        <Card>
          <CardTitle className="font-mono tabular-nums">Bundle {BUNDLE_26J12.serial}</CardTitle>
          <CardDescription>
            Trace onto the bundle. The label already prints the cast; this is the link.
          </CardDescription>
          <FactGrid className="sm:grid-cols-3">
            <Fact label="Ageing batch" value={BUNDLE_26J12.batchNumber} />
            <Fact label="Press run" value={BUNDLE_26J12.pressRun} />
            <Fact label="Cast" value={BUNDLE_26J12.cast} />
            <Fact label="Sales order" value={BUNDLE_26J12.salesOrder} />
            <Fact label="Pieces" value={`${BUNDLE_26J12.pcs} pcs`} />
            <Fact label="Scale" value={`${formatKgFromG(BUNDLE_26J12.weightG)} kg`} />
          </FactGrid>
        </Card>

        {strip ? (
          <Card>
            <CardTitle>On the order</CardTitle>
            <CardDescription>
              {strip.salesOrder} · {strip.customer}, {strip.city} · PO {strip.po}. Piece counts come from the lines
              below.
            </CardDescription>
            <FactGrid className="sm:grid-cols-3">
              <Fact label="In oven" value={`${strip.inOven}`} />
              <Fact label="Released" value={`${strip.released} pcs`} />
              <Fact label="Held" value={`${strip.held}`} />
              <Fact label="Packed" value={`${strip.packed}`} />
              <Fact label="Still on the trolley" value={`${strip.onTrolley}`} />
              <Fact label="Loaded" value={`${strip.loaded} pcs`} />
            </FactGrid>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {strip.lines.map((line) => (
                <li key={line.id} className="text-[13px] leading-5 text-muted-foreground">
                  <span className="font-mono tabular-nums text-foreground">
                    {line.dieCopy} · {line.lengthLabel}
                  </span>
                  {" · "}
                  loaded {line.loaded}, in oven {line.inOven}, held {line.held}, released {line.released}, packed{" "}
                  {line.packed}, still on the trolley {line.onTrolley}
                </li>
              ))}
            </ul>
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">
              Theoretical loaded {formatKgFromG(strip.theoreticalG)} kg.
            </p>
          </Card>
        ) : null}
      </div>
    </PreviewFrame>
  );
}

function ReportCard({ row }: { row: AgeingLine }) {
  const tone = rowTone(row);
  const pass = row.hardnessX10.length === 0 ? null : hardnessPassed(row.hardnessX10, RECIPE_6063_T5);
  const trace = row.id === BUNDLE_26J12.ageingRowId;
  return (
    <Card className="h-full">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {row.batchNumber === "AG-38" ? (
            <CardTitle className="font-mono tabular-nums">
              <Link to={ageingBatchTo} className="text-foreground no-underline">
                {row.batchNumber}
              </Link>
            </CardTitle>
          ) : (
            <CardTitle className="font-mono tabular-nums">{row.batchNumber}</CardTitle>
          )}
          <CardDescription>
            {row.customer}, {row.city} · {SECTIONS[row.sectionId].label}
          </CardDescription>
        </div>
        <Chip tone={tone.tone}>{tone.label}</Chip>
      </div>
      <FactGrid>
        <Fact label="Trolley" value={row.trolleyCode} />
        <Fact label="Press run" value={row.pressRun} />
        <Fact label="Sales order" value={`${row.salesOrder} · PO ${row.po}`} />
        <Fact label="Customer" value={row.customer} />
        <Fact label="Cast" value={row.cast} />
        <Fact label="Die copy" value={row.dieCopy} />
        <Fact label="Length" value={formatCut(row.cutLengthMm)} />
        <Fact label="Pcs in trolley" value={String(row.pcs)} />
        <Fact label="Packed" value={String(row.packedPcs)} />
        <Fact label="Remaining" value={String(remainingPcs(row))} />
        <Fact
          label="Hardness"
          value={row.hardnessX10.length === 0 ? "—" : row.hardnessX10.map((n) => (n / 10).toFixed(1)).join(", ")}
        />
        <Fact label="Pass" value={pass === null ? "—" : pass ? "Pass" : "Fail"} />
      </FactGrid>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">
        Theoretical {formatKgFromG(row.kgG)} kg. From the press line.
      </p>
      {trace ? (
        <p className="m-0 text-[13px] leading-5 text-foreground">
          Bundle {BUNDLE_26J12.serial} traces here · {BUNDLE_26J12.pressRun} · cast {BUNDLE_26J12.cast}.
        </p>
      ) : null}
    </Card>
  );
}


